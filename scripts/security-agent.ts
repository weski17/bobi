#!/usr/bin/env bun
// The advisory security agent of .github/workflows/security.yml (ADR-0027). Run it inside the checkout under review:
//   bun <bobi>/scripts/security-agent.ts --base origin/main [--out comment.md] [--log agent.log]
// It reviews the files changed since <base> with `bobi run --mode security-ci` (read-only) and writes the pull request
// comment. Bobi itself comes from the checkout this script lives in, not from the code under review, and the reviewed
// project is not trusted, so its AGENTS.md, rules and modes are ignored. It always exits 0 after a review: the agent
// advises, it does not decide. Model settings come from the environment (BOBI_MODEL_BASE_URL, BOBI_MODEL, …).
import { writeFileSync } from "node:fs"
import path from "node:path"
import { createMasker, parseSecurityFindings, renderSecurityComment, reviewableFiles, securityReviewPrompt } from "@bobi/core"

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const base = opt("base")
if (!base) {
  console.error("usage: bun scripts/security-agent.ts --base <ref> [--out comment.md] [--log agent.log]")
  process.exit(2)
}
const out = opt("out") ?? "security-comment.md"
const log = opt("log")
const timeout = Number(process.env.BOBI_AGENT_TIMEOUT ?? 900) * 1000
const env = process.env as Record<string, string>
const mask = createMasker([env.BOBI_MODEL_API_KEY, env.GITHUB_TOKEN, env.GH_TOKEN])

const diff = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
if (diff.exitCode !== 0) {
  console.error(`security-agent: git diff against ${base} failed: ${diff.stderr.toString().trim()}`)
  process.exit(2)
}
const changed = diff.stdout.toString().split("\n").filter(Boolean)
const { files, skipped } = reviewableFiles(changed)

let output = ""
if (files.length) {
  const cli = path.join(import.meta.dir, "..", "packages", "shell", "src", "cli.ts")
  const child = Bun.spawn(["bun", cli, "run", "--mode", "security-ci", securityReviewPrompt(base, files)], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, NO_COLOR: "1", BOBI_USER: env.BOBI_USER ?? "security-agent" },
  })
  const timer = setTimeout(() => child.kill(), timeout)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  clearTimeout(timer)
  output = stdout
  if (log) writeFileSync(log, mask(`exit ${code}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`))
  if (code !== 0) console.error(`security-agent: bobi run ended with ${code}${child.killed ? " (timeout)" : ""}`)
}

const review = parseSecurityFindings(output, files)
const comment = renderSecurityComment({
  review,
  files,
  skipped,
  mask,
  model: env.BOBI_MODEL,
  commit: env.GITHUB_SHA,
  runUrl: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
})
writeFileSync(out, comment)
console.error(`security-agent: ${files.length} file(s) reviewed, ${review.findings.length} finding(s)${review.parsed ? "" : ", answer not readable"} → ${out}`)
