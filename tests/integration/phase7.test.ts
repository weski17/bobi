// Phase 7: usage records (tasks, tokens) with person and team.
import { afterEach, expect, test } from "bun:test"
import { createHarness, type Harness } from "./harness.ts"

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
