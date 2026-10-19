// Bobi modes (requirement 2 and 3, ADR-0004). Format written from scratch after the publicly documented shape of
// custom mode files: a `customModes` list with slug, name, roleDefinition and tool groups.

export const GROUPS = ["read", "edit", "execute", "browser", "mcp", "subtask"] as const
export type Group = (typeof GROUPS)[number]

/** `edit` may be limited to files whose project-relative path matches `fileRegex`. */
export type EditRestriction = { fileRegex: string; description?: string }
/** `mcp` may be limited to named servers. */
export type McpRestriction = { servers: string[] }
export type GroupEntry = Group | ["edit", EditRestriction] | ["mcp", McpRestriction]

export type Mode = {
  slug: string
  name: string
  description?: string
  roleDefinition: string
  whenToUse?: string
  customInstructions?: string
  groups: GroupEntry[]
  /** File the mode was loaded from (for messages). */
  source: string
}

export class ModeError extends Error {
  constructor(
    readonly source: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid modes file (${source}):\n${issues.map((i) => `  - ${i}`).join("\n")}`)
    this.name = "ModeError"
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const optionalString = (v: unknown) => v === undefined || typeof v === "string"

function parseGroup(entry: unknown, at: string, issues: string[]): GroupEntry | undefined {
  if (typeof entry === "string") {
    if ((GROUPS as readonly string[]).includes(entry)) return entry as Group
    issues.push(`${at}: unknown group "${entry}" (known: ${GROUPS.join(", ")})`)
    return undefined
  }
  if (Array.isArray(entry) && entry[0] === "mcp" && isObject(entry[1])) {
    const { servers } = entry[1]
    if (!Array.isArray(servers) || servers.length === 0 || servers.some((s) => typeof s !== "string" || !/^[a-z][a-z0-9-]*$/.test(s)))
      return void issues.push(`${at}: mcp restriction needs servers: a non-empty list of server names`)
    return ["mcp", { servers: [...servers] as string[] }]
  }
  if (Array.isArray(entry) && entry[0] === "edit" && isObject(entry[1])) {
    const { fileRegex, description } = entry[1]
    if (typeof fileRegex !== "string" || fileRegex === "") return void issues.push(`${at}: edit restriction needs fileRegex`)
    try {
      new RegExp(fileRegex)
    } catch (error) {
      return void issues.push(`${at}: invalid fileRegex: ${(error as Error).message}`)
    }
    if (!optionalString(description)) return void issues.push(`${at}: description must be a string`)
    return ["edit", { fileRegex, ...(description ? { description } : {}) }]
  }
  issues.push(`${at}: a group is a name, ["edit", { fileRegex }] or ["mcp", { servers }]`)
  return undefined
}

/** Parses a custom modes YAML document. */
export function parseModes(text: string, source: string): Mode[] {
  let doc: unknown
  try {
    doc = Bun.YAML.parse(text)
  } catch (error) {
    throw new ModeError(source, [`cannot parse YAML: ${(error as Error).message}`])
  }
  if (doc === null || doc === undefined) return []
  if (!isObject(doc) || !Array.isArray(doc.customModes)) throw new ModeError(source, ["expected a top-level customModes list"])
  const issues: string[] = []
  const modes: Mode[] = []
  const seen = new Set<string>()
  doc.customModes.forEach((raw, i) => {
    const at = `customModes[${i}]`
    if (!isObject(raw)) return void issues.push(`${at}: must be an object`)
    const { slug, name, description, roleDefinition, whenToUse, customInstructions, groups } = raw
    if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) issues.push(`${at}.slug: lowercase letters, digits and hyphens`)
    else if (seen.has(slug)) issues.push(`${at}.slug: duplicate slug "${slug}"`)
    else seen.add(slug)
    if (typeof name !== "string" || name === "") issues.push(`${at}.name: required`)
    if (typeof roleDefinition !== "string" || roleDefinition.trim() === "") issues.push(`${at}.roleDefinition: required`)
    for (const [key, value] of Object.entries({ description, whenToUse, customInstructions }))
      if (!optionalString(value)) issues.push(`${at}.${key}: must be a string`)
    const parsedGroups: GroupEntry[] = []
    if (groups !== undefined && !Array.isArray(groups)) issues.push(`${at}.groups: must be a list`)
    else for (const [j, g] of (groups ?? []).entries()) {
      const group = parseGroup(g, `${at}.groups[${j}]`, issues)
      if (group) parsedGroups.push(group)
    }
    for (const key of Object.keys(raw))
      if (!["slug", "name", "description", "roleDefinition", "whenToUse", "customInstructions", "groups"].includes(key))
        issues.push(`${at}.${key}: unknown key`)
    if (typeof slug === "string" && typeof name === "string" && typeof roleDefinition === "string")
      modes.push({
        slug,
        name,
        roleDefinition,
        groups: parsedGroups,
        source,
        ...(typeof description === "string" ? { description } : {}),
        ...(typeof whenToUse === "string" ? { whenToUse } : {}),
        ...(typeof customInstructions === "string" ? { customInstructions } : {}),
      })
  })
  if (issues.length) throw new ModeError(source, issues)
  return modes
}

export function hasGroup(mode: Mode, group: Group): boolean {
  return mode.groups.some((g) => (Array.isArray(g) ? g[0] : g) === group)
}

/** The edit restriction of a mode, if its edit group is limited by fileRegex. */
export function editRestriction(mode: Mode): EditRestriction | undefined {
  if (mode.groups.includes("edit")) return undefined
  const entry = mode.groups.find((g): g is ["edit", EditRestriction] => Array.isArray(g) && g[0] === "edit")
  return entry?.[1]
}

/** MCP servers the mode may use: "all", "none", or a list of server names. */
export function mcpServers(mode: Mode): "all" | "none" | string[] {
  if (mode.groups.includes("mcp")) return "all"
  const entries = mode.groups.filter((g): g is ["mcp", McpRestriction] => Array.isArray(g) && g[0] === "mcp")
  return entries.length ? [...new Set(entries.flatMap((e) => e[1].servers))] : "none"
}
