// Runs one full session in a fresh process and prints every HTTP origin contacted, as JSON.
// fetch is wrapped before OpenCode is imported, so every client created later is observed.
const origins = new Set<string>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  origins.add(new URL(url).origin)
  return realFetch(input, init)
}) as typeof fetch

const path = await import("node:path")
const { OFFLINE_ENV } = await import("@bobi/config")
Object.assign(process.env, OFFLINE_ENV)
const { createHarness } = await import("../harness.ts")

const h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
const file = path.join(h.dir, "a.txt")
const sessionID = await h.prompt(
  "work",
  { toolCalls: [{ name: "write", arguments: { path: file, content: "needle" } }] },
  { toolCalls: [{ name: "grep", arguments: { pattern: "needle", path: h.dir } }] },
  { toolCalls: [{ name: "glob", arguments: { pattern: "*.txt", path: h.dir } }] },
  { toolCalls: [{ name: "read", arguments: { path: file } }] },
  { text: "done" },
)
await h.opencode.sessions.wait({ sessionID })
await Bun.sleep(300)
const result = { model: new URL(h.mock.url).origin, requests: h.mock.requests.length, origins: [...origins] }
await h.close()
console.log(JSON.stringify(result))
