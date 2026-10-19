// Build environment for vendor/code-oss: Node 24 from Homebrew and, on macOS, an SDK that matches the installed
// Command Line Tools (a newer leftover SDK makes the linker fail with "unknown architecture").
import { existsSync } from "node:fs"
import path from "node:path"

const CLT_SDKS = "/Library/Developer/CommandLineTools/SDKs"

function out(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" })
  return r.exitCode === 0 ? r.stdout.toString().trim() : ""
}

export function matchingSdk(): string | undefined {
  if (process.platform !== "darwin") return undefined
  const sdkVersion = out(["xcrun", "--sdk", "macosx", "--show-sdk-version"])
  const clt = /version: (\d+)/.exec(out(["pkgutil", "--pkg-info=com.apple.pkg.CLTools_Executables"]))?.[1]
  if (!clt || !sdkVersion || Number(sdkVersion.split(".")[0]) <= Number(clt)) return undefined
  const candidate = path.join(CLT_SDKS, `MacOSX${clt}.sdk`)
  return existsSync(candidate) ? candidate : undefined
}

export function ideEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
  env.PATH = ["/opt/homebrew/opt/node@24/bin", "/opt/homebrew/bin", env.PATH ?? ""].join(":")
  const sdk = matchingSdk()
  if (sdk && !env.SDKROOT) env.SDKROOT = sdk
  return env
}

export function run(cmd: string[], cwd: string, env = ideEnv()) {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" })
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (exit ${r.exitCode})`)
}
