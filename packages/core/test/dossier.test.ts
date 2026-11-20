import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadOrCreateKey, promptText, renderDossier, sameKey, sealDossier, sessionsOf, tasksOf, toolDetail, verifyDossier, type AuditRecord, type Dossier, type DossierEvent } from "../src/index.ts"

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "bobi-dossier-"))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const at = Date.parse("2026-11-03T08:00:00Z")
const rec = (name: AuditRecord["name"], attributes: Partial<AuditRecord["attributes"]>, offset: number, session = "s1"): AuditRecord => ({
  name,
  start: at + offset,
  end: at + offset + 5,
  attributes: { "bobi.user": "anna", "bobi.mode": "code", "bobi.session": session, "bobi.result": "completed", ...attributes } as AuditRecord["attributes"],
})
const records = [
  rec("bobi.task", { "bobi.result": "started", "bobi.detail": "Fix the rounding in checkout" }, 0),
  rec("bobi.tool", { "bobi.tool": "read", "bobi.detail": "src/checkout.ts" }, 10),
  rec("bobi.approval", { "bobi.action": "edit", "bobi.resources": "src/checkout.ts", "bobi.result": "once" }, 20),
  rec("bobi.tool", { "bobi.tool": "edit", "bobi.detail": "src/checkout.ts" }, 30),
  rec("bobi.usage", { "bobi.model": "qwen3", "bobi.tokens.input": 100, "bobi.tokens.output": 40, "bobi.result": "recorded" }, 40),
  rec("bobi.tool", { "bobi.tool": "read" }, 50, "other"),
]
const key = () => loadOrCreateKey(path.join(temp(), "keys"))
const NOW = () => new Date("2026-11-03T09:00:00Z")
const seal = (extras = [] as NonNullable<Parameters<typeof sealDossier>[3]>["extras"]) => sealDossier(records, "s1", key(), { extras, now: NOW })
type Mutable = { -readonly [K in keyof Dossier]: K extends "events" ? DossierEvent[] : Dossier[K] }
const clone = (d: Dossier) => JSON.parse(JSON.stringify(d)) as Mutable

test("the key is created once, readable only by the user, and reused", () => {
  const dir = path.join(temp(), "keys")
  const a = loadOrCreateKey(dir)
  expect(statSync(path.join(dir, "dossier-ed25519.pem")).mode & 0o777).toBe(0o600)
  expect(loadOrCreateKey(dir).keyId).toBe(a.keyId)
})

test("seals only the records of the session, chained in time order", () => {
  const d = seal()
  expect(d.events.map((e) => e.kind)).toEqual(["task", "tool", "approval", "tool", "usage"])
  expect(d.events[0]!.prev).toBe("")
  expect(d.events[1]!.prev).toBe(d.events[0]!.hash)
  expect(d.head).toBe(d.events.at(-1)!.hash)
  expect(d.user).toBe("anna")
  expect(verifyDossier(d)).toMatchObject({ ok: true, trusted: false })
})

test("an unknown session cannot be sealed", () => {
  expect(() => sealDossier(records, "nope", key())).toThrow("no audit records for session nope")
})

test("any change to the content, order or length is detected", () => {
  const d = seal()
  const edited = clone(d)
  ;(edited.events[2]!.fields as Record<string, string>).result = "always"
  expect(verifyDossier(edited)).toMatchObject({ ok: false, brokenAt: 2, reason: "event 2 was changed" })

  const removedMiddle = clone(d)
  removedMiddle.events.splice(1, 1)
  expect(verifyDossier(removedMiddle).ok).toBe(false)

  const truncated = clone(d)
  truncated.events.pop()
  expect(verifyDossier(truncated).reason).toContain("removed from the end")

  const swapped = clone(d)
  ;[swapped.events[1], swapped.events[2]] = [swapped.events[2]!, swapped.events[1]!]
  expect(verifyDossier(swapped).ok).toBe(false)
})

