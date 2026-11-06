// Revocation list for the signed registry (ADR-0025): a trusted publisher signs a list of packages, versions or whole
// publisher keys that must no longer be installed or used. Bobi keeps the verified entries locally; a list with a lower
// serial than one already seen is refused, so an old list cannot be put back to "un-revoke" something (rollback).
// Revoking only ever removes trust, so any trusted publisher may revoke anything; whoever is trusted is trusted anyway.
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { canonical, hashOf, keyIdOf } from "./dossier.ts"
import type { PackageManifest } from "./registry.ts"

export const REVOCATION_FILE = "revocations.bobirev.json"

export type Revocation = {
  /** Selectors: every one that is given must match. At least one is required; `version` needs `name`. */
  readonly name?: string
  readonly version?: string
  /** Publisher key id: revokes everything signed with that key. */
  readonly keyId?: string
  /** sha256 of the canonical manifest: exactly one package build. */
  readonly manifestHash?: string
  readonly reason: string
  readonly revokedAt: string
}

export type RevocationList = {
  readonly format: 1
  /** Grows with every new list of the same signer. */
  readonly serial: number
  readonly entries: readonly Revocation[]
  readonly signature: string
  readonly publicKey: string
  readonly keyId: string
}

export const manifestHash = (manifest: PackageManifest) => hashOf(canonical(manifest))

const REASON_MAX = 400

/** Throws with the reason when an entry cannot be used safely. */
export function checkRevocation(entry: Revocation) {
  if (!entry || typeof entry !== "object") throw new Error("revocation entry is not an object")
  if (!entry.name && !entry.keyId && !entry.manifestHash) throw new Error("a revocation needs a name, a key id or a manifest hash")
  if (entry.version && !entry.name) throw new Error("a revocation with a version needs the package name")
  if (typeof entry.reason !== "string" || !entry.reason.trim()) throw new Error("a revocation needs a reason")
  if (entry.reason.length > REASON_MAX) throw new Error(`the reason is longer than ${REASON_MAX} characters`)
  if (typeof entry.revokedAt !== "string" || Number.isNaN(Date.parse(entry.revokedAt))) throw new Error("revokedAt is not a date")
}

const signedPart = (list: Pick<RevocationList, "format" | "serial" | "entries" | "keyId">) => canonical({ format: list.format, serial: list.serial, entries: list.entries, keyId: list.keyId })

export function signRevocations(entries: readonly Revocation[], serial: number, key: { privateKey: KeyObject; publicKey: string; keyId: string }): RevocationList {
  if (!Number.isInteger(serial) || serial < 1) throw new Error("serial must be a positive integer")
  for (const e of entries) checkRevocation(e)
  const body = { format: 1 as const, serial, entries: entries.map((e) => ({ ...e })), keyId: key.keyId }
  return { format: 1, serial, entries: body.entries, signature: sign(null, Buffer.from(signedPart(body)), key.privateKey).toString("base64"), publicKey: key.publicKey, keyId: key.keyId }
}

export function parseRevocations(text: string): RevocationList {
  try {
    const list = JSON.parse(text) as RevocationList
    if (!list || typeof list !== "object" || list.format !== 1 || !Array.isArray(list.entries) || !Number.isInteger(list.serial)) throw new Error("missing parts")
    return list
  } catch (error) {
    throw new Error(`not a revocation list: ${(error as Error).message}`)
  }
}

/** Structure, signature and signer. The signer must be one of `trustedKeys` (public-key PEMs). */
export function verifyRevocations(list: RevocationList, trustedKeys: readonly string[]): { ok: boolean; reason?: string; keyId: string } {
  let keyId = ""
  const fail = (reason: string) => ({ ok: false, reason, keyId })
  try {
    keyId = keyIdOf(list.publicKey)
  } catch {
    return fail("the public key is not valid")
  }
  if (keyId !== list.keyId) return fail("the key id does not match the public key")
  if (list.serial < 1) return fail("serial must be a positive integer")
  try {
    for (const e of list.entries) checkRevocation(e)
  } catch (error) {
    return fail((error as Error).message)
  }
  let valid = false
  try {
    valid = verify(null, Buffer.from(signedPart(list)), createPublicKey(list.publicKey), Buffer.from(list.signature, "base64"))
  } catch {
    valid = false
  }
  if (!valid) return fail("the signature does not match")
  const trusted = trustedKeys.some((k) => {
    try {
      return keyIdOf(k) === keyId
    } catch {
      return false
    }
  })
  if (!trusted) return fail(`signed by ${keyId}, which is not a trusted publisher`)
  return { ok: true, keyId }
}

/** What a package is checked against: its manifest and the key that signed it. */
export type PackageIdentity = { readonly name: string; readonly version: string; readonly keyId: string; readonly manifestHash?: string }

/** The first entry that matches the package, or undefined. */
export function findRevocation(entries: readonly Revocation[], pkg: PackageIdentity): Revocation | undefined {
  return entries.find(
    (e) =>
      (!e.name || e.name === pkg.name) &&
      (!e.version || e.version === pkg.version) &&
      (!e.keyId || e.keyId === pkg.keyId) &&
      // An installed package from before the hash was recorded cannot be matched by hash: it stays unmatched.
      (!e.manifestHash || e.manifestHash === pkg.manifestHash),
  )
}

type StoredEntry = Revocation & { readonly signedBy: string }
type StoreFile = { serials: Record<string, number>; entries: StoredEntry[] }

/** Verified revocations on this machine: <dir>/revocations.json. */
export class RevocationStore {
  private readonly file: string

  constructor(dir: string) {
    this.file = path.join(dir, "revocations.json")
  }

  private read(): StoreFile {
    if (!existsSync(this.file)) return { serials: {}, entries: [] }
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as StoreFile
    } catch {
      // A damaged file must not silently mean "nothing is revoked".
      throw new Error(`${this.file} is damaged; delete it and sync the revocation list again`)
    }
  }

  entries(): readonly Revocation[] {
    return this.read().entries
  }

  serial(keyId: string): number {
    return this.read().serials[keyId] ?? 0
  }

  /**
   * Takes over a verified list: it replaces the earlier entries of the same signer. Returns how many entries it has.
   * A list older than the last one seen from that signer is refused.
   */
  merge(list: RevocationList, trustedKeys: readonly string[]): { entries: number; serial: number; changed: boolean } {
    const check = verifyRevocations(list, trustedKeys)
    if (!check.ok) throw new Error(`revocation list refused: ${check.reason}`)
    const state = this.read()
    const seen = state.serials[check.keyId] ?? 0
    if (list.serial < seen) throw new Error(`revocation list refused: serial ${list.serial} is older than ${seen} already seen from ${check.keyId} (rollback)`)
    const others = state.entries.filter((e) => e.signedBy !== check.keyId)
    const next = [...others, ...list.entries.map((e) => ({ ...e, signedBy: check.keyId }))]
    const changed = list.serial !== seen || JSON.stringify(next) !== JSON.stringify(state.entries)
    mkdirSync(path.dirname(this.file), { recursive: true })
    const staging = `${this.file}.${process.pid}.tmp`
    writeFileSync(staging, `${JSON.stringify({ serials: { ...state.serials, [check.keyId]: list.serial }, entries: next }, null, 2)}\n`)
    renameSync(staging, this.file)
    return { entries: list.entries.length, serial: list.serial, changed }
  }
}
