#!/usr/bin/env bun
// Starts the mock model for manual demos: bun packages/mock-model/src/cli.ts [--port 4001] [--hostname 127.0.0.1] [--script turns.json]
// A script is a JSON array of turns ({ "text": ... } or { "toolCalls": [{ "name", "arguments" }] }).
import { readFileSync } from "node:fs"
import { startMockModel, type Turn } from "./index.ts"

const scriptFlag = process.argv.indexOf("--script")
const script = scriptFlag > 0 ? (JSON.parse(readFileSync(process.argv[scriptFlag + 1]!, "utf8")) as Turn[]) : []

const portFlag = process.argv.indexOf("--port")
const port = portFlag > 0 ? Number(process.argv[portFlag + 1]) : 4001
const hostnameFlag = process.argv.indexOf("--hostname")
// Default loopback; containers (docker compose --profile demo) listen on 0.0.0.0 inside their own network.
const hostname = hostnameFlag > 0 ? process.argv[hostnameFlag + 1] : "127.0.0.1"
const mock = startMockModel({
  port,
  hostname,
  script,
  fallback: (request) => {
    const last = [...request.messages].reverse().find((m) => m.role === "user")
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "")
    return { text: `mock reply to: ${text.slice(0, 200)}` }
  },
})
console.log(`mock model listening on ${mock.baseURL}`)
