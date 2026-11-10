# Security gate (pull requests, pushes, merges)

Workflow: [`.github/workflows/security.yml`](../../.github/workflows/security.yml) · decision: [ADR-0027](../adr/0027-security-gate.md)

## What runs

| Job | Tool | Fails on | Pull request | Push |
|---|---|---|---|---|
| `semgrep` | Semgrep CE, rules `p/typescript`, `p/secrets` | any finding | only findings the change adds (baseline: merge base) | whole code |
| `secrets` | gitleaks 8.28 | any secret | the pull request's commits | the pushed commits |
| `deps` | `bun audit` | vulnerability high or critical | whole lockfile | whole lockfile |
| `config` | Trivy 0.57 (file system) | misconfiguration or vulnerability high or critical with a fix | whole repository (without `vendor/`) | same |
| `security-gate` | – | any job above not green | ✔ | ✔ |
| `security-agent` | Bobi, mode `security-ci` | never (advice) | changed files, one comment | – |

A merge is a push to `main`, so every merge is scanned again with the merged result.

## Making it block

A workflow runs after a push; it cannot stop it. Blocking is a branch rule on `main`: changes only by pull request, and
`security-gate` must be green. The repository owner sets it once (GitHub → Settings → Rules → Rulesets, or):

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input - <<'JSON'
{
  "name": "main: pull requests with a green security gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false,
      "required_status_checks": [{ "context": "security-gate" }] } }
  ]
}
JSON
```

Pushes to other branches are scanned and reported, not blocked.

## When the gate is red

- **Semgrep:** fix the code, or, if it is a false alarm, a `// nosemgrep: <rule-id>` comment on the line with a reason.
- **gitleaks:** a real secret is compromised as soon as it is pushed: revoke it first, then remove it. Rewriting history
  alone does not help. A fake value in a test: add exactly that file to `.gitleaks.toml` after checking every match in it.
- **bun audit:** update the dependency; if there is no fix, the pull request waits or the risk is accepted in writing.
- **Trivy:** fix the configuration; accepted findings go into `.trivyignore.yaml` with a reason and an expiry date
  (process: [image-scan.md](image-scan.md)).

## The advisory agent

Turned on by the repository variable `BOBI_SECURITY_AGENT=true` and a self-hosted runner with the labels
`self-hosted, bobi-model` in the network of your model. Settings: variables `BOBI_MODEL_BASE_URL`, `BOBI_MODEL` (or
`BOBI_SECURITY_MODEL` for this job only), secret `BOBI_MODEL_API_KEY`.

- It reviews at most 40 changed files (no lockfiles, media or vendored code) and writes one comment, which it updates on
  the next push. The run log is kept for 14 days as artifact `security-agent-log` (secrets masked).
- Mode `security-ci` can only read; it cannot run commands or change files. Bobi comes from the base commit, the reviewed
  project is not trusted (its `AGENTS.md`, rules and modes are ignored), pull requests from forks are not reviewed.
- The comment is advice from a model and can be wrong. It never blocks; a human decides.
- Locally: `bun scripts/security-agent.ts --base origin/main --out comment.md` inside the checkout, with the model settings
  in the environment.
