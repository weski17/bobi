# Demo – Phase 5: orchestrator, skills, slash commands, git, security, literate coding

Mock model or a real gateway as in the earlier demos.

## 1. Tests

```bash
bun run test:coverage   # 290 pass
bun run test:e2e        # incl. slash commands in the terminal UI
bun run test:ide        # incl. literate coding and the commit message button
```

## 2. Modes in the shell

```bash
bobi modes                              # code, plan, ask, advanced, orchestrator, security + own modes
bobi run --mode security "review src/auth for injection" </dev/null
```

## 3. Orchestrator

Switch to **Orchestrator** and give a large task. It splits it and delegates subtasks to Plan, Code, Ask or Security.
Every write or command of a subtask still asks you – in the TUI and in the IDE panel.

## 4. Slash commands

- `/commit` – reads the staged diff (no question), writes a message, asks before `git commit`.
- `/pr` – asks before `git push` and `gh pr create`.
- `/security-review src/auth` – switches to Security mode and reports findings with severity and fixes.
- `/init` – writes AGENTS.md.

Own command – `.bobi/commands/explain.md`:

```markdown
---
description: Explain a file to a new team member
mode: ask
---
Explain $ARGUMENTS to a new team member: purpose, main flow, pitfalls.
```

Then `/explain src/app.ts`.

## 5. Skills

`~/.bobi/skills/review-guide/SKILL.md`:

```markdown
---
name: review-guide
description: How our team reviews code
---
Always check error handling, logging of personal data and missing tests.
```

Bobi loads it when a task matches (skill tool).

## 6. In Bobi IDE

- **Literate coding:** write `// read the port from the config and default to 8080` above an empty line, put the cursor
  in the comment, press **Cmd+Alt+Enter**. The implementation arrives as a diff for approval.
- **Commit message:** stage changes, click the ✨ button in the Source Control title bar.
