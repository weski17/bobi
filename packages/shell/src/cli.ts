#!/usr/bin/env bun
// `bobi` – starts the OpenCode engine configured as Bobi. Usage: bobi [run "<message>"] [opencode flags]
import { mkdirSync } from "node:fs"
import { ConfigError, loadConfig } from "@bobi/config"
import { buildLaunch, LaunchError, startServer, verifyCore } from "./launcher.ts"

try {
  const cwd = process.cwd()
  const { config } = loadConfig({ cwd })
  const launch = buildLaunch(config, process.argv.slice(2))
  mkdirSync(launch.env.OPENCODE_CONFIG_DIR!, { recursive: true })
  if (!launch.session) {
    const child = Bun.spawn(launch.argv, { cwd, env: launch.env, stdio: ["inherit", "inherit", "inherit"] })
    process.exit(await child.exited)
  }
  const server = await startServer(launch, cwd)
  try {
    await verifyCore(server, cwd)
  } catch (error) {
    await server.stop()
    throw error
  }
  const child = Bun.spawn([...launch.argv, "--server", server.url], {
    cwd,
    env: { ...launch.env, OPENCODE_PASSWORD: server.password },
    stdio: ["inherit", "inherit", "inherit"],
  })
  const code = await child.exited
  await server.stop()
  process.exit(code)
} catch (error) {
  if (error instanceof ConfigError || error instanceof LaunchError) {
    console.error(`bobi: ${error.message}`)
    process.exit(2)
  }
  throw error
}
