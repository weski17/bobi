// Secure-by-default permission rules (ADR-0005).
import { readFileSync } from "node:fs"
import path from "node:path"
import type { AutoApproveRule } from "@bobi/config"

export type Effect = "allow" | "ask" | "deny"
export type Rule = { action: string; resource: string; effect: Effect }

const POLICY_FILE = path.join(import.meta.dir, "..", "defaults", "permissions.jsonc")

export function loadDefaultPolicy(file = POLICY_FILE): Rule[] {
  const rules = Bun.JSONC.parse(readFileSync(file, "utf8")) as Rule[]
  if (!Array.isArray(rules)) throw new Error(`${file}: policy must be an array of rules`)
  for (const [i, rule] of rules.entries()) {
    if (typeof rule.action !== "string" || typeof rule.resource !== "string" || !["allow", "ask", "deny"].includes(rule.effect))
      throw new Error(`${file}: rule ${i} must have action, resource and effect allow|ask|deny`)
  }
  return rules
}

/** OpenCode permission action for each Bobi auto-approve action. */
const ACTION: Record<AutoApproveRule["action"], string> = {
  edit: "edit",
  shell: "shell",
  webfetch: "webfetch",
  browser: "browser",
  mcp: "*_*",
  external_directory: "external_directory",
}

/** Rules appended to one agent: the default policy, then explicit auto-approvals for that agent. */
export function rulesForAgent(agentId: string, policy: readonly Rule[], autoApprove: readonly AutoApproveRule[]): Rule[] {
  const approvals = autoApprove
    .filter((rule) => rule.modes.length === 0 || rule.modes.includes(agentId))
    .map((rule): Rule => ({ action: rule.action === "mcp" ? rule.resource : ACTION[rule.action], resource: rule.action === "mcp" ? "*" : rule.resource, effect: "allow" }))
  return [...policy, ...approvals]
}

/** Glob match mirroring OpenCode's Wildcard.match (core/src/util/wildcard.ts). */
export function wildcard(value: string, pattern: string): boolean {
  let source = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  // "git status *" also matches a bare "git status".
  if (source.endsWith(" .*")) source = source.slice(0, -3) + "( .*)?"
  return new RegExp(`^${source}$`, "s").test(value.replaceAll("\\", "/"))
}

/** Last-match-wins evaluation; no match → ask. Mirrors OpenCode so policies can be unit-tested. */
export function evaluate(action: string, resource: string, rules: readonly Rule[]): Effect {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!
    if (wildcard(action, rule.action) && wildcard(resource, rule.resource)) return rule.effect
  }
  return "ask"
}
