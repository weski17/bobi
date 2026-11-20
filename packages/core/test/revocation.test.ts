import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  findRevocation,
  installedPackages,
  installPackage,
  loadOrCreateKey,
  manifestHash,
  packSource,
  parseRevocations,
  removeInstalled,
  RevocationStore,
  revokedInstalled,
  revokedNames,
  signRevocations,
  verifyRevocations,
  type Revocation,
} from "../src/index.ts"

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "bobi-revocation-"))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const key = () => loadOrCreateKey(path.join(temp(), "keys"), "publisher-ed25519.pem")
const alice = key()
const mallory = key()
const entry = (extra: Partial<Revocation> = {}): Revocation => ({ name: "style", reason: "contains a leaked token", revokedAt: "2026-11-06T10:00:00.000Z", ...extra })

function command(name = "deploy", body = "Deploy to staging.\n") {
  const file = path.join(temp(), `${name}.md`)
  writeFileSync(file, body)
  return file
}

test("a revocation needs a selector, a reason and a sane shape", () => {
  expect(() => signRevocations([{ reason: "x", revokedAt: "2026-11-06T10:00:00Z" }], 1, alice)).toThrow("needs a name")
  expect(() => signRevocations([entry({ name: undefined, version: "1.0.0", keyId: "abc" })], 1, alice)).toThrow("needs the package name")
  expect(() => signRevocations([entry({ reason: " " })], 1, alice)).toThrow("needs a reason")
  expect(() => signRevocations([entry({ reason: "x".repeat(401) })], 1, alice)).toThrow("longer than")
  expect(() => signRevocations([entry({ revokedAt: "yesterday" })], 1, alice)).toThrow("not a date")
  expect(() => signRevocations([entry()], 0, alice)).toThrow("serial")
})

test("a list verifies only when intact and signed by a trusted publisher", () => {
  const list = signRevocations([entry()], 1, alice)
  expect(verifyRevocations(list, [alice.publicKey])).toMatchObject({ ok: true, keyId: alice.keyId })
  expect(verifyRevocations(list, [mallory.publicKey])).toMatchObject({ ok: false })
  expect(verifyRevocations(list, []).reason).toContain("not a trusted publisher")

  const edited = JSON.parse(JSON.stringify(list))
  edited.entries[0].reason = "harmless"
  expect(verifyRevocations(edited, [alice.publicKey]).reason).toBe("the signature does not match")
  const bumped = { ...JSON.parse(JSON.stringify(list)), serial: 9 }
  expect(verifyRevocations(bumped, [alice.publicKey]).reason).toBe("the signature does not match")
  const swapped = { ...JSON.parse(JSON.stringify(list)), publicKey: mallory.publicKey, keyId: mallory.keyId }
  expect(verifyRevocations(swapped, [alice.publicKey, mallory.publicKey]).reason).toBe("the signature does not match")
  expect(() => parseRevocations("{}")).toThrow("not a revocation list")
})

test("every given selector must match", () => {
  const pkg = { name: "style", version: "1.2.0", keyId: "k1", manifestHash: "h1" }
  expect(findRevocation([entry()], pkg)).toBeDefined()
  expect(findRevocation([entry({ name: "other" })], pkg)).toBeUndefined()
  expect(findRevocation([entry({ version: "1.2.0" })], pkg)).toBeDefined()
  expect(findRevocation([entry({ version: "1.3.0" })], pkg)).toBeUndefined()
  expect(findRevocation([{ ...entry({ name: undefined }), keyId: "k1" }], pkg)).toBeDefined()
  expect(findRevocation([{ ...entry({ name: undefined }), keyId: "k2" }], pkg)).toBeUndefined()
  expect(findRevocation([entry({ manifestHash: "h1" })], pkg)).toBeDefined()
  expect(findRevocation([entry({ manifestHash: "h2" })], pkg)).toBeUndefined()
  // An installed package without a recorded hash cannot be matched by hash.
  expect(findRevocation([entry({ manifestHash: "h1" })], { name: "style", version: "1.2.0", keyId: "k1" })).toBeUndefined()
})

test("the store takes over lists, replaces a signer's earlier entries and refuses a rollback", () => {
  const store = new RevocationStore(temp())
  const trusted = [alice.publicKey]
  expect(store.entries()).toEqual([])
  expect(store.merge(signRevocations([entry({ name: "a" }), entry({ name: "b" })], 2, alice), trusted)).toMatchObject({ entries: 2, serial: 2, changed: true })
  expect(store.entries().map((e) => e.name)).toEqual(["a", "b"])
  expect(store.serial(alice.keyId)).toBe(2)

  // The same list again: accepted, nothing changes.
  expect(store.merge(signRevocations([entry({ name: "a" }), entry({ name: "b" })], 2, alice), trusted).changed).toBe(false)
  // An older list would un-revoke "b": refused, nothing is lost.
  expect(() => store.merge(signRevocations([entry({ name: "a" })], 1, alice), trusted)).toThrow("rollback")
  expect(store.entries().map((e) => e.name)).toEqual(["a", "b"])
  // A newer list from the same signer replaces the old state (this is how an entry is withdrawn).
  store.merge(signRevocations([entry({ name: "a" })], 3, alice), trusted)
  expect(store.entries().map((e) => e.name)).toEqual(["a"])
  // Another publisher's entries are kept apart.
  store.merge(signRevocations([entry({ name: "c" })], 1, mallory), [alice.publicKey, mallory.publicKey])
  expect(store.entries().map((e) => e.name).sort()).toEqual(["a", "c"])
  // Untrusted signer: refused.
  expect(() => new RevocationStore(temp()).merge(signRevocations([entry()], 1, mallory), trusted)).toThrow("not a trusted publisher")
})

