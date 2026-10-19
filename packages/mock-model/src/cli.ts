#!/usr/bin/env bun
// Starts the mock model for manual demos: bun packages/mock-model/src/cli.ts [--port 4001] [--script turns.json]
// A script is a JSON array of turns ({ "text": ... } or { "toolCalls": [{ "name", "arguments" }] }).
import { readFileSync } from "node:fs"
import { startMockModel, type Turn } from "./index.ts"

const scriptFlag = process.argv.indexOf("--script")
const script = scriptFlag > 0 ? (JSON.parse(readFileSync(process.argv[scriptFlag + 1]!, "utf8")) as Turn[]) : []

const portFlag = process.argv.indexOf("--port")
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 4001
const mock = startMockModel({
  port,
  script,
  fallback: (request) => {
    const last = [...request.messages].reverse().find((m) => m.role === "user")
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "")
    return { text: `mock reply to: ${text.slice(0, 200)}` }
  },
})
console.log(`mock model listening on ${mock.baseURL}`)
