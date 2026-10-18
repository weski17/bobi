#!/usr/bin/env bun
// Starts the mock model for manual demos: bun packages/mock-model/src/cli.ts [--port 4001]
import { startMockModel } from "./index.ts"

const portFlag = process.argv.indexOf("--port")
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 4001
const mock = startMockModel({
  port,
  fallback: (request) => {
    const last = [...request.messages].reverse().find((m) => m.role === "user")
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "")
    return { text: `mock reply to: ${text.slice(0, 200)}` }
  },
})
console.log(`mock model listening on ${mock.baseURL}`)
