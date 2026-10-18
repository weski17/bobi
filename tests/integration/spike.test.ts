// Spike: OpenCode SDK in-process + OpenAI-compatible mock model + real write tool.
// Verifies the Phase 0 architecture assumption before building @bobi/core on top of it.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode/sdk"
import { startMockModel, type MockModel } from "@bobi/mock-model"

let mock: MockModel
let dir: string

beforeAll(async () => {
  mock = startMockModel({ models: ["mock-model"] })
  dir = await mkdtemp(path.join(tmpdir(), "bobi-spike-"))
})
afterAll(async () => {
  await mock.stop()
  await rm(dir, { recursive: true, force: true })
})

test("agent loop calls the mock model, runs the write tool, and finishes", async () => {
  mock.enqueue({ toolCalls: [{ name: "write", arguments: { path: path.join(dir, "hello.txt"), content: "hi from bobi" } }] }, { text: "done" })
  const configDir = await mkdtemp(path.join(tmpdir(), "bobi-spike-config-"))
  await using opencode = await OpenCode.create({
    config: {
      directory: configDir,
      project: false,
      content: JSON.stringify({
        model: "bobi/mock-model",
        providers: {
          bobi: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: mock.baseURL, apiKey: "test" },
            models: { "mock-model": {} },
          },
        },
      }),
    },
    models: { fetch: false },
    fs: { filewatcher: false },
  })
  const session = await opencode.sessions.create({ location: { directory: dir } })
  await opencode.sessions.prompt({ sessionID: session.id, text: "create hello.txt" })
  await opencode.sessions.wait({ sessionID: session.id })

  expect(await readFile(path.join(dir, "hello.txt"), "utf8")).toBe("hi from bobi")
  expect(mock.requests.length).toBeGreaterThanOrEqual(2)
  expect(mock.requests[0]!.headers.authorization).toBe("Bearer test")
}, 60_000)
