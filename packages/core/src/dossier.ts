// Change dossier (ADR-0022): the audit records of one session become a hash chain that is signed with the user's
// Ed25519 key. Anyone with the dossier can check that nothing was added, removed, reordered or edited afterwards.
// The signature proves the dossier is unchanged since it was sealed; who the key belongs to is only known when the
// verifier compares the key id with a key it trusts (`verifyDossier(..., trustedPublicKey)`).
// Only node:crypto, no dependency.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AuditRecord } from "./audit.ts"

export type DossierEvent = {
  readonly seq: number
  /** ISO time (UTC). */
  readonly time: string
  /** task | tool | permission | approval | usage, or what the sealer adds: diff, test. */
  readonly kind: string
  readonly fields: Readonly<Record<string, string | number>>
  /** Hash of the previous event ("" for the first). */
  readonly prev: string
  readonly hash: string
}

export type Dossier = {
  readonly version: 1
  readonly session: string
  readonly user: string
  readonly sealedAt: string
  readonly events: readonly DossierEvent[]
  /** Hash of the last event. */
  readonly head: string
  /** Ed25519 signature (base64) over canonical({version, session, user, sealedAt, count, head}). */
  readonly signature: string
  /** SPKI PEM of the signing key. */
  readonly publicKey: string
  readonly keyId: string
}

export type ExtraEvent = { readonly kind: string; readonly time?: number; readonly fields: Record<string, string | number> }

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

/** JSON with sorted keys, so the same data always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export const hashOf = (text: string) => sha256(text)

const eventHash = (e: Pick<DossierEvent, "seq" | "time" | "kind" | "fields" | "prev">) => sha256(canonical({ seq: e.seq, time: e.time, kind: e.kind, fields: e.fields, prev: e.prev }))

/** The signing key of a user: created once, private part readable only by the user. */
export function loadOrCreateKey(dir: string, name = "dossier-ed25519.pem"): { privateKey: KeyObject; publicKey: string; keyId: string } {
  const file = path.join(dir, name)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const { privateKey } = generateKeyPairSync("ed25519")
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 })
  }
  const privateKey = createPrivateKey(readFileSync(file))
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString()
  return { privateKey, publicKey, keyId: keyIdOf(publicKey) }
}

export const keyIdOf = (publicKeyPem: string) => sha256(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }).toString("base64")).slice(0, 16)

const FIELDS: Record<string, (a: AuditRecord["attributes"]) => Record<string, string | number | undefined>> = {
  task: (a) => ({ mode: a["bobi.mode"], result: a["bobi.result"], prompt: a["bobi.detail"] }),
  tool: (a) => ({ mode: a["bobi.mode"], tool: a["bobi.tool"], result: a["bobi.result"], detail: a["bobi.detail"], error: a["bobi.error"] }),
  permission: (a) => ({ mode: a["bobi.mode"], action: a["bobi.action"], resources: a["bobi.resources"], result: a["bobi.result"] }),
  approval: (a) => ({ mode: a["bobi.mode"], action: a["bobi.action"], resources: a["bobi.resources"], result: a["bobi.result"] }),
  usage: (a) => ({ mode: a["bobi.mode"], model: a["bobi.model"], input: a["bobi.tokens.input"], output: a["bobi.tokens.output"], reasoning: a["bobi.tokens.reasoning"] }),
}

const clean = (fields: Record<string, string | number | undefined>): Record<string, string | number> =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number>

/** The sessions in the records, newest first, with their first time and user. */
export function sessionsOf(records: readonly AuditRecord[]): { session: string; user: string; start: number; records: number }[] {
  const out = new Map<string, { session: string; user: string; start: number; records: number }>()
  for (const r of records) {
    const id = r.attributes["bobi.session"]
    const row = out.get(id)
    if (row) {
      row.start = Math.min(row.start, r.start)
      row.records++
    } else out.set(id, { session: id, user: r.attributes["bobi.user"], start: r.start, records: 1 })
  }
  return [...out.values()].sort((a, b) => b.start - a.start)
}

/** Chains the records of `session` (plus extra events such as the diff and the test result) and signs the head. */
export function sealDossier(
  records: readonly AuditRecord[],
  session: string,
  key: { privateKey: KeyObject; publicKey: string; keyId: string },
  extras: readonly ExtraEvent[] = [],
  now: () => Date = () => new Date(),
): Dossier {
  const mine = records.filter((r) => r.attributes["bobi.session"] === session).sort((a, b) => a.start - b.start)
  if (mine.length === 0) throw new Error(`no audit records for session ${session}`)
  const raw = [
    ...mine.map((r) => ({ time: r.start, kind: r.name.replace(/^bobi\./, ""), fields: clean(FIELDS[r.name.replace(/^bobi\./, "")]?.(r.attributes) ?? { result: r.attributes["bobi.result"] }) })),
    ...extras.map((e) => ({ time: e.time ?? now().getTime(), kind: e.kind, fields: clean(e.fields) })),
  ].sort((a, b) => a.time - b.time)
  const events: DossierEvent[] = []
  let prev = ""
  raw.forEach((e, seq) => {
    const body = { seq, time: new Date(e.time).toISOString(), kind: e.kind, fields: e.fields, prev }
    const hash = eventHash(body)
    events.push({ ...body, hash })
    prev = hash
  })
  const header = { version: 1 as const, session, user: mine[0]!.attributes["bobi.user"], sealedAt: now().toISOString(), count: events.length, head: prev }
  const signature = sign(null, Buffer.from(canonical(header)), key.privateKey).toString("base64")
  return { version: 1, session, user: header.user, sealedAt: header.sealedAt, events, head: prev, signature, publicKey: key.publicKey, keyId: key.keyId }
}

