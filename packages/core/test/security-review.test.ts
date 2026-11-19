import { describe, expect, test } from "bun:test"
import { createMasker, MASK } from "../src/masking.ts"
import { MAX_FILES, MAX_FINDINGS, parseSecurityFindings, plainMarkdown, renderSecurityComment, reviewableFiles, SECURITY_MARKER, securityReviewPrompt } from "../src/security-review.ts"

const changed = ["src/db.ts", "src/auth.ts"]
const block = (json: unknown) => `Some thinking first.\n\n\`\`\`findings\n${JSON.stringify(json)}\n\`\`\`\n`
const mask = createMasker()

describe("which files are reviewed", () => {
  test("lockfiles, media and vendored code are left out, and so is everything beyond the limit", () => {
    expect(reviewableFiles(["src/a.ts", "bun.lock", "docs/x.png", "vendor/opencode/y.ts", "node_modules/z/i.js", "a/package-lock.json"])).toEqual({ files: ["src/a.ts"], skipped: 5 })
    const many = Array.from({ length: MAX_FILES + 3 }, (_, i) => `src/f${i}.ts`)
    expect(reviewableFiles(many)).toEqual({ files: many.slice(0, MAX_FILES), skipped: 3 })
  })
})

describe("security review prompt", () => {
  test("names the base, every changed file and the fixed answer format", () => {
    const p = securityReviewPrompt("origin/main", changed)
    expect(p).toContain("origin/main")
    for (const f of changed) expect(p).toContain(`- ${f}`)
    expect(p).toContain("```findings")
    expect(p).toContain('"critical", "high", "medium", "low"')
  })
})

describe("parsing the agent's answer", () => {
  test("reads findings, normalises severity and sorts the worst first", () => {
    const r = parseSecurityFindings(
      block([
        { file: "src/auth.ts", line: 3, severity: "Low", title: "weak hash", why: "md5", fix: "use bcrypt" },
        { file: "./src/db.ts", line: 12, severity: "critical", title: "SQL injection", why: "concatenated", fix: "bind parameters" },
      ]),
      changed,
    )
    expect(r.parsed).toBe(true)
    expect(r.findings.map((f) => [f.file, f.severity])).toEqual([["src/db.ts", "critical"], ["src/auth.ts", "low"]])
  })

  test("drops findings outside the change, with unknown severity or without a title", () => {
    const r = parseSecurityFindings(
      block([
        { file: "src/other.ts", severity: "high", title: "invented" },
        { file: "src/db.ts", severity: "urgent", title: "bad severity" },
        { file: "src/db.ts", severity: "high" },
        "not an object",
        { file: "src/db.ts", line: -4, severity: "high", title: "kept, line ignored" },
      ]),
      changed,
    )
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]!.line).toBeUndefined()
    expect(r.dropped).toBe(4)
  })

  test("the last block counts, json blocks are accepted too", () => {
    const out = `${block([{ file: "src/db.ts", severity: "high", title: "first" }])}\n\`\`\`json\n[]\n\`\`\``
    expect(parseSecurityFindings(out, changed)).toEqual({ findings: [], dropped: 0, parsed: true })
  })

  test.each([
    ["no block", "I looked at the code and it is fine."],
    ["broken JSON", "```findings\n[{file: x}]\n```"],
    ["not a list", '```findings\n{"file": "src/db.ts"}\n```'],
  ])("%s is not read as 'no findings'", (_, out) => {
    expect(parseSecurityFindings(out, changed).parsed).toBe(false)
  })
})

describe("the comment", () => {
  test("model text cannot add HTML, links, mentions or table cells", () => {
    const s = plainMarkdown("<img src=x onerror=alert(1)> [click](https://evil.example) @admin a|b\nnext")
    // every special character is escaped, links lose their scheme, mentions are broken up
    expect(s).not.toMatch(/(^|[^\\])[<>|[\]()]|https:\/\/|@admin|\n/)
    expect(s).toContain("\\<img")
  })

  test("starts with the marker, counts by severity and says it is advice only", () => {
    const review = parseSecurityFindings(block([{ file: "src/db.ts", line: 12, severity: "high", title: "SQL injection", why: "input in query", fix: "bind it" }]), changed)
    const c = renderSecurityComment({ review, files: changed, mask, model: "qwen3:8b", commit: "abcdef1234567890ff", runUrl: "https://github.com/o/r/actions/runs/1" })
    expect(c.startsWith(SECURITY_MARKER)).toBe(true)
    expect(c).toContain("🟧 1 high")
    expect(c).toContain("`src/db.ts:12`")
    expect(c).toContain("never blocks the merge")
    expect(c).toContain("`abcdef123456`")
    expect(c).toContain("[Run log](https://github.com/o/r/actions/runs/1)")
  })

  test("secrets the model repeats are masked", () => {
    const review = parseSecurityFindings(block([{ file: "src/auth.ts", severity: "critical", title: "hard-coded key", why: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 in code", fix: "move it to a secret" }]), changed)
    const c = renderSecurityComment({ review, files: changed, mask })
    expect(c).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789")
    expect(c).toContain(plainMarkdown(MASK))
  })

  test("an unreadable answer and an empty change say so", () => {
    expect(renderSecurityComment({ review: { findings: [], dropped: 0, parsed: false }, files: changed, mask })).toContain("could not be read")
    expect(renderSecurityComment({ review: { findings: [], dropped: 0, parsed: true }, files: changed, mask })).toContain("No findings in 2 changed files.")
    expect(renderSecurityComment({ review: { findings: [], dropped: 0, parsed: true }, files: [], mask })).toContain("No changed files")
  })

  test("a run URL that is not GitHub is left out, the list is limited", () => {
    const many = Array.from({ length: MAX_FINDINGS + 5 }, (_, i) => ({ file: "src/db.ts", line: i + 1, severity: "low", title: `t${i}` }))
    const c = renderSecurityComment({ review: parseSecurityFindings(block(many), changed), files: changed, mask, runUrl: "https://evil.example/x" })
    expect(c).not.toContain("evil.example")
    expect(c).toContain("… and 5 more")
    expect(c.split("\n").filter((l) => l.startsWith("| 🟦")).length).toBe(MAX_FINDINGS)
  })
})
