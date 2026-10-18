// Asserts that a full session talks only to the configured model endpoint (ADR-0003).
// Covers HTTP made through fetch (OpenCode's HTTP client); raw sockets are covered by the sandbox egress policy.
import { expect, test } from "bun:test"
import path from "node:path"

test("a session with write, search and read tools contacts only the model endpoint", async () => {
  const probe = Bun.spawn(["bun", path.join(import.meta.dir, "fixtures", "offline-probe.ts")], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited])
  expect(code, stderr).toBe(0)
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as { model: string; requests: number; origins: string[] }
  expect(result.requests).toBeGreaterThanOrEqual(5)
  expect(result.origins).toEqual([result.model])
}, 60_000)
