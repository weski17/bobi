import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadOrCreateKey, promptText, renderDossier, sealDossier, sessionsOf, toolDetail, verifyDossier, type AuditRecord, type Dossier, type DossierEvent } from "../src/index.ts"

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
const seal = (extras = [] as Parameters<typeof sealDossier>[3]) => sealDossier(records, "s1", key(), extras, () => new Date("2026-11-03T09:00:00Z"))
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
  const forged = sealDossier(records, "s1", other, [], () => new Date("2026-11-03T09:00:00Z"))
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
