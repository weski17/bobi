# Demo – Phase 2: modes, custom modes, rules, AGENTS.md, .bobiignore

No real model needed (mock model). Setup as in [phase 1](phase-1.md).

## 1. Tests

```bash
bun run typecheck
bun run test:coverage     # 193 pass
bun run test:e2e          # terminal UI: approvals and mode switching
```

## 2. Modes in the terminal UI

```bash
bun packages/mock-model/src/cli.ts --port 4011          # terminal 1
mkdir -p ~/bobi-demo2 && cd ~/bobi-demo2                 # terminal 2
export BOBI_MODEL_BASE_URL=http://127.0.0.1:4011/v1 BOBI_MODEL=mock-model BOBI_MODEL_API_KEY=demo
bobi
```

The UI starts in **Code**. `Shift+Tab` cycles through **Plan**, **Ask**, **Advanced**, **Orchestrator**.

| Mode | Read | Edit | Terminal | Browser | MCP | Delegate |
|---|---|---|---|---|---|---|
| code (default) | ✓ | ✓ | ✓ | ✓ | – | – |
| plan | ✓ | Markdown only | – | ✓ | – | – |
| ask | ✓ | – | – | – | – | – |
| advanced | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| orchestrator | ✓ | – | – | – | – | ✓ |

Edits and commands still ask for approval in every mode (phase 1).

## 3. Own modes

```bash
mkdir -p .bobi && cp ~/Documents/GitHub/bobi/docs/examples/custom_modes.yaml .bobi/
bobi
```

`Shift+Tab` now also offers **Reviewer**, and **Ask** may edit `docs/*.md`. A syntax error in the file is reported
with its line, e.g. `customModes[0].groups[1]: unknown group "command"`.

Different model per mode – `.bobi/config.jsonc`:

```jsonc
{ "modes": { "plan": { "model": "large-model" }, "code": { "model": "small-model" } } }
```

## 4. Rules and AGENTS.md

```bash
echo "Use tabs for indentation." > AGENTS.md
mkdir -p .bobi/rules .bobi/rules-plan
echo "Write all plans in German." > .bobi/rules-plan/language.md
echo "Never commit directly to main." > .bobi/rules/git.md
```

Bobi adds them to the system prompt in this order: `~/.bobi/rules-<mode>/`, `~/.bobi/rules/`, `.bobi/rules-<mode>/`,
`AGENTS.md`, `.bobi/rules/` – the plan rule only in Plan mode. Type `/init` to let Bobi write `AGENTS.md` itself.

## 5. .bobiignore

```bash
printf 'secrets/\n.env*\n' > .bobiignore
```

Reading `secrets/…` or `.env` is refused ("blocked by .bobiignore"), search results hide those files, and
`cat .env` in the terminal tool is blocked. Changes to `.bobi/` or `.bobiignore` always ask, even with auto-approve.
