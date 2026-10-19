// Mainframe connection for the Zowe MCP server: Zowe team configuration (zowe.config.json, zowe.config.user.json)
// in the project or ~/.zowe, overridden by the standard ZOWE_OPT_* environment variables. Passwords are taken
// from the environment only (Zowe keeps them in the OS credential vault, which Bobi does not read).
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type Connection = {
  readonly protocol: "https" | "http"
  readonly host: string
  readonly port: number
  readonly basePath: string
  readonly user: string
  readonly password: string
  readonly rejectUnauthorized: boolean
  /** Dataset patterns the agent may access (`*` one qualifier part, `**` any qualifiers, `%` one character). */
  readonly datasets: readonly string[]
  /** USS path prefixes the agent may access. */
  readonly uss: readonly string[]
  /** Where the settings came from (for error messages; never contains secrets). */
  readonly source: string
}

export class ConnectionError extends Error {}

type Profile = { type?: string; properties?: Record<string, unknown>; profiles?: Record<string, Profile>; secure?: string[] }
type TeamConfig = { profiles?: Record<string, Profile>; defaults?: Record<string, string> }

function readJson(file: string): TeamConfig | undefined {
  if (!existsSync(file)) return undefined
  try {
    // Zowe config files are JSON with comments.
    return Bun.JSONC.parse(readFileSync(file, "utf8")) as TeamConfig
  } catch (error) {
    throw new ConnectionError(`${file}: cannot parse: ${(error as Error).message}`)
  }
}

/** Merges zowe.config.json and zowe.config.user.json (user file wins) of a directory. */
function layer(dir: string): { config: TeamConfig; files: string[] } | undefined {
  const files = ["zowe.config.json", "zowe.config.user.json"].map((f) => path.join(dir, f)).filter((f) => existsSync(f))
  if (files.length === 0) return undefined
  const merged: TeamConfig = { profiles: {}, defaults: {} }
  for (const file of files) {
    const c = readJson(file)!
    merged.profiles = { ...merged.profiles, ...c.profiles }
    merged.defaults = { ...merged.defaults, ...c.defaults }
  }
  return { config: merged, files }
}

/** Properties of a profile path like "lpar1.zosmf", inherited from parent profiles. */
function profileProperties(config: TeamConfig, name: string): Record<string, unknown> | undefined {
  let level = config.profiles
  let props: Record<string, unknown> = {}
  for (const part of name.split(".")) {
    const profile = level?.[part]
    if (!profile) return undefined
    props = { ...props, ...profile.properties }
    level = profile.profiles
  }
  return props
}

export function zoweConfigFiles(project: string, env: Record<string, string | undefined> = process.env): string[] {
  const home = env.ZOWE_CLI_HOME ?? path.join(env.HOME ?? os.homedir(), ".zowe")
  return [project, home].flatMap((dir) => ["zowe.config.json", "zowe.config.user.json"].map((f) => path.join(dir, f))).filter((f) => existsSync(f))
}

/** True when a connection could be configured (a host in the environment or a Zowe config file). */
export function zoweConfigured(project: string, env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ZOWE_OPT_HOST) || zoweConfigFiles(project, env).length > 0
}

const list = (value: string | undefined) => (value ?? "").split(",").map((v) => v.trim()).filter(Boolean)

