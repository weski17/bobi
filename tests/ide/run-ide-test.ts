// Launches Bobi IDE (vendor/code-oss, dev build) with the integration test runner against the mock model.
// Usage: bun tests/ide/run-ide-test.ts   (opens an IDE window for the duration of the test)
import { existsSync } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startMockModel } from "@bobi/mock-model"
import { ideEnv } from "../../scripts/ide/env.ts"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CODE_OSS = path.join(ROOT, "vendor", "code-oss")
const EXTENSION = path.join(CODE_OSS, "extensions", "bobi-chat")

export async function runIdeTest(): Promise<{ passed: boolean; code: number; output: string }> {
  Bun.spawnSync(["bun", path.join(ROOT, "scripts", "ide", "prepare.ts")], { stdout: "ignore", stderr: "inherit" })
  const project = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-ide-it-")))
  const userData = await mkdtemp(path.join(tmpdir(), "bobi-ide-user-"))
  const home = await mkdtemp(path.join(tmpdir(), "bobi-ide-home-"))
  await writeFile(path.join(project, "app.ts"), "export const answer = 41\n")
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]]) Bun.spawnSync(["git", ...args], { cwd: project })
  const file = path.join(project, "app.ts")
  const mock = startMockModel({ script: [{ toolCalls: [{ name: "edit", arguments: { path: file, oldString: "41", newString: "42" } }] }, { text: "Fixed." }] })
  try {
    const child = Bun.spawn(
      [
        path.join(CODE_OSS, "scripts", "code.sh"),
        project,
        `--extensionDevelopmentPath=${EXTENSION}`,
        `--extensionTestsPath=${path.join(import.meta.dir, "runner.cjs")}`,
        `--user-data-dir=${userData}`,
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-telemetry",
        "--use-inmemory-secretstorage",
      ],
      {
        cwd: CODE_OSS,
        env: {
          ...ideEnv(),
          BOBI_HOME: home,
          BOBI_MODEL_BASE_URL: mock.baseURL,
          BOBI_MODEL: "mock-model",
          BOBI_MODEL_API_KEY: "ide-test",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { passed: existsSync(path.join(project, ".ide-test-passed")) && code === 0, code, output: out + err }
  } finally {
    await mock.stop()
    for (const d of [project, userData, home]) await rm(d, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const result = await runIdeTest()
  console.log(result.output.split("\n").filter((l) => !/^\s*$/.test(l)).slice(-40).join("\n"))
  console.log(result.passed ? "IDE TEST PASSED" : `IDE TEST FAILED (exit ${result.code})`)
  process.exit(result.passed ? 0 : 1)
}
