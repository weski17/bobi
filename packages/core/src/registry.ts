// Signed registry (ADR-0023): skills and slash commands are packed into one JSON file that carries its files and an
// Ed25519 signature of the publisher. A registry is any folder of such files (file share, git checkout, artifact store).
// Installing needs a publisher key the user trusts; content, name, paths and size are checked before anything is written.
// Only text packages (Markdown prompts) are supported: MCP servers and IDE extensions execute code and need their own
// review (ADR-0023). Only node:crypto, no dependency.
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { canonical, hashOf, keyIdOf, sameKey } from "./dossier.ts"
import { findRevocation, manifestHash, RevocationStore, type Revocation } from "./revocation.ts"

export type PackageKind = "skill" | "command"

export type PackageManifest = {
  readonly format: 1
  readonly name: string
  readonly kind: PackageKind
  readonly version: string
  readonly description?: string
  /** Relative path inside the package → sha256 of the content. */
  readonly files: Readonly<Record<string, string>>
}

export type Package = {
  readonly manifest: PackageManifest
  /** Relative path → UTF-8 content. */
  readonly contents: Readonly<Record<string, string>>
  readonly signature: string
  readonly publicKey: string
  readonly keyId: string
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
export const MAX_FILES = 50
export const MAX_FILE_BYTES = 256 * 1024
export const MAX_PACKAGE_BYTES = 1024 * 1024

/** A path inside a package: relative, no `..`, no hidden or absolute parts, no odd characters. */
const SAFE_PATH = /^(?!.*(^|\/)\.)(?!.*\.\.)[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

export function checkVersion(version: string): boolean {
  return VERSION.test(version)
}

/** Compares versions "1.2.3"; positive when a is newer. */
export const compareVersions = (a: string, b: string) => {
  const x = a.split(".").map(Number)
  const y = b.split(".").map(Number)
  return (x[0]! - y[0]!) || (x[1]! - y[1]!) || (x[2]! - y[2]!)
}

function collect(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) throw new Error(`${path.relative(base, full)} is a symbolic link; packages contain plain files only`)
    if (stat.isDirectory()) collect(full, base, out)
    else if (stat.isFile()) out[path.relative(base, full).split(path.sep).join("/")] = readFileSync(full, "utf8")
  }
  return out
}

/** Packs a skill directory (with SKILL.md) or a command file (<name>.md) and signs it. */
export function packSource(source: string, version: string, key: { privateKey: KeyObject; publicKey: string; keyId: string }, description?: string): Package {
  if (!checkVersion(version)) throw new Error(`"${version}" is not a version like 1.0.0`)
  const stat = lstatSync(source)
  let kind: PackageKind
  let name: string
  let contents: Record<string, string>
  if (stat.isDirectory()) {
    kind = "skill"
    name = path.basename(path.resolve(source))
    contents = collect(source)
    if (!contents["SKILL.md"]) throw new Error("a skill directory needs a SKILL.md")
  } else if (stat.isFile() && source.endsWith(".md")) {
    kind = "command"
    name = path.basename(source, ".md")
    contents = { [`${name}.md`]: readFileSync(source, "utf8") }
  } else throw new Error("pack takes a skill directory or a command .md file")
  const manifest: PackageManifest = { format: 1, name, kind, version, ...(description ? { description } : {}), files: Object.fromEntries(Object.entries(contents).map(([f, c]) => [f, hashOf(c)])) }
  validate(manifest, contents)
  return { manifest, contents, signature: sign(null, Buffer.from(canonical(manifest)), key.privateKey).toString("base64"), publicKey: key.publicKey, keyId: key.keyId }
}

/** Structural checks shared by pack and install. Throws with the reason. */
function validate(manifest: PackageManifest, contents: Readonly<Record<string, string>>) {
  if (manifest?.format !== 1) throw new Error("not a Bobi package (format)")
  if (!NAME.test(manifest.name)) throw new Error(`invalid package name "${manifest.name}" (lowercase letters, digits, dashes)`)
  if (manifest.kind !== "skill" && manifest.kind !== "command") throw new Error(`unsupported package kind "${String(manifest.kind)}"`)
  if (!checkVersion(manifest.version)) throw new Error(`invalid version "${manifest.version}"`)
  const names = Object.keys(manifest.files)
  if (names.length === 0 || names.length > MAX_FILES) throw new Error(`a package has 1 to ${MAX_FILES} files`)
  let total = 0
  for (const file of names) {
    if (!SAFE_PATH.test(file)) throw new Error(`unsafe file path "${file}"`)
    const text = contents[file]
    if (typeof text !== "string") throw new Error(`file "${file}" is listed but has no content`)
    const size = Buffer.byteLength(text)
    if (size > MAX_FILE_BYTES) throw new Error(`file "${file}" is larger than ${MAX_FILE_BYTES / 1024} KB`)
    total += size
  }
  if (total > MAX_PACKAGE_BYTES) throw new Error("package is larger than 1 MB")
  if (Object.keys(contents).length !== names.length) throw new Error("package contains files that are not in the manifest")
  if (manifest.kind === "skill" && !manifest.files["SKILL.md"]) throw new Error("a skill needs a SKILL.md")
  if (manifest.kind === "command" && (names.length !== 1 || names[0] !== `${manifest.name}.md`)) throw new Error(`a command is exactly one file ${manifest.name}.md`)
}