test("a damaged store file is an error, never 'nothing revoked'", () => {
  const dir = temp()
  writeFileSync(path.join(dir, "revocations.json"), "{ not json")
  expect(() => new RevocationStore(dir).entries()).toThrow("damaged")
})

test("install refuses a revoked package, also with force, and records the manifest hash", () => {
  const root = temp()
  const pkg = packSource(command(), "1.0.0", alice)
  const record = installPackage(pkg, root, [alice.publicKey])
  expect(record.manifestHash).toBe(manifestHash(pkg.manifest))

  for (const revocations of [
    [entry({ name: "deploy" })],
    [entry({ name: "deploy", version: "1.0.0" })],
    [entry({ name: undefined, keyId: alice.keyId })],
    [entry({ name: undefined, manifestHash: manifestHash(pkg.manifest) })],
  ]) {
    expect(() => installPackage(pkg, temp(), [alice.publicKey], { revocations })).toThrow("is revoked (contains a leaked token)")
    expect(() => installPackage(pkg, temp(), [alice.publicKey], { revocations, force: true })).toThrow("is revoked")
  }
  // Another version is not covered by a version-specific revocation.
  const next = packSource(command(), "1.1.0", alice)
  expect(installPackage(next, temp(), [alice.publicKey], { revocations: [entry({ name: "deploy", version: "1.0.0" })] }).version).toBe("1.1.0")
})

test("revokedInstalled finds installed packages and removeInstalled deletes only those files", () => {
  const root = temp()
  installPackage(packSource(command("deploy"), "1.0.0", alice), root, [alice.publicKey])
  installPackage(packSource(command("lint", "Lint it.\n"), "1.0.0", alice), root, [alice.publicKey])
  const hits = revokedInstalled(root, [entry({ name: "deploy" })])
  expect(hits.map((h) => h.record.name)).toEqual(["deploy"])
  expect(hits[0]!.revocation.reason).toBe("contains a leaked token")
  expect(revokedInstalled(root, [entry({ name: "unrelated" })])).toEqual([])

  removeInstalled(root, hits[0]!.record)
  expect(existsSync(path.join(root, "commands", "deploy.md"))).toBe(false)
  expect(existsSync(path.join(root, "commands", "lint.md"))).toBe(true)
  expect(installedPackages(root).map((r) => r.name)).toEqual(["lint"])
})

test("a skill is removed as a directory; a tampered ledger cannot point outside", () => {
  const root = temp()
  const dir = path.join(temp(), "style")
  mkdirSync(dir)
  writeFileSync(path.join(dir, "SKILL.md"), "---\nname: style\ndescription: d\n---\nTabs.\n")
  const record = installPackage(packSource(dir, "1.0.0", alice), root, [alice.publicKey])
  expect(existsSync(path.join(root, "skills", "style", "SKILL.md"))).toBe(true)
  removeInstalled(root, record)
  expect(existsSync(path.join(root, "skills", "style"))).toBe(false)

  const outside = path.join(temp(), "precious")
  mkdirSync(outside)
  expect(() => removeInstalled(root, { ...record, name: `../../${path.basename(outside)}` })).toThrow("not a valid package name")
  expect(existsSync(outside)).toBe(true)
  expect(readFileSync(path.join(root, "registry", "installed.json"), "utf8")).toBe("[]\n")
})

test("revoked installed packages are named for the loader; a damaged store blocks registry packages (review 2026-11-19)", () => {
  const root = temp()
  installPackage(packSource(command("deploy"), "1.0.0", alice), root, [alice.publicKey])
  installPackage(packSource(command("lint"), "1.0.0", alice), root, [alice.publicKey])
  const storeDir = path.join(temp(), "registry")
  expect(revokedNames([root], storeDir).command.size).toBe(0)
  new RevocationStore(storeDir).merge(signRevocations([entry({ name: "deploy" })], 1, alice), [alice.publicKey])
  expect([...revokedNames([root], storeDir).command]).toEqual(["deploy"])
  writeFileSync(path.join(storeDir, "revocations.json"), "{ damaged")
  expect([...revokedNames([root], storeDir).command].sort()).toEqual(["deploy", "lint"])
})
