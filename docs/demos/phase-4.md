# Demo – Phase 4: Bobi IDE

Bobi IDE is Code-OSS with Bobi branding and a built-in Bobi chat panel. It runs from source for now.

## 0. Setup (once, ~10 minutes)

```bash
cd ~/Documents/GitHub/bobi
bun run ide:setup          # Code-OSS dependencies, compile, branding, Bobi extension
bash scripts/install.sh    # installs `bobi` and `bobi-ide` into ~/.local/bin
```

## 1. Tests

```bash
bun run test:coverage      # 271 pass (incl. the chat controller against a real Bobi server)
bun run test:ide           # opens Bobi IDE for ~20 s and runs the integration test inside it
```

## 2. Start

```bash
bun packages/mock-model/src/cli.ts --port 4011                       # terminal 1 (or a real gateway)
export BOBI_MODEL_BASE_URL=http://127.0.0.1:4011/v1 BOBI_MODEL=mock-model BOBI_MODEL_API_KEY=demo
bobi-ide ~/your/project                                              # terminal 2
```

- The window is called **Bobi IDE** with the Bobi icon. The **Bobi** icon in the activity bar opens the chat panel.
- Projects with `AGENTS.md` or `.bobi/` files ask for trust in a dialog (like workspace trust).
- Pick the mode at the top (Code, Plan, Ask, Advanced, Orchestrator).
- Open files and the current selection are sent as context automatically (setting `bobi.includeOpenTabs`).

## 3. Diff before apply

Ask for a change. Bobi shows **"Bobi wants to edit: …"** with *Accept / Always / Reject*, and the **diff editor** opens
with the current file on the left and the proposal on the right. Nothing is written before *Accept*.
Commands and other actions are approved the same way.

**Undo** at the top reverts everything the last request changed.

## 4. Settings

- `bobi.command` – how to start Bobi (default: `~/.local/bin/bobi`).
- `bobi.includeOpenTabs` – send open editors and the selection as context.
