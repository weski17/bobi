// The advisory security agent for pull requests: the task it gets, how its answer is read, and the comment that is
// posted. The agent only advises; the deterministic scanners in .github/workflows/security.yml decide (ADR-0027).
// Everything the model writes is untrusted: it is parsed into fixed fields, masked, escaped and limited in size.

import type { Masker } from "./masking.ts"

export const SECURITY_MARKER = "<!-- bobi-security-agent -->"
export const SEVERITIES = ["critical", "high", "medium", "low"] as const
export type Severity = (typeof SEVERITIES)[number]

export type SecurityFinding = { file: string; line?: number; severity: Severity; title: string; why: string; fix: string }
export type ParsedReview = { findings: SecurityFinding[]; dropped: number; parsed: boolean }

/** At most this many findings are shown; GitHub limits a comment to 65 536 characters. */
export const MAX_FINDINGS = 30
const MAX_COMMENT = 60_000
const MAX_FIELD = 600

/** At most this many files go to the agent; a bigger change is reviewed in part, and the comment says so. */
export const MAX_FILES = 40
const SKIP = [/(^|\/)(vendor|node_modules|dist|build|\.upstream)\//, /(^|\/)(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/, /\.(png|jpe?g|gif|webp|ico|pdf|mp4|mov|wav|zip|gz|woff2?|ttf|svg)$/i]

/** The changed files worth a review: source and configuration, no lockfiles, media or vendored code. */
export function reviewableFiles(changed: readonly string[]): { files: string[]; skipped: number } {
  const wanted = changed.filter((f) => f && !SKIP.some((p) => p.test(f)))
  return { files: wanted.slice(0, MAX_FILES), skipped: changed.length - Math.min(wanted.length, MAX_FILES) }
}

/** The task for `bobi run --mode security-ci`. The answer format is fixed so it can be checked. */
export function securityReviewPrompt(base: string, files: readonly string[]): string {
  return [
    `Review the changes of this pull request against ${base} for security problems.`,
    `Changed files (read them; \`git diff ${base}...HEAD -- <file>\` shows what changed):`,
    ...files.map((f) => `- ${f}`),
    "",
    "Only report concrete problems in these files, introduced or touched by the change, with file and line.",
    "Answer with exactly one fenced block tagged `findings` that holds a JSON array, and nothing else:",
    "```findings",
    '[{"file": "src/a.ts", "line": 12, "severity": "high", "title": "SQL injection", "why": "user input reaches the query unescaped", "fix": "use a parameterised query"}]',
    "```",
    'severity is one of "critical", "high", "medium", "low". If you find nothing, answer with an empty array: `[]` in the block.',
  ].join("\n")
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_FIELD) : undefined)

