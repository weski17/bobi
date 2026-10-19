// Links OpenCode workspace packages from vendor/opencode into node_modules.
// OpenCode packages are never installed from the npm registry: a public package with
// the same name would be a supply-chain risk, and Bobi must run against the pinned fork.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const vendor = path.join(root, "vendor", "opencode")
const packages = ["ai", "client", "core", "plugin", "protocol", "schema", "sdk", "server", "util"]

if (!existsSync(path.join(vendor, "node_modules"))) {
  console.error("vendor/opencode is not installed. Run: git submodule update --init && (cd vendor/opencode && bun install)")
  process.exit(1)
}

function link(target: string, at: string) {
  mkdirSync(path.dirname(at), { recursive: true })
  if (existsSync(at) || lstatSync(at, { throwIfNoEntry: false })) rmSync(at, { recursive: true, force: true })
  symlinkSync(target, at, "dir")
}

for (const name of packages) {
  link(path.join(vendor, "packages", name), path.join(root, "node_modules", "@opencode", name))
}
// The Bobi server runs the engine's router on Effect's Node HTTP server (WebSocket support).
link(realpathSync(path.join(vendor, "packages", "server", "node_modules", "@effect", "platform-node")), path.join(root, "node_modules", "@effect", "platform-node"))
// Plugins must share the host's effect instance (see vendor/opencode/packages/plugin/src/runtime.ts).
link(realpathSync(path.join(vendor, "packages", "plugin", "node_modules", "effect")), path.join(root, "node_modules", "effect"))

console.log(`linked ${readdirSync(path.join(root, "node_modules", "@opencode")).length} @opencode packages and effect from vendor/opencode`)
