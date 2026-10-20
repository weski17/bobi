import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, realpath, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS, type BobiConfig } from "@bobi/config"
import { createMasker } from "@bobi/core"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { bobiPaths, COMPLETE_PATH, handleCompletion, startBobiServer, trimCompletion } from "../src/index.ts"

let mock: MockModel
let dir: string
const apiKey = crypto.randomUUID()
const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"

beforeAll(async () => {
  mock = startMockModel({ completion: (body) => (body.prompt.endsWith("return ") ? "a + b\n}\n\n\nmore" : "x = 1\ny = 2") })
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-complete-")))
  await mkdir(path.join(dir, ".git"))
  await writeFile(path.join(dir, ".bobiignore"), "secret/\n")
})
afterAll(async () => {
  await mock.stop()
  await rm(dir, { recursive: true, force: true })
})

const config = (patch: Partial<BobiConfig> = {}): BobiConfig => ({
  ...structuredClone(DEFAULTS),
  model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "chat", models: ["coder"] },
  autocomplete: { model: "coder" },
  ...patch,
})
const call = (body: unknown, cfg = config(), init: RequestInit = { method: "POST" }) =>
  handleCompletion(new Request("http://x/bobi/complete", { ...init, ...(init.method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }), {
    projectConfig: () => cfg,
    env: { BOBI_MODEL_API_KEY: apiKey },
    mask: createMasker([apiKey]),
  })

test("fill-in-the-middle through the endpoint: model, prefix, suffix, stop, key", async () => {
  const response = await call({ file: path.join(dir, "src", "add.ts"), prefix: `// token ${secret}\nfunction add(a, b) {\n  return `, suffix: "\n" })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ text: "a + b\n}", model: "coder" })
  const sent = mock.completions.at(-1)!
  expect(sent.body).toMatchObject({ model: "coder", suffix: "\n", max_tokens: 128, stop: ["\n\n\n"] })
  expect(sent.body.prompt).not.toContain(secret)
  expect(sent.headers.authorization).toBe(`Bearer ${apiKey}`)
})

test("single-line mode, maxTokens, and suffix overlap", async () => {
  const response = await call({ file: path.join(dir, "a.py"), prefix: "", suffix: "y = 2", multiline: false }, config({ autocomplete: { model: "coder", maxTokens: 20 } }))
  expect((await response.json()).text).toBe("x = 1")
  expect(mock.completions.at(-1)!.body).toMatchObject({ max_tokens: 20, stop: ["\n"] })
  expect(trimCompletion("foo(bar)", ")", false)).toBe("foo(bar")
  expect(trimCompletion("a\nb  \n", "", true)).toBe("a\nb")
  expect(trimCompletion("abc  ", "", false)).toBe("abc  ")
})

test("refusals: off, unknown model, protocol, .bobiignore, bad input", async () => {
  const file = path.join(dir, "a.ts")
  const cases: [Response, number, string][] = [
    [await call({ file, prefix: "x" }, config({ autocomplete: {} })), 409, "autocomplete is off"],
    [await call({ file, prefix: "x" }, config({ autocomplete: { model: "other" } })), 409, 'model "other" is not in model.models'],
    [await call({ file, prefix: "x" }, config({ model: { ...config().model, protocol: "anthropic" } })), 409, "OpenAI-compatible"],
    [await call({ file: path.join(dir, "secret", "key.ts"), prefix: "x" }), 403, ".bobiignore"],
    [await call({ file: "relative.ts", prefix: "x" }), 400, "absolute path"],
    [await call({ file, prefix: 1 }), 400, "prefix"],
    [await call("{not json"), 400, "JSON"],
    [await call(undefined, config(), { method: "GET" }), 405, "POST"],
  ]
  for (const [response, status, message] of cases) {
    expect(response.status).toBe(status)
    expect((await response.json()).error).toContain(message)
  }
  expect(mock.completions.every((c) => !c.body.prompt.includes("secret"))).toBe(true)
})

test("endpoint failures are reported as 502", async () => {
  const file = path.join(dir, "a.ts")
  const down = await call({ file, prefix: "x" }, config({ model: { ...config().model, baseURL: "http://127.0.0.1:1/v1" } }))
  expect(down.status).toBe(502)
  expect((await down.json()).error).toContain("not reachable")
  const opts = (fetchImpl: typeof fetch) => ({ projectConfig: () => config(), env: {}, mask: createMasker([]), fetch: fetchImpl })
  const request = () => new Request("http://x", { method: "POST", body: JSON.stringify({ file, prefix: "x" }) })
  const http500 = await handleCompletion(request(), opts((async () => new Response("no", { status: 500 })) as unknown as typeof fetch))
  expect((await http500.json()).error).toContain("HTTP 500")
  const empty = await handleCompletion(request(), opts((async () => Response.json({ choices: [] })) as unknown as typeof fetch))
  expect((await empty.json()).error).toContain("no completion")
  const notJson = await handleCompletion(request(), opts((async () => new Response("<html>")) as unknown as typeof fetch))
  expect(notJson.status).toBe(502)
})

test("the Bobi server serves the route behind its password, using the project's config", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "bobi-complete-home-"))
  const password = crypto.randomUUID()
  await writeFile(path.join(home, "config.jsonc"), JSON.stringify({ autocomplete: { model: "coder" } }))
  const server = await startBobiServer({
    config: config({ autocomplete: {} }),
    paths: bobiPaths({ BOBI_HOME: home }),
    password,
    browser: false,
    env: { BOBI_HOME: home, HOME: home, BOBI_MODEL_API_KEY: apiKey },
  })
  try {
    const body = JSON.stringify({ file: path.join(dir, "b.ts"), prefix: "let ", suffix: "" })
    expect((await fetch(`${server.url}${COMPLETE_PATH}`, { method: "POST", body })).status).toBe(401)
    const ok = await fetch(`${server.url}${COMPLETE_PATH}`, { method: "POST", body, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).text).toBe("x = 1\ny = 2")
  } finally {
    await server.stop()
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
