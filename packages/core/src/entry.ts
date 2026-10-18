// Plugin entrypoint loaded by the OpenCode CLI host (config `plugins: [{ package: <this file> }]`).
// Loads the Bobi config for the session's location and delegates to createBobiCore.
import { loadConfig } from "@bobi/config"
import { createBobiCore } from "./plugin.ts"

export default {
  id: "bobi.core",
  setup: async (ctx: Parameters<ReturnType<typeof createBobiCore>["setup"]>[0]) => {
    const { config, apiKey } = loadConfig({ cwd: ctx.location.directory })
    return createBobiCore({ config, secrets: [apiKey] }).setup(ctx)
  },
}
