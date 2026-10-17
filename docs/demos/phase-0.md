# Demo – Phase 0

Phase 0 produces documents, not running code. To review it:

1. Start a session for the current phase:
   ```bash
   bash start-bobi.sh
   ```
2. Read in this order:
   - [docs/STATUS.md](../STATUS.md) – findings, open questions, risks
   - [docs/ARCHITECTURE.md](../ARCHITECTURE.md) – overview, layers, folder structure, requirement mapping
   - [docs/adr/](../adr/README.md) – one decision per file
   - [docs/analysis/](../analysis/) – upstream details with file paths
3. Optional: reproduce the analysis
   ```bash
   mkdir -p .upstream && cd .upstream
   git clone --depth 1 https://github.com/anomalyco/opencode.git opencode
   git clone --depth 1 --filter=blob:limit=200k https://github.com/microsoft/vscode.git code-oss
   ```
4. Approve or change the ADRs and answer the open questions in STATUS.md → then Phase 1 starts on branch `phase-1-core`.
