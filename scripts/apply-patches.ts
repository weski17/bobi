// Applies patches/<upstream>/*.patch to vendor/<upstream> in order (ADR-0001). Idempotent: patches that are
// already applied are skipped. Fails loudly if a patch no longer applies after an upstream update.
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")

for (const upstream of ["opencode", "code-oss"]) {
  const vendor = path.join(root, "vendor", upstream)
  const dir = path.join(root, "patches", upstream)
  // code-oss is optional (only needed for the IDE).
  if (!existsSync(path.join(vendor, ".git")) || !existsSync(dir)) continue
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", vendor, ...args], { stderr: "pipe" })
  let applied = 0
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".patch")).sort()) {
    const file = path.join(dir, name)
    if (git("apply", "--reverse", "--check", file).exitCode === 0) continue
    const check = git("apply", "--check", file)
    if (check.exitCode !== 0) {
      console.error(`patch ${name} does not apply to vendor/${upstream}:\n${check.stderr.toString()}`)
      process.exit(1)
    }
    if (git("apply", file).exitCode !== 0) process.exit(1)
    applied++
  }
  console.log(`applied ${applied} patch(es) to vendor/${upstream}`)
}
