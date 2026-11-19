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

// Secret-looking key names. The parts around the keyword are length-limited, so long runs of word characters cannot
// make the regex slow (review 2026-11-19: 40 000 characters took 1.7 s before).
const KEY = String.raw`[A-Za-z0-9_.-]{0,64}(?:password|passwd|pwd|secret|token|credential|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|key[_-]?data|auth(?=["'\s:=]))[A-Za-z0-9_.-]{0,64}`

// key=value / key: value / "key": "value" with a secret-looking key name
const ASSIGNMENT = new RegExp(String.raw`((?:["']?)(?:${KEY})(?:["']?)\s*[:=]\s*)(["']?)([^\s"',;]{4,})\2`, "gi")

// The same with a quoted value that contains spaces: password="correct horse battery staple"
const QUOTED = new RegExp(String.raw`((?:["']?)(?:${KEY})(?:["']?)\s*[:=]\s*)(["'])([^"'\n]*\s[^"'\n]*)\2`, "gi")

// Credentials in URLs: postgres://admin:pw@db, https://user:token@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)@/gi

// .netrc: "machine h login u password p" and a line "password p"
const NETRC = /(\b(?:machine|login)\s+\S+\s+password\s+)(\S+)|(^[ \t]*password[ \t]+)(\S+)[ \t]*$/gim

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g

// Unquoted values in source code ("token = getToken()", "password = input") are expressions, not secrets.
// Quoted values, env/YAML style assignments ("TOKEN=abc", "token: abc") and INI-style literals
// ("aws_secret_access_key = wJalr/K7…") are masked.
function looksLikeCode(prefix: string, quote: string, value: string): boolean {
  if (quote) return false
  if (/[(){}[\]]/.test(value)) return true
  if (!/\s=\s*$/.test(prefix)) return false
  // "key = value": an identifier or member access is code; anything else, or a long mix of letters and digits, is a literal.
  if (!/^[A-Za-z_$][\w$.]*$/.test(value)) return false
  return !(value.length >= 16 && /\d/.test(value) && /[A-Za-z]/.test(value))
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
    out = out.replace(URL_CREDENTIALS, (_, prefix: string) => `${prefix}${MASK}@`)
    out = out.replace(NETRC, (match: string, a?: string, _b?: string, c?: string) => (a ? `${a}${MASK}` : c ? `${c}${MASK}` : match))
    out = out.replace(QUOTED, (_, prefix: string, quote: string) => `${prefix}${quote}${MASK}${quote}`)
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