export type PackageCheck = { readonly ok: boolean; readonly reason?: string; readonly keyId: string; readonly trusted: boolean }

/** Structure, file hashes and signature; `trustedKeys` are public-key PEMs of publishers the user trusts. */
export function verifyPackage(pkg: Package, trustedKeys: readonly string[] = []): PackageCheck {
  let keyId = ""
  const fail = (reason: string): PackageCheck => ({ ok: false, reason, keyId, trusted: false })
  try {
    keyId = keyIdOf(pkg.publicKey)
  } catch {
    return fail("the public key is not valid")
  }
  try {
    validate(pkg.manifest, pkg.contents)
  } catch (error) {
    return fail((error as Error).message)
  }
  if (keyId !== pkg.keyId) return fail("the key id does not match the public key")
  for (const [file, hash] of Object.entries(pkg.manifest.files)) if (hashOf(pkg.contents[file]!) !== hash) return fail(`file "${file}" was changed`)
  let valid = false
  try {
    valid = verify(null, Buffer.from(canonical(pkg.manifest)), createPublicKey(pkg.publicKey), Buffer.from(pkg.signature, "base64"))
  } catch {
    valid = false
  }
  if (!valid) return fail("the signature does not match")
  const trusted = trustedKeys.some((k) => sameKey(k, pkg.publicKey))
  return { ok: true, keyId, trusted }
}

export function parsePackage(text: string): Package {
  try {
    const pkg = JSON.parse(text) as Package
    if (!pkg || typeof pkg !== "object" || !pkg.manifest || !pkg.contents) throw new Error("missing parts")
    return pkg
  } catch (error) {
    throw new Error(`not a package file: ${(error as Error).message}`)
  }
}

/** Public keys the user trusts as publishers: <dir>/<keyId>.pem. */
export class PublisherStore {
  constructor(readonly dir: string) {}

  keys(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".pem"))
      .map((f) => readFileSync(path.join(this.dir, f), "utf8"))
  }

  add(publicKeyPem: string): string {
    const keyId = keyIdOf(publicKeyPem)
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    writeFileSync(path.join(this.dir, `${keyId}.pem`), publicKeyPem, { mode: 0o600 })
    return keyId
  }

  remove(keyId: string): boolean {
    const file = path.join(this.dir, `${keyId.replace(/[^a-f0-9]/g, "")}.pem`)
    if (!existsSync(file)) return false
    rmSync(file)
    return true
  }
}

export type InstalledRecord = { name: string; kind: PackageKind; version: string; keyId: string; installedAt: string; /** Absent in records written before revocation existed. */ manifestHash?: string }

/** Where a package goes: skills/<name>/…, commands/<name>.md under the Bobi home (or a project's .bobi). */
export function targetDir(root: string, pkg: PackageManifest): string {
  return pkg.kind === "skill" ? path.join(root, "skills", pkg.name) : path.join(root, "commands")
}

/**
 * Installs a verified package from a trusted publisher. Refuses revoked packages (also with `force`), unknown
 * publishers, downgrades and overwriting something that was not installed from a package (unless `force`). The files are written next to the target and renamed.
 */
