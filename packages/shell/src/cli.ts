#!/usr/bin/env bun
// Entry point of the `bobi` application.
import { ConfigError } from "@bobi/config"
import { runApp } from "./app.ts"
import { UsageError } from "./args.ts"

try {
  const code = await runApp(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    spawn: async (argv, env, cwd) => Bun.spawn(argv, { env, cwd, stdio: ["inherit", "inherit", "inherit"] }).exited,
    ask: process.stdin.isTTY
      ? async (question) => {
          process.stderr.write(question)
          for await (const line of console) return /^y(es)?$/i.test(line.trim())
          return false
        }
      : undefined,
    untilStopped: () =>
      new Promise((resolve) => {
        process.once("SIGINT", () => resolve())
        process.once("SIGTERM", () => resolve())
      }),
  })
  process.exit(code)
} catch (error) {
  if (error instanceof ConfigError || error instanceof UsageError) {
    console.error(`bobi: ${error.message}`)
    process.exit(2)
  }
  throw error
}