export type Verification = { readonly ok: boolean; readonly reason?: string; readonly brokenAt?: number; readonly keyId: string; readonly trusted: boolean }

/**
 * Recomputes the chain and checks the signature. `trustedPublicKey` (PEM) pins who may have signed; without it the
 * result only says the dossier is intact, and `trusted` is false.
 */
export function verifyDossier(d: Dossier, trustedPublicKey?: string): Verification {
  const keyId = (() => {
    try {
      return keyIdOf(d.publicKey)
    } catch {
      return ""
    }
  })()
  const fail = (reason: string, brokenAt?: number): Verification => ({ ok: false, reason, brokenAt, keyId, trusted: false })
  if (d?.version !== 1 || !Array.isArray(d.events) || typeof d.signature !== "string") return fail("not a dossier")
  if (!keyId || keyId !== d.keyId) return fail("the key id does not match the public key")
  let prev = ""
  for (const [i, e] of d.events.entries()) {
    if (e.seq !== i) return fail(`event ${i} is out of order`, i)
    if (e.prev !== prev) return fail(`event ${i} does not follow event ${i - 1}`, i)
    if (e.hash !== eventHash(e)) return fail(`event ${i} was changed`, i)
    prev = e.hash
  }
  if (prev !== d.head) return fail("events were removed from the end (head does not match)", d.events.length)
  const header = { version: 1, session: d.session, user: d.user, sealedAt: d.sealedAt, count: d.events.length, head: d.head }
  let valid = false
  try {
    valid = verify(null, Buffer.from(canonical(header)), createPublicKey(d.publicKey), Buffer.from(d.signature, "base64"))
  } catch {
    valid = false
  }
  if (!valid) return fail("the signature does not match")
  const trusted = trustedPublicKey !== undefined && keyIdOf(trustedPublicKey) === keyId
  if (trustedPublicKey !== undefined && !trusted) return fail(`signed with key ${keyId}, which is not the trusted key`)
  return { ok: true, keyId, trusted }
}

const cell = (v: string | number | undefined) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")

export function renderDossier(d: Dossier, verification: Verification = verifyDossier(d)): string {
  const tools = d.events.filter((e) => e.kind === "tool")
  const approvals = d.events.filter((e) => e.kind === "approval")
  const models = [...new Set(d.events.map((e) => e.fields.model).filter((m): m is string => typeof m === "string"))]
  const tokens = d.events.reduce((n, e) => n + (Number(e.fields.input) || 0) + (Number(e.fields.output) || 0), 0)
  const lines = [
    `# Change dossier – session ${d.session}`,
    "",
    `- User: ${d.user}`,
    `- Sealed: ${d.sealedAt}`,
    `- Models: ${models.join(", ") || "not recorded"}`,
    `- Tokens: ${tokens}`,
    `- Tool calls: ${tools.length} (${tools.filter((e) => e.fields.result === "error").length} failed)`,
    `- Approvals: ${approvals.length} (${approvals.filter((e) => e.fields.result === "reject").length} rejected)`,
    `- Integrity: ${verification.ok ? (verification.trusted ? "intact, signed with the trusted key" : "intact, key not checked against a trusted key") : `BROKEN – ${verification.reason}`}`,
    `- Key: ${d.keyId}`,
    `- Head: ${d.head}`,
    "",
    "| # | Time | Kind | Mode | What | Result |",
    "|---|---|---|---|---|---|",
  ]
  for (const e of d.events) {
    const f = e.fields
    const what = e.kind === "task" ? f.prompt : e.kind === "tool" ? `${f.tool ?? ""} ${f.detail ?? ""}` : e.kind === "usage" ? `${f.model ?? ""} in ${f.input ?? 0} / out ${f.output ?? 0}` : e.kind === "test" ? `${f.command ?? ""}` : e.kind === "diff" ? `diff sha256:${String(f.sha256 ?? "").slice(0, 12)} (${f.files ?? 0} files)` : `${f.action ?? ""} ${f.resources ?? ""}`
    lines.push(`| ${e.seq} | ${e.time.slice(11, 19)} | ${e.kind} | ${cell(f.mode)} | ${cell(what).trim()} | ${cell(f.result ?? f.exit)} |`)
  }
  const diff = d.events.find((e) => e.kind === "diff")
  if (typeof diff?.fields.diff === "string") lines.push("", "## Diff", "", "```diff", diff.fields.diff, "```")
  return `${lines.join("\n")}\n`
}
