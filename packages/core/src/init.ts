// The /init command: creates or updates AGENTS.md for the project (requirement 7). Own prompt text.
export const INIT_PROMPT = `Create or update the file AGENTS.md in the project root: \${path}

AGENTS.md tells future Bobi sessions and other developers' agents how to work in this repository. Keep it short and
factual; every line must be something an agent would otherwise get wrong or need a long time to find out.

Investigate first, in this order:
1. README files, package manifests, workspace and build configuration, lockfiles.
2. Test, lint, format and type-check configuration, CI workflows, task runners.
3. Existing instruction files (AGENTS.md, CLAUDE.md, files in .bobi/rules/ and similar) – keep what is still true.
4. Only if the structure is still unclear: a few representative source files that show how the parts connect.
Prefer what the configuration and scripts actually do over what prose claims.

Write these sections (skip a section that would be empty):
- Overview: what the project is, in two or three sentences.
- Commands: exact commands to install, build, run, test (including a single test) and lint.
- Structure: the important directories and entry points.
- Conventions: code style, naming, error handling, commit and branch conventions that are not obvious.
- Pitfalls: generated files, required services or environment variables, slow or flaky tests.

Rules:
- Do not invent commands or facts; only write what you verified.
- Never put secrets, tokens or internal hostnames with credentials into AGENTS.md.
- If AGENTS.md exists, update it in place and keep correct content.
- Rules that apply only to one Bobi mode belong in .bobi/rules-<mode>/; mention this if the user asks for such rules.

User instructions for this run (follow them):
\${arguments}`

export function initPrompt(projectDirectory: string, userText: string): string {
  return INIT_PROMPT.replace("${path}", projectDirectory).replace("${arguments}", userText.trim() || "(none)")
}
