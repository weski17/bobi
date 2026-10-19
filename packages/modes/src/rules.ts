// Translates a mode's tool groups into engine permission rules and the set of tools the model may see.
import { editRestriction, hasGroup, mcpServers, type Mode } from "./schema.ts"

export type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

/** Engine tools per group. Tools not listed here (question, skill, todo …) are always available. */
export const GROUP_TOOLS = {
  read: ["read", "glob", "grep"],
  edit: ["edit", "write", "patch"],
  execute: ["shell"],
  browser: ["browser", "webfetch", "websearch"],
  subtask: ["subagent"],
} as const

/** Engine permission actions per group. */
const GROUP_ACTIONS = {
  read: ["read", "glob", "grep"],
  edit: ["edit"],
  execute: ["shell"],
  browser: ["browser", "webfetch", "websearch"],
  subtask: ["subagent"],
} as const

/** Built-in engine tools whose names contain an underscore but are not MCP tools. */
const ENGINE_UNDERSCORE_TOOLS = /^opencode_/
/** Engine tools that change sessions or worktrees (need the edit group, no MCP). */
const ENGINE_EDIT_TOOLS = ["opencode_session_*", "opencode_worktree_*", "opencode_models"]
/** Engine tools that read MCP resources (need the mcp group). */
const ENGINE_MCP_TOOLS = /^opencode_(list|read)_mcp_resources?$/

export function isMcpTool(name: string): boolean {
  return name.includes("_") && !ENGINE_UNDERSCORE_TOOLS.test(name)
}

/** The MCP server a tool belongs to (tools are named <server>_<tool>; server names contain no "_"). */
export function mcpServerOf(tool: string): string | undefined {
  return isMcpTool(tool) ? tool.slice(0, tool.indexOf("_")) : undefined
}

function mcpAllowed(mode: Mode, server: string): boolean {
  const allowed = mcpServers(mode)
  return allowed === "all" || (allowed !== "none" && allowed.includes(server))
}

/**
 * Deny rules for everything the mode does not grant. They are appended last, so they win over the default
 * policy and over auto-approvals (the engine evaluates the last matching rule; configured denies are checked
 * before rules saved with "always").
 */
export function modeDenyRules(mode: Mode, knownServers: readonly string[] = []): Rule[] {
  const rules: Rule[] = []
  for (const [group, actions] of Object.entries(GROUP_ACTIONS) as [keyof typeof GROUP_ACTIONS, readonly string[]][]) {
    if (!hasGroup(mode, group)) for (const action of actions) rules.push({ action, resource: "*", effect: "deny" })
  }
  // Worktree tools change files like edits do.
  if (!hasGroup(mode, "edit")) rules.push({ action: "opencode_*", resource: "*", effect: "deny" })
  if (!hasGroup(mode, "mcp")) {
    // MCP tools are named <server>_<tool>; keep the engine's own underscore actions working.
    rules.push({ action: "*_*", resource: "*", effect: "deny" })
    rules.push({ action: "external_directory", resource: "*", effect: "ask" })
    // Engine tools with underscores (sessions, worktrees) stay usable; MCP resource tools stay denied.
    if (hasGroup(mode, "edit")) for (const action of ENGINE_EDIT_TOOLS) rules.push({ action, resource: "*", effect: "ask" })
  } else {
    // Restricted to named servers: deny every other configured server.
    for (const server of knownServers) if (!mcpAllowed(mode, server)) rules.push({ action: `${server}_*`, resource: "*", effect: "deny" })
  }
  return rules
}

/** Tool names the model must not see in this mode. */
export function hiddenTools(mode: Mode, toolNames: readonly string[]): string[] {
  const hidden = new Set<string>()
  for (const [group, tools] of Object.entries(GROUP_TOOLS) as [keyof typeof GROUP_TOOLS, readonly string[]][]) {
    if (!hasGroup(mode, group)) for (const tool of tools) hidden.add(tool)
  }
  for (const name of toolNames) {
    const server = mcpServerOf(name)
    if (server && !mcpAllowed(mode, server)) hidden.add(name)
    if (ENGINE_UNDERSCORE_TOOLS.test(name) && !hasGroup(mode, "edit") && /worktree/.test(name)) hidden.add(name)
    if (ENGINE_MCP_TOOLS.test(name) && mcpServers(mode) === "none") hidden.add(name)
  }
  return toolNames.filter((name) => hidden.has(name))
}

/** Whether `relativePath` may be edited in this mode (fileRegex restriction). */
export function editAllowed(mode: Mode, relativePath: string): boolean {
  if (!hasGroup(mode, "edit")) return false
  const restriction = editRestriction(mode)
  return restriction ? new RegExp(restriction.fileRegex).test(relativePath.replaceAll("\\", "/")) : true
}

/** Text for the system prompt: who the model is in this mode. */
export function modePrompt(mode: Mode): string {
  const parts = [`# Mode: ${mode.name} (${mode.slug})`, mode.roleDefinition.trim()]
  if (mode.customInstructions?.trim()) parts.push(mode.customInstructions.trim())
  const restriction = editRestriction(mode)
  if (restriction) parts.push(`You may only edit files matching ${restriction.fileRegex}${restriction.description ? ` (${restriction.description})` : ""}.`)
  return parts.join("\n\n")
}