export function installPackage(pkg: Package, root: string, trustedKeys: readonly string[], options: { force?: boolean; now?: () => Date; revocations?: readonly Revocation[] } = {}): InstalledRecord {
  const check = verifyPackage(pkg, trustedKeys)
  if (!check.ok) throw new Error(`refused: ${check.reason}`)
  if (!check.trusted) throw new Error(`refused: publisher key ${check.keyId} is not trusted (add it with: bobi registry trust <public-key.pem>)`)
  const hash = manifestHash(pkg.manifest)
  const revoked = findRevocation(options.revocations ?? [], { name: pkg.manifest.name, version: pkg.manifest.version, keyId: check.keyId, manifestHash: hash })
  if (revoked) throw new Error(`refused: ${pkg.manifest.name} ${pkg.manifest.version} is revoked (${revoked.reason})`)
  const ledger = path.join(root, "registry", "installed.json")
  const records: InstalledRecord[] = existsSync(ledger) ? (JSON.parse(readFileSync(ledger, "utf8")) as InstalledRecord[]) : []
  const previous = records.find((r) => r.name === pkg.manifest.name && r.kind === pkg.manifest.kind)
  const target = pkg.manifest.kind === "skill" ? targetDir(root, pkg.manifest) : path.join(targetDir(root, pkg.manifest), `${pkg.manifest.name}.md`)
  if (existsSync(target) && !previous && !options.force) throw new Error(`refused: ${target} exists and was not installed from a package (use --force to replace it)`)
  if (previous && compareVersions(pkg.manifest.version, previous.version) < 0 && !options.force) throw new Error(`refused: ${pkg.manifest.version} is older than the installed ${previous.version} (use --force to downgrade)`)
  if (previous && previous.keyId !== check.keyId && !options.force) throw new Error(`refused: ${pkg.manifest.name} was installed from publisher ${previous.keyId}, this one is signed by ${check.keyId} (use --force)`)

  if (pkg.manifest.kind === "skill") {
    const staging = `${target}.installing-${process.pid}`
    rmSync(staging, { recursive: true, force: true })
    for (const [file, text] of Object.entries(pkg.contents)) {
      const out = path.join(staging, file)
      mkdirSync(path.dirname(out), { recursive: true })
      writeFileSync(out, text)
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(path.dirname(target), { recursive: true })
    renameSync(staging, target)
  } else {
    mkdirSync(path.dirname(target), { recursive: true })
    const staging = `${target}.installing-${process.pid}`
    writeFileSync(staging, pkg.contents[`${pkg.manifest.name}.md`]!)
    renameSync(staging, target)
  }
  const record: InstalledRecord = { name: pkg.manifest.name, kind: pkg.manifest.kind, version: pkg.manifest.version, keyId: check.keyId, installedAt: (options.now?.() ?? new Date()).toISOString(), manifestHash: hash }
  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(ledger, `${JSON.stringify([...records.filter((r) => r !== previous), record], null, 2)}\n`)
  return record
}

export function installedPackages(root: string): InstalledRecord[] {
  const ledger = path.join(root, "registry", "installed.json")
  return existsSync(ledger) ? (JSON.parse(readFileSync(ledger, "utf8")) as InstalledRecord[]) : []
}

/** Installed packages that a revocation matches, with the entry that matched. */
export function revokedInstalled(root: string, revocations: readonly Revocation[]): { record: InstalledRecord; revocation: Revocation }[] {
  return installedPackages(root).flatMap((record) => {
    const revocation = findRevocation(revocations, record)
    return revocation ? [{ record, revocation }] : []
  })
}

/** Deletes an installed package's files and its ledger entry. Only what the ledger lists; nothing else is touched. */
export function removeInstalled(root: string, record: InstalledRecord) {
  // The ledger is a plain file the user can edit; never build a path from a name that is not a valid package name.
  if (!NAME.test(record.name)) throw new Error(`refusing to remove "${record.name}": not a valid package name`)
  const target = record.kind === "skill" ? path.join(root, "skills", record.name) : path.join(root, "commands", `${record.name}.md`)
  rmSync(target, { recursive: true, force: true })
  const ledger = path.join(root, "registry", "installed.json")
  writeFileSync(ledger, `${JSON.stringify(installedPackages(root).filter((r) => !(r.name === record.name && r.kind === record.kind)), null, 2)}\n`)
}

/** Finds a package in a registry folder: <dir>/<name>.bobipkg.json (newest version file wins for <name>-<version>). */
export function findInRegistry(dir: string, name: string): string | undefined {
  if (!existsSync(dir)) return undefined
  const candidates = readdirSync(dir).filter((f) => f === `${name}.bobipkg.json` || new RegExp(`^${name.replace(/[^a-z0-9-]/g, "")}-\\d+\\.\\d+\\.\\d+\\.bobipkg\\.json$`).test(f))
  const newest = candidates.sort((a, b) => compareVersions(a.replace(/^.*-(\d+\.\d+\.\d+)\.bobipkg\.json$/, "$1"), b.replace(/^.*-(\d+\.\d+\.\d+)\.bobipkg\.json$/, "$1")) || a.localeCompare(b)).at(-1)
  return newest ? path.join(dir, newest) : undefined
}

export function listRegistry(dir: string): { name: string; kind: PackageKind; version: string; description?: string; keyId: string; file: string }[] {
  if (!existsSync(dir)) return []
  const out: ReturnType<typeof listRegistry> = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".bobipkg.json")).sort()) {
    try {
      const pkg = parsePackage(readFileSync(path.join(dir, file), "utf8"))
      out.push({ name: pkg.manifest.name, kind: pkg.manifest.kind, version: pkg.manifest.version, description: pkg.manifest.description, keyId: pkg.keyId, file })
    } catch {
      // not a package; skipped
    }
  }
  return out
}

/**
 * Names of installed packages that a known revocation matches, per kind. They are not loaded, even before the user ran
 * `bobi registry check --remove` (review 2026-11-19: revocation was only enforced on install). A damaged store counts as
 * "cannot tell" and blocks every registry package, never as "nothing revoked".
 */
export function revokedNames(roots: readonly string[], storeDir: string): { skill: Set<string>; command: Set<string> } {
  const out = { skill: new Set<string>(), command: new Set<string>() }
  for (const root of roots) {
    let hits: ReturnType<typeof revokedInstalled>
    try {
      hits = revokedInstalled(root, new RevocationStore(storeDir).entries())
    } catch {
      hits = installedPackages(root).map((record) => ({ record, revocation: { reason: "revocation list damaged" } as never }))
    }
    for (const { record } of hits) out[record.kind].add(record.name)
  }
  return out
}