test("a rehashed forgery fails the signature; a swapped key fails the key id", () => {
  const d = seal()
  const other = key()
  const forged = sealDossier(records, "s1", other, { now: NOW })
  // The attacker re-signs with their own key but keeps the original key id: refused.
  expect(verifyDossier({ ...forged, keyId: d.keyId }).reason).toContain("key id")
  // Valid signature of another key, but the verifier trusts only the original one.
  const trusted = verifyDossier(forged, d.publicKey)
  expect(trusted.ok).toBe(false)
  expect(trusted.reason).toContain("not the trusted key")
  expect(verifyDossier(d, d.publicKey)).toMatchObject({ ok: true, trusted: true })
  // Header fields are signed too.
  expect(verifyDossier({ ...d, user: "mallory" }).reason).toBe("the signature does not match")
  expect(verifyDossier({ ...d, sealedAt: "2020-01-01T00:00:00Z" }).ok).toBe(false)
  expect(verifyDossier({} as Dossier).reason).toBe("not a dossier")
})

test("malformed input is not a dossier instead of a crash; keys are compared in full (review 2026-11-19)", () => {
  for (const bad of [null, [], "x", 1]) expect(verifyDossier(bad as unknown as Dossier)).toMatchObject({ ok: false, reason: "not a dossier" })
  const a = key()
  const b = key()
  expect(sameKey(a.publicKey, a.publicKey)).toBe(true)
  expect(sameKey(a.publicKey, b.publicKey)).toBe(false)
  expect(sameKey("not a key", a.publicKey)).toBe(false)
})

test("extras (diff, test result) join the chain", () => {
  const d = seal([
    { kind: "test", time: at + 60, fields: { command: "bun test", exit: 0 } },
    { kind: "diff", time: at + 61, fields: { sha256: "ab".repeat(32), files: 1, diff: "-a\n+b" } },
  ])
  expect(d.events.slice(-2).map((e) => e.kind)).toEqual(["test", "diff"])
  expect(verifyDossier(d).ok).toBe(true)
  const text = renderDossier(d)
  expect(text).toContain("Integrity: intact")
  expect(text).toContain("Fix the rounding in checkout")
  expect(text).toContain("qwen3")
  expect(text).toContain("```diff")
})

test("the report names a broken dossier", () => {
  const d = clone(seal())
  ;(d.events[0]!.fields as Record<string, string>).prompt = "something else"
  expect(renderDossier(d)).toContain("BROKEN – event 0 was changed")
})

test("lists sessions newest first", () => {
  expect(sessionsOf(records).map((s) => s.session)).toEqual(["other", "s1"])
})

test("tool details: command, path, patch files; long text is cut", () => {
  expect(toolDetail("shell", { command: "bun test" })).toBe("bun test")
  expect(toolDetail("edit", { path: "src/a.ts", oldString: "secret" })).toBe("src/a.ts")
  expect(toolDetail("read", {})).toBeUndefined()
  expect(toolDetail("shell", { command: "x".repeat(900) })!.length).toBe(401)
  expect(toolDetail("patch", { patchText: "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch" })).toBe("src/a.ts")
})

test("prompt text from the shapes the engine may use", () => {
  expect(promptText({ prompt: "hi" })).toBe("hi")
  expect(promptText({ text: "hi" })).toBe("hi")
  expect(promptText({ parts: [{ type: "text", text: "a" }, { type: "file" }, { text: "b" }] })).toBe("a  b")
  expect(promptText({ prompt: { parts: [{ text: "x" }] } })).toBe("x")
  expect(promptText({ prompt: { text: "y" } })).toBe("y")
  expect(promptText({})).toBeUndefined()
  expect(promptText(null)).toBeUndefined()
})

