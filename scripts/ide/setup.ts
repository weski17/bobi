// One-time setup of Bobi IDE from source: install Code-OSS dependencies, compile, add branding and the extension.
import path from "node:path"
import { ideEnv, run } from "./env.ts"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CODE_OSS = path.join(ROOT, "vendor", "code-oss")

run(["git", "submodule", "update", "--init", "--depth", "1", "vendor/code-oss"], ROOT)
run(["bun", "scripts/apply-patches.ts"], ROOT)
const env = ideEnv()
if (env.SDKROOT) console.log(`using macOS SDK ${env.SDKROOT}`)
run(["npm", "ci"], CODE_OSS, env)
run(["npm", "run", "compile"], CODE_OSS, env)
run(["bun", "scripts/ide/prepare.ts"], ROOT)
console.log("Bobi IDE is ready: bun run ide [folder]")
