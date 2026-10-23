// sandbox/compose-masks.ts: the Docker Compose override that hides .bobiignore'd files in the server container.
import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { composeMasks } from "../../sandbox/compose-masks.ts"

const dir = mkdtempSync(path.join(tmpdir(), "bobi-masks-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("ignored files get /dev/null, ignored directories an empty directory, read-only", () => {
  writeFileSync(path.join(dir, ".bobiignore"), "secret.txt\nprivate/\n*.pem\n")
  writeFileSync(path.join(dir, "secret.txt"), "x")
  writeFileSync(path.join(dir, "app.ts"), "x")
  writeFileSync(path.join(dir, "key.pem"), "x")
  mkdirSync(path.join(dir, "private"))
  writeFileSync(path.join(dir, "private", "notes.md"), "x")
  const yaml = composeMasks(dir, "/home/u/.bobi/sandbox/empty")
  expect(yaml).toContain("services:\n  server:\n    volumes:")
  expect(yaml).toContain(`- "/dev/null:${dir}/secret.txt:ro"`)
  expect(yaml).toContain(`- "/dev/null:${dir}/key.pem:ro"`)
  expect(yaml).toContain(`- "/home/u/.bobi/sandbox/empty:${dir}/private:ro"`)
  expect(yaml).not.toContain("app.ts")
  expect(yaml).not.toContain("notes.md")
})

test("a project without .bobiignore gets an empty override", () => {
  const plain = mkdtempSync(path.join(tmpdir(), "bobi-masks-plain-"))
  try {
    expect(composeMasks(plain, "/e")).toContain("  server:\n    {}")
  } finally {
    rmSync(plain, { recursive: true, force: true })
  }
})