// Two prompts in one session, plus a record that comes before the first task record and a record of another session.
const twoTasks = [
  rec("bobi.permission", { "bobi.action": "read", "bobi.result": "allow" }, -5),
  rec("bobi.task", { "bobi.result": "started", "bobi.detail": "First: fix rounding", "bobi.mode": "code" }, 0),
  rec("bobi.tool", { "bobi.tool": "edit", "bobi.detail": "a.ts" }, 10),
  rec("bobi.tool", { "bobi.tool": "read" }, 15, "other"),
  rec("bobi.task", { "bobi.result": "started", "bobi.detail": "Second: add a test", "bobi.mode": "plan" }, 100),
  rec("bobi.tool", { "bobi.tool": "write", "bobi.detail": "a.test.ts" }, 110),
  rec("bobi.usage", { "bobi.model": "qwen3", "bobi.tokens.input": 7, "bobi.tokens.output": 3, "bobi.result": "recorded" }, 120),
]

test("a session splits into tasks at every task record; earlier records belong to the first task", () => {
  const tasks = tasksOf(twoTasks, "s1")
  expect(tasks.map((t) => [t.index, t.mode, t.prompt, t.records.length])).toEqual([
    [1, "code", "First: fix rounding", 3],
    [2, "plan", "Second: add a test", 3],
  ])
  expect(tasks[0]!.records[0]!.name).toBe("bobi.permission")
  expect(tasks.flatMap((t) => t.records).every((r) => r.attributes["bobi.session"] === "s1")).toBe(true)
  expect(tasksOf(twoTasks, "other")).toHaveLength(1)
  expect(tasksOf(twoTasks, "nope")).toEqual([])
  expect(sessionsOf(twoTasks).find((s) => s.session === "s1")).toMatchObject({ tasks: 2, records: 6 })
})

test("records with the same time keep their written order", () => {
  const same = [rec("bobi.task", { "bobi.detail": "a" }, 0), rec("bobi.tool", { "bobi.tool": "x" }, 0), rec("bobi.task", { "bobi.detail": "b" }, 0), rec("bobi.tool", { "bobi.tool": "y" }, 0)]
  expect(tasksOf(same, "s1").map((t) => t.records.map((r) => r.attributes["bobi.tool"] ?? r.attributes["bobi.detail"]))).toEqual([["a", "x"], ["b", "y"]])
})

test("a task dossier holds only that task, carries the task number and verifies", () => {
  const k = key()
  const task2 = tasksOf(twoTasks, "s1")[1]!
  const d = sealDossier(task2.records, "s1", k, { now: NOW, task: task2.index })
  expect(d.task).toBe(2)
  expect(d.events.map((e) => e.kind)).toEqual(["task", "tool", "usage"])
  expect(verifyDossier(d, k.publicKey)).toMatchObject({ ok: true, trusted: true })
  expect(renderDossier(d)).toContain("session s1, task 2")
  expect(renderDossier(d)).toContain("Second: add a test")
  expect(renderDossier(d)).not.toContain("First: fix rounding")
})

test("the task number is signed: it cannot be added, removed or changed afterwards", () => {
  const k = key()
  const task1 = tasksOf(twoTasks, "s1")[0]!
  const taskDossier = sealDossier(task1.records, "s1", k, { now: NOW, task: 1 })
  const wrong = clone(taskDossier)
  wrong.task = 2
  expect(verifyDossier(wrong as Dossier).reason).toBe("the signature does not match")
  const removed = clone(taskDossier)
  delete removed.task
  expect(verifyDossier(removed as Dossier).reason).toBe("the signature does not match")
  // A whole-session dossier cannot be passed off as a task either.
  const whole = clone(sealDossier(twoTasks, "s1", k, { now: NOW }))
  whole.task = 1
  expect(verifyDossier(whole as Dossier).reason).toBe("the signature does not match")
})

test("a dossier sealed before tasks existed (no task field) still verifies", () => {
  const d = seal()
  expect(d.task).toBeUndefined()
  expect("task" in d).toBe(false)
  expect(verifyDossier(d).ok).toBe(true)
})
