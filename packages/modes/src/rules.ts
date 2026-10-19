// Translates a mode's tool groups into engine permission rules and the set of tools the model may see.
import { editRestriction, hasGroup, type Mode } from "./schema.ts"

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

export function isMcpTool(name: string): boolean {
  return name.includes("_") && !ENGINE_UNDERSCORE_TOOLS.test(name)
}

/**
 * Deny rules for everything the mode does not grant. They are appended last, so they win over the default
 * policy and over auto-approvals (the engine evaluates the last matching rule; configured denies are checked
 * before rules saved with "always").
 */
export function modeDenyRules(mode: Mode): Rule[] {
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
    if (hasGroup(mode, "edit")) rules.push({ action: "opencode_*", resource: "*", effect: "ask" })
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
    if (isMcpTool(name) && !hasGroup(mode, "mcp")) hidden.add(name)
    if (ENGINE_UNDERSCORE_TOOLS.test(name) && !hasGroup(mode, "edit") && /worktree/.test(name)) hidden.add(name)
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
