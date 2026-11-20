// Egress allowlist (ADR-0007). Entries are "host:port" with optional "*." wildcard prefix, e.g.
// "host.containers.internal:4000" or "*.intranet.example:443". A missing port means 443.

export type Target = { host: string; port: number }

export type Rule = { host: string; wildcard: boolean; port: number }

export function parseRule(entry: string): Rule {
  const value = entry.trim().toLowerCase()
  const match = /^(\*\.)?([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/.exec(value)
  if (!match) throw new Error(`invalid allowlist entry: ${entry}`)
  const port = match[3] ? Number(match[3]) : 443
  if (port < 1 || port > 65_535) throw new Error(`invalid port in allowlist entry: ${entry}`)
  return { host: match[2]!, wildcard: Boolean(match[1]), port }
}

export function parseAllowlist(text: string): Rule[] {
  return text
    .split(/[\n,]/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map(parseRule)
}

/** The rule that allows `target`, if any. Host names with other characters than letters, digits, dots and dashes never match. */
export function matchRule(target: Target, rules: readonly Rule[]): Rule | undefined {
  const host = target.host.toLowerCase().replace(/\.$/, "")
  if (!/^([a-z0-9.-]+|\[[0-9a-f:]+\])$/.test(host)) return undefined
  return rules.find((rule) => rule.port === target.port && (rule.wildcard ? host.endsWith(`.${rule.host}`) : host === rule.host))
}

export function allowed(target: Target, rules: readonly Rule[]): boolean {
  return matchRule(target, rules) !== undefined
}

/** Parses "host:port" from a CONNECT authority or a URL. */
export function parseTarget(authority: string, defaultPort: number): Target | undefined {
  const match = /^(\[[0-9a-fA-F:]+\]|[^:\s/]+)(?::(\d{1,5}))?$/.exec(authority)
  if (!match) return undefined
  return { host: match[1]!, port: match[2] ? Number(match[2]) : defaultPort }
}
