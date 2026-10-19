import { afterEach, describe, expect, test } from "bun:test"
import { startMockModel, type MockModel } from "../src/index.ts"

let mock: MockModel | undefined
afterEach(async () => {
  await mock?.stop()
  mock = undefined
})

const agentTools = [{ type: "function", function: { name: "read" } }]

const chat = (m: MockModel, body: Record<string, unknown>) =>
  fetch(`${m.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", messages: [{ role: "user", content: "hi" }], tools: agentTools, ...body }),
  })

describe("mock model", () => {
  test("lists models", async () => {
    mock = startMockModel({ models: ["a", "b"] })
    const res = (await (await fetch(`${mock.baseURL}/models`)).json()) as { data: { id: string }[] }
    expect(res.data.map((m) => m.id)).toEqual(["a", "b"])
  })

  test("returns scripted turns in order, then the fallback", async () => {
    mock = startMockModel({ script: [{ text: "first" }, { text: "second" }], fallback: { text: "rest" } })
    const texts: string[] = []
    for (let i = 0; i < 3; i++) {
      const res = (await (await chat(mock, {})).json()) as { choices: { message: { content: string } }[] }
      texts.push(res.choices[0]!.message.content)
    }
    expect(texts).toEqual(["first", "second", "rest"])
    expect(mock.requests).toHaveLength(3)
  })

  test("returns tool calls with finish_reason tool_calls", async () => {
    mock = startMockModel({ script: [{ toolCalls: [{ name: "read", arguments: { path: "a.txt" } }] }] })
    const res = (await (await chat(mock, {})).json()) as {
      choices: { finish_reason: string; message: { tool_calls: { function: { name: string; arguments: string } }[] } }[]
    }
    expect(res.choices[0]!.finish_reason).toBe("tool_calls")
    expect(res.choices[0]!.message.tool_calls[0]!.function).toEqual({ name: "read", arguments: '{"path":"a.txt"}' })
  })

  test("streams text and tool calls as server-sent events", async () => {
    mock = startMockModel({ script: [{ text: "a streamed answer that is longer than one chunk", toolCalls: [{ name: "grep", arguments: { q: "x" } }] }] })
    const body = await (await chat(mock, { stream: true })).text()
    const events = body
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice(6)) as { choices: { delta: { content?: string; tool_calls?: { function: { name: string } }[] }; finish_reason: string | null }[] })
    const text = events.map((e) => e.choices[0]!.delta.content ?? "").join("")
    expect(text).toBe("a streamed answer that is longer than one chunk")
    expect(events.some((e) => e.choices[0]!.delta.tool_calls?.[0]?.function.name === "grep")).toBe(true)
    expect(events.at(-1)!.choices[0]!.finish_reason).toBe("tool_calls")
    expect(body.trim().endsWith("data: [DONE]")).toBe(true)
  })

  test("records headers so tests can assert auth is forwarded", async () => {
    mock = startMockModel()
    await fetch(`${mock.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key" },
      body: JSON.stringify({ model: "m", messages: [] }),
    })
    expect(mock.requests[0]!.headers.authorization).toBe("Bearer test-key")
  })

  test("answers requests without tools from the auxiliary turn without consuming the script", async () => {
    mock = startMockModel({ script: [{ text: "agent" }], auxiliary: { text: "a title" } })
    const aux = (await (await chat(mock, { tools: [] })).json()) as { choices: { message: { content: string } }[] }
    const agent = (await (await chat(mock, {})).json()) as { choices: { message: { content: string } }[] }
    expect(aux.choices[0]!.message.content).toBe("a title")
    expect(agent.choices[0]!.message.content).toBe("agent")
  })

  test("clear drops unconsumed turns", async () => {
    mock = startMockModel({ script: [{ text: "stale" }], fallback: { text: "fresh" } })
    mock.clear()
    const res = (await (await chat(mock, {})).json()) as { choices: { message: { content: string } }[] }
    expect(res.choices[0]!.message.content).toBe("fresh")
  })

  test("answers 404 for unknown routes", async () => {
    mock = startMockModel()
    expect((await fetch(`${mock.url}/nope`)).status).toBe(404)
  })
})
