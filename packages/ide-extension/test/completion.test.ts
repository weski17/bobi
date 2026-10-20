import { expect, test } from "bun:test"
import { BobiApiError, BobiClient } from "../src/client.ts"
import { Completer, completionInput, MAX_PREFIX, MAX_SUFFIX } from "../src/completion.ts"

test("completionInput: bounded prefix/suffix; multi-line only at the end of a line", () => {
  expect(completionInput("const a = \nnext", 10, "/p/a.ts")).toEqual({ file: "/p/a.ts", prefix: "const a = ", suffix: "\nnext", multiline: true })
  expect(completionInput("foo(bar)", 4, "/p/a.ts").multiline).toBe(false)
  const long = "x".repeat(MAX_PREFIX + 10) + "y".repeat(MAX_SUFFIX + 10)
  const input = completionInput(long, MAX_PREFIX + 10, "/f")
  expect(input.prefix).toHaveLength(MAX_PREFIX)
  expect(input.suffix).toHaveLength(MAX_SUFFIX)
})

const noWait = { sleep: async () => {} }

test("Completer returns the suggestion and stops asking after the server says off", async () => {
  const calls: unknown[] = []
  let answer: { text?: string; off?: string; status: number } = { text: "a + b", status: 200 }
  const completer = new Completer({ complete: async (input) => (calls.push(input), answer) }, noWait)
  expect(await completer.complete("return ", 7, "/p/a.ts")).toBe("a + b")
  answer = { text: "", status: 200 }
  expect(await completer.complete("return ", 7, "/p/a.ts")).toBeUndefined()
  answer = { off: "ignored", status: 403 }
  expect(await completer.complete("x", 1, "/p/secret.ts")).toBeUndefined()
  expect(completer.off).toBeUndefined()
  answer = { off: "autocomplete is off", status: 409 }
  expect(await completer.complete("x", 1, "/p/a.ts")).toBeUndefined()
  expect(completer.off).toBe("autocomplete is off")
  const before = calls.length
  expect(await completer.complete("x", 1, "/p/a.ts")).toBeUndefined()
  expect(calls.length).toBe(before)
  completer.reset()
  answer = { text: "ok", status: 200 }
  expect(await completer.complete("x", 1, "/p/a.ts")).toBe("ok")
})

test("Completer drops outdated and cancelled requests and logs errors", async () => {
  const logs: string[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const completer = new Completer({ complete: async () => ({ text: "late", status: 200 }) }, { sleep: () => gate, log: (m) => logs.push(m) })
  const first = completer.complete("a", 1, "/f")
  const second = completer.complete("ab", 2, "/f")
  release()
  expect(await first).toBeUndefined()
  expect(await second).toBe("late")
  expect(await new Completer({ complete: async () => ({ text: "x", status: 200 }) }, noWait).complete("a", 1, "/f", () => true)).toBeUndefined()
  let cancel = false
  const racing = new Completer({ complete: async () => ((cancel = true), { text: "x", status: 200 }) }, noWait)
  expect(await racing.complete("a", 1, "/f", () => cancel)).toBeUndefined()
  const failing = new Completer({ complete: async () => Promise.reject(new Error("boom")) }, { ...noWait, log: (m) => logs.push(m) })
  expect(await failing.complete("a", 1, "/f")).toBeUndefined()
  const aborted = new Completer({ complete: async () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) }, { ...noWait, log: (m) => logs.push(m) })
  expect(await aborted.complete("a", 1, "/f")).toBeUndefined()
  expect(logs).toEqual(["Bobi autocomplete: boom"])
  expect(await new Completer({ complete: async () => ({ text: "d", status: 200 }) }, { delayMs: 1 }).complete("a", 1, "/f")).toBe("d")
})

test("BobiClient.complete maps server answers", async () => {
  const answers = [
    Response.json({ text: "x" }),
    Response.json({ error: "off" }, { status: 409 }),
    Response.json({ error: "ignored" }, { status: 403 }),
    new Response("broken", { status: 502 }),
    Response.json({}, { status: 409 }),
    Response.json({}),
  ]
  const seen: RequestInit[] = []
  const client = new BobiClient("http://bobi", "pw-0123456789abcdef", (async (_url: string, init: RequestInit) => (seen.push(init), answers.shift()!)) as unknown as typeof fetch)
  const input = { file: "/a", prefix: "p", suffix: "", multiline: true }
  expect(await client.complete(input)).toEqual({ text: "x", status: 200 })
  expect(JSON.parse(String(seen[0]!.body))).toEqual(input)
  expect(await client.complete(input)).toEqual({ off: "off", status: 409 })
  expect(await client.complete(input, new AbortController().signal)).toEqual({ off: "ignored", status: 403 })
  await expect(client.complete(input)).rejects.toThrow(BobiApiError)
  expect(await client.complete(input)).toEqual({ off: "autocomplete unavailable", status: 409 })
  expect(await client.complete(input)).toEqual({ text: "", status: 200 })
})

test("BobiClient.tips", async () => {
  const answers = [Response.json({ tips: [{ rule: "complexity", severity: "warning", message: "m", line: 1, endLine: 2 }] }), Response.json({}), Response.json({ error: "bad" }, { status: 400 }), new Response("x", { status: 500 })]
  const client = new BobiClient("http://bobi", "pw-0123456789abcdef", (async () => answers.shift()!) as unknown as typeof fetch)
  expect(await client.tips("/a.ts", "x", new AbortController().signal)).toHaveLength(1)
  expect(await client.tips("/a.ts", "x")).toEqual([])
  await expect(client.tips("/a.ts", "x")).rejects.toThrow("POST /bobi/tips: bad")
  await expect(client.tips("/a.ts", "x")).rejects.toThrow(BobiApiError)
})
