#!/usr/bin/env bun
// Starts the web chat gate from environment variables (used by the demo image).
//   DEMO_PASSWORD, BOBI_SERVER_PASSWORD, WEBCHAT_PORT (default 7682), WEBCHAT_UPSTREAM (default http://127.0.0.1:4096),
//   WEBCHAT_DIRECTORY (project folder), TLS files /run/tls/tls.crt and tls.key (optional).
import { existsSync } from "node:fs"
import path from "node:path"
import { startGate } from "./gate.ts"

const need = (name: string) => {
  const value = process.env[name]
  if (!value) {
    console.error(`bobi web chat: ${name} is required`)
    process.exit(2)
  }
  return value
}
const password = need("DEMO_PASSWORD")
if (password.length < 12) {
  console.error("bobi web chat: DEMO_PASSWORD needs at least 12 characters")
  process.exit(2)
}
const root = path.resolve(import.meta.dir, "..", "..")
const tls = existsSync("/run/tls/tls.crt") && existsSync("/run/tls/tls.key") ? { cert: "/run/tls/tls.crt", key: "/run/tls/tls.key" } : undefined
const port = Number(process.env.WEBCHAT_PORT ?? 7682)
startGate({
  port,
  password,
  upstream: process.env.WEBCHAT_UPSTREAM ?? "http://127.0.0.1:4096",
  serverPassword: need("BOBI_SERVER_PASSWORD"),
  directory: need("WEBCHAT_DIRECTORY"),
  publicDir: path.join(root, "web-chat", "public"),
  distDir: path.join(root, "web-chat", "dist"),
  mediaDir: path.join(root, "ide-extension", "media"),
  tls,
})
console.log(`bobi web chat: listening on :${port}${tls ? " (TLS)" : ""}`)