/** The JSON array in the last `findings` (or `json`) block, or undefined when there is none or it is broken. */
function lastBlock(output: string): unknown[] | undefined {
  const body = [...output.matchAll(/```(?:findings|json)[^\S\n]*\n([\s\S]*?)```/g)].at(-1)?.[1]
  if (body === undefined) return undefined
  try {
    const data: unknown = JSON.parse(body)
    return Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

/** One entry of the answer as a finding, or undefined if it is incomplete or names a file outside the change. */
function toFinding(item: unknown, files: ReadonlySet<string>): SecurityFinding | undefined {
  const f = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
  const file = text(f.file)?.replace(/^\.\//, "")
  const severity = severityOf(f.severity)
  const title = text(f.title)
  if (!file || !files.has(file) || !severity || !title) return undefined
  return { file, line: lineOf(f.line), severity, title, why: text(f.why) ?? "", fix: text(f.fix) ?? "" }
}

const severityOf = (v: unknown): Severity | undefined => {
  const s = text(v)?.toLowerCase()
  return SEVERITIES.find((x) => x === s)
}
const lineOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined)

const bySeverity = (a: SecurityFinding, b: SecurityFinding) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)

/**
 * Reads the agent's answer. The last `findings` (or `json`) block counts; findings for files outside the change are
 * dropped, because the model may invent them. A missing or broken block yields `parsed: false`.
 */
export function parseSecurityFindings(output: string, changed: readonly string[]): ParsedReview {
  const data = lastBlock(output)
  if (!data) return { findings: [], dropped: 0, parsed: false }
  const files = new Set(changed)
  const findings = data.map((item) => toFinding(item, files)).filter((f): f is SecurityFinding => f !== undefined)
  return { findings: findings.sort(bySeverity), dropped: data.length - findings.length, parsed: true }
}

/**
 * Model text as plain text in Markdown: no HTML, no links or images, no mentions (they would notify people), no table
 * breaks. What the model writes can come from the reviewed code, so it must not be able to shape the comment.
 */
export function plainMarkdown(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`)
    .replace(/@/g, "@\u200b")
    .replace(/:\/\//g, ":\u200b//")
}

export type CommentInput = {
  review: ParsedReview
  files: readonly string[]
  /** Changed files the agent did not see (lockfiles, media, beyond MAX_FILES). */
  skipped?: number
  mask: Masker
  /** Shown in the footer, e.g. the model name and the commit. */
  model?: string
  commit?: string
  runUrl?: string
}

const ICON: Record<Severity, string> = { critical: "🟥", high: "🟧", medium: "🟨", low: "🟦" }
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The main part: why nothing is listed, or the counts and the table. */
function body(input: CommentInput, safe: (s: string) => string): string[] {
  const { review, files } = input
  if (!files.length) return ["No changed files to review."]
  if (!review.parsed) return ["The agent's answer could not be read (no valid `findings` block). Nothing is reported; check the run log."]
  if (!review.findings.length) return [`No findings in ${files.length} changed ${plural(files.length, "file", "files")}.`]
  const shown = review.findings.slice(0, MAX_FINDINGS)
  const counts = SEVERITIES.map((s) => [s, review.findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n)
  const rows = shown.map((f) => {
    const where = `\`${f.file.replace(/`/g, "'")}${f.line ? `:${f.line}` : ""}\``
    const finding = `**${safe(f.title)}**${f.why ? `<br>${safe(f.why)}` : ""}`
    return `| ${ICON[f.severity]} | ${where} | ${finding} | ${safe(f.fix)} |`
  })
  const more = review.findings.length - shown.length
  return [counts.map(([s, n]) => `${ICON[s]} ${n} ${s}`).join(" · "), "", "| | Where | Finding | Fix |", "|---|---|---|---|", ...rows, ...(more ? ["", `… and ${more} more (see the run log).`] : [])]
}

/** What was left out, and the footer that says this is advice. */
function notes(input: CommentInput, safe: (s: string) => string): string[] {
  const { dropped } = input.review
  const skipped = input.skipped ?? 0
  const out: string[] = []
  if (dropped) out.push("", `${dropped} ${plural(dropped, "entry was", "entries were")} ignored (outside the change or incomplete).`)
  if (skipped) out.push("", `${skipped} changed ${plural(skipped, "file was", "files were")} not reviewed (lockfiles, media, vendored code, or more than ${MAX_FILES} files).`)
  const commit = input.commit?.replace(/[^0-9a-f]/gi, "").slice(0, 12)
  const run = input.runUrl && /^https:\/\/github\.com\/[\w./-]+$/.test(input.runUrl) ? input.runUrl : undefined
  const meta = [input.model && ` Model: ${safe(input.model)}.`, commit && ` Commit: \`${commit}\`.`, run && ` [Run log](${run}).`].filter(Boolean).join("")
  out.push("", `<sub>This review is advice from a model and can be wrong. It never blocks the merge: the required check is \`security-gate\` (Semgrep, gitleaks, bun audit, Trivy).${meta}</sub>`)
  return out
}

/** The pull request comment. It always starts with the marker, so the workflow can update it instead of adding more. */
export function renderSecurityComment(input: CommentInput): string {
  const safe = (s: string) => plainMarkdown(input.mask(s))
  const out = [SECURITY_MARKER, "### Bobi security agent (advisory)", "", ...body(input, safe), ...notes(input, safe)].join("\n")
  return out.length <= MAX_COMMENT ? out : `${out.slice(0, MAX_COMMENT)}\n\n… (cut, the comment is too long)`
}
