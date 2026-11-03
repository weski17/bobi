import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fingerprint, loadConfig, TrustStore, trustFiles } from "../src/index.ts"

let root: string
let project: string
let store: TrustStore
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "bobi-trust-")))
  project = path.join(root, "project")
  mkdirSync(path.join(project, ".git"), { recursive: true })
  store = new TrustStore(path.join(root, "home"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const addBobiFiles = () => {
  mkdirSync(path.join(project, ".bobi", "rules-plan"), { recursive: true })
  writeFileSync(path.join(project, "AGENTS.md"), "a")
  writeFileSync(path.join(project, ".bobi", "config.jsonc"), `{ "autoApprove": [{ "action": "shell", "resource": "*" }] }`)
  writeFileSync(path.join(project, ".bobi", "custom_modes.yaml"), "customModes: []")
  writeFileSync(path.join(project, ".bobi", "rules-plan", "p.md"), "p")
  writeFileSync(path.join(project, ".bobi", "notes.txt"), "not relevant")
  writeFileSync(path.join(project, ".bobiignore"), "x")
}

describe("trust store", () => {
  test("a project without Bobi files needs no decision", () => {
    expect(store.status(project)).toBe("none")
    expect(store.isTrusted(project)).toBe(true)
  })

  test("forget removes a decision", () => {
    addBobiFiles()
    store.decide(project, true)
    expect(store.status(project)).toBe("trusted")
    store.forget(project)
    expect(store.status(project)).toBe("unknown")
    store.forget(project)
  })

  test("Bobi files make the project unknown until the user decides", () => {
    addBobiFiles()
    expect(trustFiles(project).map((f) => path.relative(project, f))).toEqual(["AGENTS.md", ".bobi/config.jsonc", ".bobi/custom_modes.yaml", ".bobi/rules-plan/p.md"])
    expect(store.status(project)).toBe("unknown")
    expect(store.isTrusted(project)).toBe(false)
    store.decide(project, true)
    expect(store.status(project)).toBe("trusted")
    store.decide(project, false)
    expect(store.status(project)).toBe("untrusted")
  })

  test("changing a Bobi file asks again; .bobiignore and other files do not matter", () => {
    addBobiFiles()
    store.decide(project, true)
    writeFileSync(path.join(project, ".bobiignore"), "changed")
    writeFileSync(path.join(project, ".bobi", "notes.txt"), "changed")
    expect(store.status(project)).toBe("trusted")
    writeFileSync(path.join(project, ".bobi", "rules-plan", "p.md"), "changed")
    expect(store.status(project)).toBe("unknown")
  })

  test("decisions are made for the project root, also from a subdirectory", () => {
    addBobiFiles()
    mkdirSync(path.join(project, "src", "deep"), { recursive: true })
    expect(store.status(path.join(project, "src", "deep"))).toBe("unknown")
    store.decide(path.join(project, "src"), true)
    expect(store.status(project)).toBe("trusted")
  })

  test("the store file is private and a corrupt store means no decisions", () => {
    addBobiFiles()
    store.decide(project, true)
    expect(statSync(store.file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(store.file, "utf8")).projects[project].trusted).toBe(true)
    writeFileSync(store.file, "{broken")
    expect(store.status(project)).toBe("unknown")
    writeFileSync(store.file, `{"version": 2}`)
    expect(store.status(project)).toBe("unknown")
  })

  test("fingerprints depend on names and contents", () => {
    addBobiFiles()
    const a = fingerprint(project, trustFiles(project))
    writeFileSync(path.join(project, "AGENTS.md"), "b")
    expect(fingerprint(project, trustFiles(project))).not.toBe(a)
  })
})

test("an untrusted project's config file is not loaded", () => {
  addBobiFiles()
  const env = { BOBI_HOME: path.join(root, "home") }
  expect(loadConfig({ cwd: project, env, home: root }).config.autoApprove).toHaveLength(1)
  expect(loadConfig({ cwd: project, env, home: root, trustedProject: false }).config.autoApprove).toEqual([])
})

test("the global config lives in BOBI_HOME", () => {
  mkdirSync(path.join(root, "bh"), { recursive: true })
  writeFileSync(path.join(root, "bh", "config.jsonc"), `{ "model": { "default": "from-bobi-home" } }`)
  expect(loadConfig({ cwd: project, env: { BOBI_HOME: path.join(root, "bh") }, home: root }).config.model.default).toBe("from-bobi-home")
})
