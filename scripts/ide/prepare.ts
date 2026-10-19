// Prepares vendor/code-oss for running Bobi IDE: branding, and the Bobi chat extension as a built-in extension.
import { cpSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const EXT = path.join(ROOT, "packages", "ide-extension")
export const TARGET = path.join(ROOT, "vendor", "code-oss", "extensions", "bobi-chat")

function run(cmd: string[], cwd = ROOT) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" })
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed`)
}

if (import.meta.main) {
  run(["bun", path.join(ROOT, "scripts", "ide", "brand.ts")])
  run(["bun", "run", "build"], EXT)
  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(TARGET, { recursive: true })
  for (const entry of ["package.json", "dist", "media"]) cpSync(path.join(EXT, entry), path.join(TARGET, entry), { recursive: true })
  console.log(`installed the Bobi extension into ${path.relative(ROOT, TARGET)}`)
}