export function loadConnection(project: string, env: Record<string, string | undefined> = process.env): Connection {
  const home = env.ZOWE_CLI_HOME ?? path.join(env.HOME ?? os.homedir(), ".zowe")
  // Project config wins over global config, like the Zowe CLI.
  const layers = [layer(home), layer(project)].filter((l) => l !== undefined)
  const config: TeamConfig = { profiles: {}, defaults: {} }
  for (const l of layers) {
    config.profiles = { ...config.profiles, ...l.config.profiles }
    config.defaults = { ...config.defaults, ...l.config.defaults }
  }
  const profileName = env.BOBI_ZOWE_PROFILE ?? config.defaults?.zosmf
  const profile = profileName ? profileProperties(config, profileName) : undefined
  if (profileName && !profile && layers.length) throw new ConnectionError(`Zowe profile "${profileName}" not found in ${layers.flatMap((l) => l.files).join(", ")}`)
  const base = config.defaults?.base ? (profileProperties(config, config.defaults.base) ?? {}) : {}
  const props: Record<string, unknown> = { ...base, ...profile }
  if (props.password !== undefined) console.error("bobi zowe: ignoring a password stored in a Zowe config file; set ZOWE_OPT_PASSWORD instead")

  const str = (key: string, envKey: string) => env[envKey] ?? (typeof props[key] === "string" || typeof props[key] === "number" ? String(props[key]) : undefined)
  const host = str("host", "ZOWE_OPT_HOST")
  const user = str("user", "ZOWE_OPT_USER")
  const password = env.ZOWE_OPT_PASSWORD
  const missing = [!host && "host (ZOWE_OPT_HOST)", !user && "user (ZOWE_OPT_USER)", !password && "password (ZOWE_OPT_PASSWORD)"].filter(Boolean)
  if (missing.length) throw new ConnectionError(`Mainframe connection not configured: missing ${missing.join(", ")}`)
  const protocol = (str("protocol", "ZOWE_OPT_PROTOCOL") ?? "https").toLowerCase()
  if (protocol !== "https" && protocol !== "http") throw new ConnectionError(`protocol must be https or http, not "${protocol}"`)
  const port = Number(str("port", "ZOWE_OPT_PORT") ?? 443)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConnectionError("port must be between 1 and 65535")
  const reject = env.ZOWE_OPT_REJECT_UNAUTHORIZED ?? (props.rejectUnauthorized === undefined ? undefined : String(props.rejectUnauthorized))
  const upperUser = user!.toUpperCase()
  return {
    protocol,
    host: host!,
    port,
    basePath: (str("basePath", "ZOWE_OPT_BASE_PATH") ?? "").replace(/\/$/, ""),
    user: user!,
    password: password!,
    rejectUnauthorized: reject === undefined ? true : reject !== "false",
    // Default: only the user's own datasets and home directory – never production data unless allowed explicitly.
    datasets: list(env.BOBI_ZOWE_DATASETS).map((p) => p.toUpperCase()).concat(env.BOBI_ZOWE_DATASETS ? [] : [`${upperUser}.**`]),
    uss: list(env.BOBI_ZOWE_USS).concat(env.BOBI_ZOWE_USS ? [] : [`/u/${user!.toLowerCase()}`]),
    source: [...layers.flatMap((l) => l.files), "environment"].join(", "),
  }
}

const DATASET = /^[A-Z#$@][A-Z0-9#$@-]{0,7}(\.[A-Z#$@][A-Z0-9#$@-]{0,7})*$/
const MEMBER = /^[A-Z#$@][A-Z0-9#$@]{0,7}$/

export function checkDataset(name: string): string {
  const upper = name.trim().replace(/^'|'$/g, "").toUpperCase()
  if (upper.length > 44 || !DATASET.test(upper)) throw new ConnectionError(`"${name}" is not a valid dataset name`)
  return upper
}

export function checkMember(name: string): string {
  const upper = name.trim().toUpperCase()
  if (!MEMBER.test(upper)) throw new ConnectionError(`"${name}" is not a valid member name`)
  return upper
}

const qualifier = (pattern: string) => new RegExp(`^${pattern.replace(/[$#@]/g, "\\$&").replace(/\*/g, "[^.]*").replace(/%/g, ".")}$`)

function matchQualifiers(name: readonly string[], pattern: readonly string[]): boolean {
  if (pattern.length === 0) return name.length === 0
  if (pattern[0] === "**") return matchQualifiers(name, pattern.slice(1)) || (name.length > 0 && matchQualifiers(name.slice(1), pattern))
  return name.length > 0 && qualifier(pattern[0]!).test(name[0]!) && matchQualifiers(name.slice(1), pattern.slice(1))
}

/** Matches a dataset name against an allowlist pattern (`*` within a qualifier, `**` any qualifiers, `%` one character). */
export function datasetMatches(name: string, pattern: string): boolean {
  return matchQualifiers(name.split("."), pattern.split("."))
}

export function allowedDataset(connection: Connection, name: string): boolean {
  return connection.datasets.some((p) => datasetMatches(name, p))
}

export function requireDataset(connection: Connection, name: string): string {
  const upper = checkDataset(name)
  if (!allowedDataset(connection, upper))
    throw new ConnectionError(`Dataset ${upper} is outside the allowed datasets (${connection.datasets.join(", ")}). An administrator can widen BOBI_ZOWE_DATASETS.`)
  return upper
}

export function requireUssPath(connection: Connection, file: string): string {
  if (!file.startsWith("/")) throw new ConnectionError(`"${file}" must be an absolute USS path`)
  const normal = path.posix.normalize(file)
  if (!connection.uss.some((prefix) => normal === prefix || normal.startsWith(`${prefix.replace(/\/$/, "")}/`)))
    throw new ConnectionError(`USS path ${normal} is outside the allowed paths (${connection.uss.join(", ")}). An administrator can widen BOBI_ZOWE_USS.`)
  return normal
}
