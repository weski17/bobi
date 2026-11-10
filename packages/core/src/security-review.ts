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

/**
 * Reads the agent's answer. The last `findings` (or `json`) block counts; findings for files outside the change are
 * dropped, because the model may invent them. A missing or broken block yields `parsed: false`.
 */
export function parseSecurityFindings(output: string, changed: readonly string[]): ParsedReview {
  const blocks = [...output.matchAll(/```(?:findings|json)[^\S\n]*\n([\s\S]*?)```/g)]
  const body = blocks.at(-1)?.[1]
  if (body === undefined) return { findings: [], dropped: 0, parsed: false }
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return { findings: [], dropped: 0, parsed: false }
  }
  if (!Array.isArray(data)) return { findings: [], dropped: 0, parsed: false }
  const files = new Set(changed)
  const findings: SecurityFinding[] = []
  let dropped = 0
  for (const item of data) {
    const f = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    const file = text(f.file)?.replace(/^\.\//, "")
    const severity = text(f.severity)?.toLowerCase() as Severity | undefined
    const title = text(f.title)
    if (!file || !files.has(file) || !severity || !SEVERITIES.includes(severity) || !title) {
      dropped++
      continue
    }
    const line = typeof f.line === "number" && Number.isInteger(f.line) && f.line > 0 ? f.line : undefined
    findings.push({ file, line, severity, title, why: text(f.why) ?? "", fix: text(f.fix) ?? "" })
  }
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
  return { findings, dropped, parsed: true }
}

/**
 * Model text as plain text in Markdown: no HTML, no links or images, no mentions (they would notify people), no table
 * breaks. What the model writes can come from the reviewed code, so it must not be able to shape the comment.
 */
export function plainMarkdown(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, (c) => `\\${c}`)
    .replace(/@/g, "@​")
    .replace(/:\/\//g, ":​//")
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

/** The pull request comment. It always starts with the marker, so the workflow can update it instead of adding more. */
export function renderSecurityComment(input: CommentInput): string {
  const { review, files, mask } = input
  const safe = (s: string) => plainMarkdown(mask(s))
  const lines = [SECURITY_MARKER, "### Bobi security agent (advisory)", ""]
  if (!files.length) lines.push("No changed files to review.")
  else if (!review.parsed) {
    lines.push("The agent's answer could not be read (no valid `findings` block). Nothing is reported; check the run log.")
  } else if (!review.findings.length) {
    lines.push(`No findings in ${files.length} changed file${files.length === 1 ? "" : "s"}.`)
  } else {
    const shown = review.findings.slice(0, MAX_FINDINGS)
    const counts = SEVERITIES.map((s) => [s, review.findings.filter((f) => f.severity === s).length] as const).filter(([, n]) => n)
    lines.push(counts.map(([s, n]) => `${ICON[s]} ${n} ${s}`).join(" · "), "")
    lines.push("| | Where | Finding | Fix |", "|---|---|---|---|")
    for (const f of shown) {
      const where = `\`${f.file.replace(/`/g, "'")}${f.line ? `:${f.line}` : ""}\``
      const finding = `**${safe(f.title)}**${f.why ? `<br>${safe(f.why)}` : ""}`
      lines.push(`| ${ICON[f.severity]} | ${where} | ${finding} | ${safe(f.fix)} |`)
    }
    if (review.findings.length > shown.length) lines.push("", `… and ${review.findings.length - shown.length} more (see the run log).`)
  }
  if (review.dropped) lines.push("", `${review.dropped} entr${review.dropped === 1 ? "y was" : "ies were"} ignored (outside the change or incomplete).`)
  if (input.skipped) lines.push("", `${input.skipped} changed file${input.skipped === 1 ? " was" : "s were"} not reviewed (lockfiles, media, vendored code, or more than ${MAX_FILES} files).`)
  lines.push(
    "",
    "<sub>This review is advice from a model and can be wrong. It never blocks the merge: the required check is `security-gate`" +
      " (Semgrep, gitleaks, Trivy)." +
      [input.model && ` Model: ${safe(input.model)}.`, input.commit && ` Commit: \`${input.commit.replace(/[^0-9a-f]/gi, "").slice(0, 12)}\`.`, input.runUrl && /^https:\/\/github\.com\/[\w./-]+$/.test(input.runUrl) && ` [Run log](${input.runUrl}).`]
        .filter(Boolean)
        .join("") +
      "</sub>",
  )
  const out = lines.join("\n")
  return out.length <= MAX_COMMENT ? out : `${out.slice(0, MAX_COMMENT)}\n\n… (cut, the comment is too long)`
}
