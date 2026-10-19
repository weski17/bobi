# Demo – Phase 1: Bobi as its own application

What you will see: `bobi` runs its own server (engine + Bobi core), answers through a configurable model endpoint,
asks before every write and shell command, masks secrets, marks tool output as untrusted data, audits every action,
and can run inside a Podman sandbox whose only way out is an allowlist proxy. No real model needed (mock model).

## 0. Setup (once)

```bash
brew install oven-sh/bun/bun ripgrep bash podman
cd ~/Documents/GitHub/bobi
git submodule update --init --depth 1
(cd vendor/opencode && bun install) && bun install && bun run browser:install
bash scripts/install.sh            # `bobi` in ~/.local/bin
```

## 1. Tests

```bash
bun run typecheck
bun run test:coverage              # 136 pass, 1 todo
```

## 2. Mock model (terminal 1)

```bash
bun packages/mock-model/src/cli.ts --port 4011
```

## 3. Terminal UI (terminal 2)

```bash
mkdir -p ~/bobi-demo && cd ~/bobi-demo
export BOBI_MODEL_BASE_URL=http://127.0.0.1:4011/v1 BOBI_MODEL=mock-model BOBI_MODEL_API_KEY=demo
bobi
```

You see the Bobi logo and "Bobi model endpoint". Type something – the mock answers `mock reply to: …`.

## 4. Headless and the approval rule

```bash
bobi run "hello bobi" </dev/null
echo '[{"toolCalls":[{"name":"write","arguments":{"path":"'$HOME'/bobi-demo/pwned.txt","content":"x"}}]},{"text":"gave up"}]' > /tmp/turns.json
```

Restart the mock with `--script /tmp/turns.json`, then:

```bash
bobi run "write a file" </dev/null   # "permission requested: edit … auto-rejecting"
ls ~/bobi-demo                         # no pwned.txt
bobi                                   # same script interactively: Bobi shows an approval prompt
```

## 5. Safeguards of the command line

```bash
bobi run --auto x        # refused
bobi upgrade             # refused
ls ~/.bobi               # Bobi's own data: data/bobi.db, snapshots, logs
```

## 6. Sandbox

```bash
podman machine init && podman machine start      # once
podman build -f sandbox/Containerfile -t bobi:dev .
export BOBI_SERVER_PASSWORD="$(openssl rand -base64 24)"
export BOBI_MODEL_BASE_URL=http://host.containers.internal:4011/v1 BOBI_EGRESS_ALLOW=host.containers.internal:4011
sandbox/bobi-sandbox.sh up ~/bobi-demo
cd ~/bobi-demo && bobi attach http://127.0.0.1:4096
sandbox/bobi-sandbox.sh status                   # egress decisions, e.g. example.com:443 allowed:false
sandbox/bobi-sandbox.sh down
```

Automated: `bun run test:sandbox` (3 tests: answers via allowed endpoint, blocked egress, unprivileged).

## 7. Real model

```bash
export BOBI_MODEL_BASE_URL=http://localhost:4000/v1 BOBI_MODEL=<model id> BOBI_MODEL_API_KEY=<key>
```

or copy `bobi.example.jsonc` to `~/.bobi/config.jsonc`. Audit spans go to `OTEL_EXPORTER_OTLP_ENDPOINT` if set.
