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
}, 30_000)
