// `bobi dossier …` (ADR-0022, ADR-0026): seal, list and verify the signed change dossier of a session or of one task.
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createMasker, hashOf, loadOrCreateKey, readAuditLog, renderDossier, sealDossier, sessionsOf, tasksOf, verifyDossier, type AuditRecord, type Dossier, type ExtraEvent, type TaskSlice } from "@bobi/core"
import { bobiPaths } from "@bobi/server"
import { UsageError, type Command } from "./args.ts"
import type { Io } from "./app.ts"

type DossierCommand = Extract<Command, { kind: "dossier" }>
type SealCommand = Extract<DossierCommand, { action: "list" | "seal" }>

function verify(io: Io, command: Extract<DossierCommand, { action: "verify" }>): number {
  let dossier: Dossier
  try {
    dossier = JSON.parse(readFileSync(path.resolve(io.cwd, command.file), "utf8")) as Dossier
  } catch (error) {
    throw new UsageError(`cannot read ${command.file}: ${(error as Error).message}`)
  }
  const trusted = command.key ? readFileSync(path.resolve(io.cwd, command.key), "utf8") : undefined
  const result = verifyDossier(dossier, trusted)
  const scope = dossier.task === undefined ? `session ${dossier.session}` : `session ${dossier.session}, task ${dossier.task}`
  if (!result.ok) {
    io.err(`BROKEN: ${result.reason}${result.brokenAt === undefined ? "" : ` (at event ${result.brokenAt})`}`)
    return 1
  }
  if (result.trusted) {
    io.out(`intact: ${dossier.events.length} events, ${scope}, signed by the trusted key ${result.keyId}`)
    return 0
  }
  // Anyone can make a self-signed dossier that is "intact"; without the signer's key that proves nothing
  // (review 2026-11-19). Exit code 2: not broken, but not verified either.
  io.out(`NOT VERIFIED: the chain is intact (${dossier.events.length} events, ${scope}), but the signer was not checked; key ${result.keyId}. Pass --key <public-key.pem> to verify who signed it.`)
  return 2
}

const clip = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text).replace(/\s+/g, " ")

function list(io: Io, records: readonly AuditRecord[], dir: string, session: string | undefined): number {
  if (session) {
    const tasks = tasksOf(records, session)
    if (tasks.length === 0) throw new UsageError(`no audit records for session ${session}`)
    for (const t of tasks) io.out(`${String(t.index).padStart(3)}  ${new Date(t.start).toISOString().slice(0, 19)}Z  ${t.mode.padEnd(12)} ${t.records.length} records  ${clip(t.prompt)}`.trimEnd())
    return 0
  }
  const sessions = sessionsOf(records)
  if (sessions.length === 0) io.err(`bobi: no audit records in ${dir}`)
  for (const s of sessions) io.out(`${s.session}  ${new Date(s.start).toISOString().slice(0, 19)}Z  ${s.user}  ${s.tasks} tasks, ${s.records} records`)
  return 0
}

/** The task of `session` that `--task` names: a number (1-based) or `last`. */
function pickTask(records: readonly AuditRecord[], session: string, which: number | "last"): TaskSlice {
  const tasks = tasksOf(records, session)
  if (tasks.length === 0) throw new UsageError(`no audit records for session ${session}`)
  const task = which === "last" ? tasks[tasks.length - 1] : tasks[which - 1]
  if (!task) throw new UsageError(`session ${session} has ${tasks.length} task${tasks.length === 1 ? "" : "s"}, not ${which} (list them: bobi dossier --list --session ${session})`)
  return task
}

function testEvent(io: Io, command: string, mask: (text: string) => string): ExtraEvent {
  const began = Date.now()
  const r = spawnSync(command, { shell: true, cwd: io.cwd, encoding: "utf8", timeout: 600_000 })
  const output = mask(`${r.stdout ?? ""}${r.stderr ?? ""}`)
  return { kind: "test", time: Date.now(), fields: { command: mask(command), exit: r.status ?? -1, seconds: Math.round((Date.now() - began) / 100) / 10, output: hashOf(output).slice(0, 16), tail: output.slice(-400) } }
}

function diffEvent(io: Io, mask: (text: string) => string): ExtraEvent {
  const r = spawnSync("git", ["diff", "HEAD", "--no-color"], { cwd: io.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new UsageError(`git diff failed: ${(r.stderr ?? "").trim() || "not a git repository"}`)
  const diff = mask(r.stdout)
  return { kind: "diff", time: Date.now(), fields: { sha256: hashOf(diff), files: (diff.match(/^diff --git /gm) ?? []).length, diff: diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n… (cut)` : diff } }
}

function extrasFor(io: Io, command: SealCommand): ExtraEvent[] {
  const mask = createMasker([])
  const extras: ExtraEvent[] = []
  if (command.test) extras.push(testEvent(io, command.test, mask))
  if (command.diff) extras.push(diffEvent(io, mask))
  // The working tree is not recorded per task, so be clear about what the diff is.
  if (command.diff && command.task !== undefined) io.err("bobi: --diff is the project's uncommitted state now, not only the changes of this task")
  return extras
}

function seal(io: Io, records: readonly AuditRecord[], home: string, command: SealCommand): number {
  const session = command.session ?? sessionsOf(records)[0]?.session
  if (!session) throw new UsageError("no session to seal: the audit log is empty")
  const task = command.task === undefined ? undefined : pickTask(records, session, command.task)
  const key = loadOrCreateKey(path.join(home, "keys"))
  const dossier = sealDossier(task ? task.records : records, session, key, { extras: extrasFor(io, command), task: task?.index })
  if (command.out) {
    writeFileSync(path.resolve(io.cwd, command.out), `${JSON.stringify(dossier, null, 2)}\n`, { mode: 0o600 })
    io.err(`bobi: dossier written to ${command.out} (key ${dossier.keyId}); check it with: bobi dossier verify ${command.out}`)
  }
  io.out(command.format === "json" ? JSON.stringify(dossier, null, 2) : renderDossier(dossier))
  return 0
}

export function runDossier(io: Io, command: DossierCommand): number {
  if (command.action === "verify") return verify(io, command)
  const home = bobiPaths(io.env).home
  const { records } = readAuditLog(path.join(home, "audit"))
  return command.action === "list" ? list(io, records, path.join(home, "audit"), command.session) : seal(io, records, home, command)
}
