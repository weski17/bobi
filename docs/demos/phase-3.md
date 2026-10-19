# Demo – Phase 3: MCP client and the code graph server

No real model needed (mock model). Setup as in [phase 1](phase-1.md).

## 1. Tests

```bash
bun run typecheck
bun run test:coverage     # 242 pass
bun run test:sandbox      # 6 pass, incl. the code graph inside the container
```

## 2. The code graph on its own

```bash
bun mcp-servers/code-graph/src/cli.ts ~/your/ts-project    # MCP server over stdio
```

Tools: `find_symbol`, `callers`, `callees`, `call_path`, `dependencies`, `dependents` – e.g. "who calls `save`, up to
three levels", "how does `main` reach `double`", "which files are affected if I change `src/util/math.ts`".

## 3. In Bobi

```bash
cd ~/your/ts-project && bobi
```

Switch to **Advanced** (Shift+Tab). The model now sees `code-graph_*` tools; Code, Plan, Ask and Orchestrator do not.
Every call asks for approval (Allow once / Always allow / Reject); the result reaches the model marked as untrusted data.

Allow the code graph without asking – `.bobi/config.jsonc`:

```jsonc
{ "autoApprove": [{ "action": "mcp", "resource": "code-graph_*" }] }
```

## 4. Own MCP servers

`~/.bobi/config.jsonc` (all projects) or `.bobi/config.jsonc` (trusted project):

```jsonc
{
  "mcp": {
    "servers": {
      "jira": { "type": "remote", "url": "https://jira.intranet/mcp", "headers": { "Authorization": "Bearer ${JIRA_TOKEN}" } }
    }
  }
}
```

`export JIRA_TOKEN=…` before starting Bobi. A literal token in the file is rejected; a missing variable disables the
server. In the sandbox add the host to `BOBI_EGRESS_ALLOW`.

A mode for tickets only – `.bobi/custom_modes.yaml`:

```yaml
customModes:
  - slug: tickets
    name: Tickets
    roleDefinition: You triage tickets.
    groups:
      - read
      - - mcp
        - servers: [jira]
```
