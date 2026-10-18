// Masks secrets in text before it reaches the model, logs or audit records.

export const MASK = "[REDACTED]"

const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI-style keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
]

// key=value / key: value / "key": "value" with a secret-looking key name
const ASSIGNMENT =
  /((?:["']?)(?:[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(?:["']?)\s*[:=]\s*)(["']?)([^\s"',;]{4,})\2/gi

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g

// Unquoted values in source code ("token = getToken()") are expressions, not secrets.
// Quoted values and env/YAML style assignments ("TOKEN=abc", "token: abc") are masked.
function looksLikeCode(prefix: string, quote: string, value: string): boolean {
  if (quote) return false
  if (/[(){}[\]]/.test(value)) return true
  return /\s=\s*$/.test(prefix)
}

export type Masker = (text: string) => string

/**
 * Builds a masker. `values` are known secret values (e.g. the model API key from the
 * environment) that are always replaced, regardless of format.
 */
export function createMasker(values: readonly (string | undefined)[] = []): Masker {
  const known = values.filter((v): v is string => typeof v === "string" && v.length >= 4).sort((a, b) => b.length - a.length)
  return (text) => {
    let out = text
    for (const value of known) out = out.split(value).join(MASK)
    for (const pattern of PATTERNS) out = out.replace(pattern, MASK)
    out = out.replace(BEARER, (_, scheme: string) => `${scheme} ${MASK}`)
    out = out.replace(ASSIGNMENT, (match: string, prefix: string, quote: string, value: string) =>
      looksLikeCode(prefix, quote, value) ? match : `${prefix}${quote}${MASK}${quote}`,
    )
    return out
  }
}

/** Applies a masker to every string inside a JSON-like value. */
export function maskDeep<T>(value: T, mask: Masker): T {
  if (typeof value === "string") return mask(value) as T
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, mask)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, mask)])) as T
  }
  return value
}
