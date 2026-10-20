import { afterAll, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { checkDataset, checkMember, datasetMatches, loadConnection, requireDataset, requireUssPath, zoweConfigFiles, zoweConfigured } from "../src/index.ts"

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bobi-zowe-"))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const password = crypto.randomUUID()

test("environment only: defaults to https:443, own datasets and home directory", () => {
  const home = temp()
  const c = loadConnection(temp(), { HOME: home, ZOWE_OPT_HOST: "mf.example", ZOWE_OPT_USER: "dev1", ZOWE_OPT_PASSWORD: password })
  expect(c).toMatchObject({ protocol: "https", host: "mf.example", port: 443, user: "dev1", datasets: ["DEV1.**"], uss: ["/u/dev1"], basePath: "" })
  expect(c.source).toBe("environment")
  expect(JSON.stringify({ ...c, password: undefined })).not.toContain(password)
})

test("team config: project wins over global, nested profiles inherit, base profile, user file overlay", () => {
  const home = temp()
  const project = temp()
  mkdirSync(path.join(home, ".zowe"))
  writeFileSync(path.join(home, ".zowe", "zowe.config.json"), JSON.stringify({ profiles: { base: { type: "base", properties: { host: "global.example", rejectUnauthorized: true } } }, defaults: { base: "base" } }))
  writeFileSync(
    path.join(project, "zowe.config.json"),
    `// project config\n${JSON.stringify({
      profiles: { lpar1: { properties: { host: "lpar1.example" }, profiles: { zosmf: { type: "zosmf", properties: { port: 10443, basePath: "/api/" } } } } },
      defaults: { zosmf: "lpar1.zosmf" },
    })}`,
  )
  writeFileSync(path.join(project, "zowe.config.user.json"), JSON.stringify({ profiles: { lpar2: { properties: { host: "lpar2.example", user: "fromfile", password: "ignored" } } } }))
  const warn = spyOn(console, "error").mockImplementation(() => {})
  try {
    const env = { HOME: home, ZOWE_OPT_PASSWORD: password, ZOWE_OPT_USER: "dev1" }
    expect(loadConnection(project, env)).toMatchObject({ host: "lpar1.example", port: 10443, basePath: "/api" })
    expect(loadConnection(project, { ...env, BOBI_ZOWE_PROFILE: "lpar2", ZOWE_OPT_USER: undefined })).toMatchObject({ host: "lpar2.example", user: "fromfile", password })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignoring a password"))
    expect(() => loadConnection(project, { ...env, BOBI_ZOWE_PROFILE: "nope" })).toThrow('Zowe profile "nope" not found')
    expect(zoweConfigFiles(project, env)).toHaveLength(3)
    expect(zoweConfigured(project, env)).toBe(true)
  } finally {
    warn.mockRestore()
  }
})

test("explicit allowlists, protocol, port and TLS settings from the environment", () => {
  const env = {
    HOME: temp(),
    ZOWE_OPT_HOST: "h",
    ZOWE_OPT_USER: "u",
    ZOWE_OPT_PASSWORD: password,
    ZOWE_OPT_PROTOCOL: "HTTP",
    ZOWE_OPT_PORT: "8080",
    ZOWE_OPT_REJECT_UNAUTHORIZED: "true",
    BOBI_ZOWE_DATASETS: "dev.**, test.a*.src",
    BOBI_ZOWE_USS: "/projects/x/",
  }
  expect(loadConnection(temp(), env)).toMatchObject({ protocol: "http", port: 8080, datasets: ["DEV.**", "TEST.A*.SRC"], uss: ["/projects/x/"] })
  expect(() => loadConnection(temp(), { ...env, ZOWE_OPT_PROTOCOL: "ftp" })).toThrow("protocol must be")
  expect(() => loadConnection(temp(), { ...env, ZOWE_OPT_PORT: "0" })).toThrow("port must be")
  expect(() => loadConnection(temp(), { ...env, ZOWE_OPT_REJECT_UNAUTHORIZED: "false" })).toThrow("always verifies certificates")
})

test("missing settings and broken config files are explained", () => {
  const home = temp()
  expect(() => loadConnection(temp(), { HOME: home })).toThrow("missing host (ZOWE_OPT_HOST), user (ZOWE_OPT_USER), password (ZOWE_OPT_PASSWORD)")
  expect(zoweConfigured(temp(), { HOME: home })).toBe(false)
  expect(zoweConfigured(temp(), { HOME: home, ZOWE_OPT_HOST: "h" })).toBe(true)
  const broken = temp()
  writeFileSync(path.join(broken, "zowe.config.json"), "{ nope")
  expect(() => loadConnection(broken, { HOME: home })).toThrow("cannot parse")
  const custom = temp()
  mkdirSync(path.join(custom, "zhome"))
  writeFileSync(path.join(custom, "zhome", "zowe.config.json"), "{}")
  expect(zoweConfigFiles(temp(), { ZOWE_CLI_HOME: path.join(custom, "zhome") })).toHaveLength(1)
})

test("dataset names, members and allowlist patterns", () => {
  expect(checkDataset("'user1.cobol.src'")).toBe("USER1.COBOL.SRC")
  for (const bad of ["1BAD.X", "TOOLONGQUAL.X", "A..B", `${"A.".repeat(22)}A`]) expect(() => checkDataset(bad)).toThrow("not a valid dataset name")
  expect(checkMember("paycalc")).toBe("PAYCALC")
  expect(() => checkMember("PAY.CALC")).toThrow("not a valid member name")
  expect(datasetMatches("USER1.COBOL.SRC", "USER1.**")).toBe(true)
  expect(datasetMatches("USER1", "USER1.**")).toBe(true)
  expect(datasetMatches("PROD.USER1", "USER1.**")).toBe(false)
  expect(datasetMatches("DEV.A1.LOAD", "DEV.A%.*")).toBe(true)
  expect(datasetMatches("DEV.AB1.LOAD", "DEV.A%.*")).toBe(false)
  expect(datasetMatches("DEV.X.Y.SRC", "DEV.**.SRC")).toBe(true)
  expect(datasetMatches("U$1.X", "U$1.*")).toBe(true)
  const c = { datasets: ["DEV1.**"], uss: ["/u/dev1"] } as never
  expect(requireDataset(c, "dev1.src")).toBe("DEV1.SRC")
  expect(() => requireDataset(c, "PROD.PAYROLL")).toThrow("outside the allowed datasets (DEV1.**)")
  expect(requireUssPath(c, "/u/dev1/a/../b.txt")).toBe("/u/dev1/b.txt")
  expect(requireUssPath(c, "/u/dev1")).toBe("/u/dev1")
  expect(() => requireUssPath(c, "/u/dev1/../dev2/x")).toThrow("outside the allowed paths")
  expect(() => requireUssPath(c, "/u/dev10")).toThrow("outside the allowed paths")
  expect(() => requireUssPath(c, "relative")).toThrow("absolute USS path")
})
