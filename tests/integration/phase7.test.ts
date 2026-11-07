// Phase 7: usage records (tasks, tokens) with person and team.
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHarness, pendingPermission, waitFor, type Harness } from "./harness.ts"

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

test("every task and every model step's tokens are audited with user, team and mode", async () => {
  h = await createHarness({ telemetry: { user: "anna", team: "payments" } })
  const sessionID = await h.promptIn("plan", "plan the release", { text: "Here is the plan." })
  await h.opencode.sessions.wait({ sessionID })
  const task = h.audit.records.find((r) => r.name === "bobi.task" && r.attributes["bobi.session"] === String(sessionID))
  expect(task?.attributes).toMatchObject({ "bobi.user": "anna", "bobi.team": "payments", "bobi.mode": "plan" })
  const usage = await (async () => {
    for (let i = 0; i < 100; i++) {
      const found = h!.audit.records.find((r) => r.name === "bobi.usage" && r.attributes["bobi.session"] === String(sessionID))
      if (found) return found
      await Bun.sleep(20)
    }
  })()
  expect(usage?.attributes).toMatchObject({ "bobi.mode": "plan", "bobi.team": "payments", "bobi.tokens.input": 10, "bobi.tokens.output": 5 })
  // The dossier and the model comparison need to know which model worked.
  expect(String(usage?.attributes["bobi.model"] ?? "")).not.toBe("")
}, 30_000)

test("with several projects open, each model step and each approval is audited once, with mode and model", async () => {
  h = await createHarness({})
  // A session in another project: the engine now runs Bobi's setup for two locations, and every instance's event
  // stream carries the events of both.
  const other = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-it-other-")))
  try {
    h.mock.enqueue({ text: "first" })
    const first = await h.opencode.sessions.create({ location: { directory: other }, agent: "ask" })
    await h.opencode.sessions.prompt({ sessionID: first.id, text: "hi" })
    await h.opencode.sessions.wait({ sessionID: first.id })

    const sessionID = await h.promptIn("code", "write x.txt", { toolCalls: [{ name: "write", arguments: { path: path.join(h.dir, "x.txt"), content: "x" } }] }, { text: "done" })
    const request = await pendingPermission(h, sessionID)
    await h.opencode.permission.reply({ sessionID, requestID: request.id, decision: "once" })
    await h.opencode.sessions.wait({ sessionID })
    // Wait for both steps, then give duplicates time to arrive before counting.
    await waitFor(async () => (h!.audit.records.filter((r) => r.name === "bobi.usage" && r.attributes["bobi.session"] === String(sessionID)).length >= 2 ? true : undefined))
    await Bun.sleep(300)

    const of = (name: string) => h!.audit.records.filter((r) => r.name === name && r.attributes["bobi.session"] === String(sessionID))
    // Two model steps (tool call, answer): two usage records, not four.
    expect(of("bobi.usage").map((r) => r.attributes["bobi.mode"])).toEqual(["code", "code"])
    for (const r of of("bobi.usage")) expect(r.attributes["bobi.model"]).toBe("mock-model")
    expect(of("bobi.approval").map((r) => `${r.attributes["bobi.result"]}:${r.attributes["bobi.mode"]}`)).toEqual(["once:code"])
  } finally {
    await rm(other, { recursive: true, force: true })
  }
}, 30_000)

test("sessions.titles local: the title comes from the first message and costs no model request", async () => {
  h = await createHarness({ sessions: { titles: "local" } })
  const sessionID = await h.promptIn("ask", "Erkläre src/checkout.ts bitte kurz", { text: "ok" })
  await h.opencode.sessions.wait({ sessionID })
  let title = ""
  for (let i = 0; i < 100 && !title.startsWith("Erkläre"); i++) {
    title = String(((await h.opencode.sessions.get({ sessionID })) as { title?: string }).title ?? "")
    await Bun.sleep(50)
  }
  expect(title).toBe("Erkläre src/checkout.ts bitte kurz")
  // Only the agent loop asked the model; no tool-less auxiliary request (title) was made.
  expect(h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) === 0)).toHaveLength(0)
}, 30_000)

test("sessions.titles model (default): the model is asked for the title", async () => {
  h = await createHarness({})
  const sessionID = await h.promptIn("ask", "Erkläre src/checkout.ts bitte kurz", { text: "ok" })
  await h.opencode.sessions.wait({ sessionID })
  for (let i = 0; i < 100 && h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) === 0).length === 0; i++) await Bun.sleep(50)
  expect(h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) === 0).length).toBeGreaterThan(0)
}, 30_000)

test("a model error (prompt larger than the model's context) ends the request with a failure instead of leaving it open", async () => {
  h = await createHarness({})
  const seen: string[] = []
  const stop = new AbortController()
  void (async () => {
    try {
      for await (const e of h!.opencode.event.subscribe({ signal: stop.signal } as never) as unknown as AsyncIterable<{ type: string }>) seen.push(e.type)
    } catch {
      // the stream ends with the harness
    }
  })()
  // Ollama answers 400 when the request does not fit; the chat relies on the execution ending (busy off, error shown).
  const sessionID = await h.promptIn("ask", "hi", { error: { status: 400, message: "request (4593 tokens) exceeds the available context size (4096 tokens)", type: "exceed_context_size_error" } })
  await waitFor(async () => (seen.includes("session.execution.failed") ? true : undefined), 15_000)
  stop.abort()
  await h.opencode.sessions.wait({ sessionID })
  expect(seen).toContain("session.step.failed")
  expect(seen).not.toContain("session.execution.succeeded")
}, 30_000)
