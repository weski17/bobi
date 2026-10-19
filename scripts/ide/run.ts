// Starts Bobi IDE from source (after `bun run ide:setup`): bun run ide [folder]
import { existsSync } from "node:fs"
import path from "node:path"
import { ideEnv, run } from "./env.ts"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CODE_OSS = path.join(ROOT, "vendor", "code-oss")
if (!existsSync(path.join(CODE_OSS, "out"))) {
  console.error("Bobi IDE is not set up yet. Run: bun run ide:setup")
  process.exit(2)
}
run(["bun", "scripts/ide/prepare.ts"], ROOT)
const folder = path.resolve(process.argv[2] ?? process.cwd())
const child = Bun.spawn([path.join(CODE_OSS, "scripts", "code.sh"), folder, "--skip-welcome"], { cwd: CODE_OSS, env: ideEnv(), stdio: ["inherit", "inherit", "inherit"] })
process.exit(await child.exited)
