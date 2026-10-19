import { afterAll, beforeAll, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { bobiEnv, resolveCommand, startBobi, trust } from "../src/server.ts"

let dir: string
beforeAll(() => (dir = mkdtempSync(path.join(tmpdir(), "bobi-ext-srv-"))))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fake = (name: string, script: string) => {
  const file = path.join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  return [file]
}

test("adds Homebrew, Bun and ~/.local/bin to PATH", () => {
  const env = bobiEnv({ PATH: "/usr/bin" })
  expect(env.PATH!.split(":")).toEqual(expect.arrayContaining(["/usr/bin", "/opt/homebrew/bin", expect.stringMatching(/\.bun\/bin$/), expect.stringMatching(/\.local\/bin$/)]))
  expect(bobiEnv({}).PATH).toContain("/opt/homebrew/bin")
})

test("command: setting, else ~/.local/bin/bobi, else bobi", () => {
  expect(resolveCommand(["bun", "/x/cli.ts"])).toEqual(["bun", "/x/cli.ts"])
  const home = path.join(dir, "home")
  expect(resolveCommand([], home)).toEqual(["bobi"])
  mkdirSync(path.join(home, ".local", "bin"), { recursive: true })
  writeFileSync(path.join(home, ".local", "bin", "bobi"), "")
  expect(resolveCommand([], home)).toEqual([path.join(home, ".local", "bin", "bobi")])
})

test("starts the server and reads its URL; stop ends it", async () => {
  const cmd = fake("serve-ok", `echo "noise"; echo '{"url":"http://127.0.0.1:9"}'; [ -n "$BOBI_SERVER_PASSWORD" ] || exit 3; exec sleep 30`)
  const running = await startBobi(cmd, dir)
  expect(running.url).toBe("http://127.0.0.1:9")
  expect(running.password.length).toBeGreaterThanOrEqual(24)
  await running.stop()
  await running.stop()
})

test("reports a server that exits or never becomes ready", async () => {
  await expect(startBobi(fake("serve-fail", "echo boom >&2; exit 2"), dir)).rejects.toThrow(/exited with code 2[\s\S]*boom/)
  await expect(startBobi(fake("serve-slow", "sleep 5"), dir, 200)).rejects.toThrow(/did not start/)
  await expect(startBobi([path.join(dir, "missing")], dir)).rejects.toThrow()
})

test("trust reads the JSON status and reports failures", async () => {
  expect(await trust(fake("trust-ok", `echo '{"project":"/p","status":"unknown","files":["AGENTS.md"]}'`), dir, "status")).toEqual({ project: "/p", status: "unknown", files: ["AGENTS.md"] })
  await expect(trust(fake("trust-fail", "echo nope >&2; exit 1"), dir, "yes")).rejects.toThrow(/bobi trust failed: nope/)
})
