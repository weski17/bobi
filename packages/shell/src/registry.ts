// `bobi registry …` (ADR-0023, ADR-0025): packing, trusting, installing and revoking signed skills and slash commands.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { findProjectRoot } from "@bobi/config"
import {
  findInRegistry,
  installedPackages,
  installPackage,
  listRegistry,
  loadOrCreateKey,
  manifestHash,
  packSource,
  parsePackage,
  parseRevocations,
  PublisherStore,
  removeInstalled,
  RevocationStore,
  REVOCATION_FILE,
  revokedInstalled,
  signRevocations,
  verifyPackage,
  verifyRevocations,
  type Revocation,
} from "@bobi/core"
import { bobiPaths } from "@bobi/server"
import { UsageError, type Command } from "./args.ts"
import type { Io } from "./app.ts"

type RegistryCommand = Extract<Command, { kind: "registry" }>
type Ctx = { io: Io; home: string; publishers: PublisherStore; revocations: RevocationStore }

const publisherKey = (home: string) => loadOrCreateKey(path.join(home, "keys"), "publisher-ed25519.pem")

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

function read(io: Io, file: string): string {
  try {
    return readFileSync(path.resolve(io.cwd, file), "utf8")
  } catch (error) {
    throw new UsageError(`cannot read ${file}: ${(error as Error).message}`)
  }
}

/**
 * Takes over the revocation list of a registry folder, if there is one. A list that does not verify is an error: an
 * install must not go ahead as if nothing were revoked.
 */
function syncRevocations(ctx: Ctx, from: string | undefined): string | undefined {
  if (!from) return undefined
  const file = path.join(path.resolve(ctx.io.cwd, from), REVOCATION_FILE)
  if (!existsSync(file)) return undefined
  const result = guard(() => ctx.revocations.merge(parseRevocations(read(ctx.io, file)), ctx.publishers.keys()))
  return `revocation list ${path.relative(ctx.io.cwd, file) || file}: serial ${result.serial}, ${result.entries} entries`
}

function pack(ctx: Ctx, command: Extract<RegistryCommand, { action: "pack" }>): number {
  const pkg = guard(() => packSource(path.resolve(ctx.io.cwd, command.source), command.version, publisherKey(ctx.home), command.description))
  const dir = path.resolve(ctx.io.cwd, command.out ?? ".")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${pkg.manifest.name}-${pkg.manifest.version}.bobipkg.json`)
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  ctx.io.out(`${path.relative(ctx.io.cwd, file) || file}  (${pkg.manifest.kind} ${pkg.manifest.name} ${pkg.manifest.version}, ${Object.keys(pkg.contents).length} files, publisher ${pkg.keyId})`)
  return 0
}

function list(ctx: Ctx, command: Extract<RegistryCommand, { action: "list" }>): number {
  if (command.from) for (const p of listRegistry(path.resolve(ctx.io.cwd, command.from))) ctx.io.out(`${p.name.padEnd(24)} ${p.version.padEnd(8)} ${p.kind.padEnd(8)} ${p.keyId}  ${p.description ?? ""}`.trimEnd())
  else for (const r of installedPackages(ctx.home)) ctx.io.out(`${r.name.padEnd(24)} ${r.version.padEnd(8)} ${r.kind.padEnd(8)} ${r.keyId}  ${r.installedAt.slice(0, 10)}`)
  return 0
}

function verify(ctx: Ctx, command: { target: string }): number {
  const pkg = guard(() => parsePackage(read(ctx.io, command.target)))
  const check = verifyPackage(pkg, ctx.publishers.keys())
  if (!check.ok) ctx.io.err(`BROKEN: ${check.reason}`)
  else {
    ctx.io.out(`intact, signed by ${check.keyId} (${check.trusted ? "a trusted publisher" : "NOT a trusted publisher – install would be refused"})`)
    ctx.io.out(`manifest sha256:${manifestHash(pkg.manifest)}  (for: bobi registry revoke --hash)`)
  }
  return check.ok ? 0 : 1
}

function install(ctx: Ctx, command: Extract<RegistryCommand, { action: "install" }>): number {
  const { io } = ctx
  const note = syncRevocations(ctx, command.from)
  if (note) io.err(`bobi: ${note}`)
  const file = command.from && !/\.bobipkg\.json$/.test(command.target) ? findInRegistry(path.resolve(io.cwd, command.from), command.target) : path.resolve(io.cwd, command.target)
  if (!file) throw new UsageError(`no package "${command.target}" in ${command.from}`)
  const root = command.project ? path.join(findProjectRoot(io.cwd), ".bobi") : ctx.home
  const record = guard(() => installPackage(guard(() => parsePackage(read(io, file))), root, ctx.publishers.keys(), { force: command.force, revocations: ctx.revocations.entries() }))
  io.out(`installed ${record.kind} ${record.name} ${record.version} (publisher ${record.keyId}) in ${root}`)
  if (command.project) io.err("bobi: project packages are used only while the project is trusted")
  return 0
}

/** Signs a revocation and adds it to the list in `--out` (default: here). Only the signer of the list may extend it. */
function revoke(ctx: Ctx, command: Extract<RegistryCommand, { action: "revoke" }>): number {
  const { io } = ctx
  const key = publisherKey(ctx.home)
  const dir = path.resolve(io.cwd, command.out ?? ".")
  const file = path.join(dir, REVOCATION_FILE)
  const entry: Revocation = {
    ...(command.name ? { name: command.name } : {}),
    ...(command.version ? { version: command.version } : {}),
    ...(command.keyId ? { keyId: command.keyId } : {}),
    ...(command.hash ? { manifestHash: command.hash.replace(/^sha256:/, "") } : {}),
    reason: command.reason,
    revokedAt: new Date().toISOString(),
  }
  const previous = existsSync(file) ? guard(() => parseRevocations(read(io, file))) : undefined
  if (previous) {
    const check = verifyRevocations(previous, [key.publicKey])
    if (!check.ok) throw new UsageError(`${file} cannot be extended: ${check.reason}`)
  }
  const list = guard(() => signRevocations([...(previous?.entries ?? []), entry], (previous?.serial ?? 0) + 1, key))
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
  // The publisher's own machine honours the revocation at once.
  guard(() => ctx.revocations.merge(list, [key.publicKey]))
  io.out(`${path.relative(io.cwd, file) || file}  (serial ${list.serial}, ${list.entries.length} entries, signed by ${key.keyId})`)
  io.err("bobi: publish this file in the registry folder; others pick it up with `bobi registry check --from <folder>` and on every install from it")
  return 0
}

/** Reports installed packages that a revocation matches; `--remove` deletes them. Exit 1 when revoked packages remain. */
function check(ctx: Ctx, command: Extract<RegistryCommand, { action: "check" }>): number {
  const { io } = ctx
  const note = syncRevocations(ctx, command.from)
  if (note) io.out(note)
  else if (command.from) io.err(`bobi: no ${REVOCATION_FILE} in ${command.from}; checking against the revocations already known`)
  const entries = ctx.revocations.entries()
  const roots = [ctx.home, ...(command.project ? [path.join(findProjectRoot(io.cwd), ".bobi")] : [])]
  let remaining = 0
  for (const root of roots) {
    for (const { record, revocation } of revokedInstalled(root, entries)) {
      io.out(`REVOKED ${record.kind} ${record.name} ${record.version} in ${root}: ${revocation.reason}`)
      if (command.remove) {
        guard(() => removeInstalled(root, record))
        io.out(`  removed`)
      } else remaining++
    }
  }
  if (remaining === 0) io.out(command.remove ? "no revoked package left installed" : "no installed package is revoked")
  return remaining ? 1 : 0
}

export function runRegistry(io: Io, command: RegistryCommand): number {
  const home = bobiPaths(io.env).home
  const ctx: Ctx = { io, home, publishers: new PublisherStore(path.join(home, "publishers")), revocations: new RevocationStore(path.join(home, "registry")) }
  switch (command.action) {
    case "key": {
      const key = publisherKey(home)
      io.err(`bobi: your publisher key id is ${key.keyId}; give this public key to everyone who should trust your packages`)
      io.out(key.publicKey.trim())
      return 0
    }
    case "trust":
      io.out(`trusted publisher ${guard(() => ctx.publishers.add(read(io, command.target)))}`)
      return 0
    case "untrust":
      if (!ctx.publishers.remove(command.target)) throw new UsageError(`no trusted publisher ${command.target}`)
      io.out(`removed publisher ${command.target}`)
      return 0
    case "pack":
      return pack(ctx, command)
    case "list":
      return list(ctx, command)
    case "verify":
      return verify(ctx, command)
    case "install":
      return install(ctx, command)
    case "revoke":
      return revoke(ctx, command)
    case "check":
      return check(ctx, command)
  }
}
