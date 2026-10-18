# Demo – Phase 1: Bobi core

What you will see: Bobi answers through a configurable model endpoint, asks before every write and
shell command, masks secrets, marks tool output as untrusted data, and audits every action.
No real model needed – the demo uses the mock model.

## 0. Setup (once)

```bash
brew install oven-sh/bun/bun node@24 ripgrep bash
cd ~/Documents/GitHub/bobi
git submodule update --init --depth 1
(cd vendor/opencode && bun install)
bun install
bun run browser:install
```

## 1. Run the tests

```bash
bun run typecheck
bun run test:coverage
```

Expected: 105 pass, 1 todo, 0 fail; coverage above 80 %.

## 2. Start the mock model (terminal 1)

```bash
bun packages/mock-model/src/cli.ts --port 4011
```

## 3. Talk to Bobi headless (terminal 2)

```bash
mkdir -p /tmp/bobi-demo && cd /tmp/bobi-demo
export BOBI_MODEL_BASE_URL=http://127.0.0.1:4011/v1 BOBI_MODEL=mock-model BOBI_MODEL_API_KEY=demo
bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts run "hello bobi" </dev/null
```

Expected: `mock reply to: "hello bobi"`.

## 4. See a write being blocked

Restart the mock model with a script that tries to write a file:

```bash
echo '[{"toolCalls":[{"name":"write","arguments":{"path":"/tmp/bobi-demo/pwned.txt","content":"x"}}]},{"text":"gave up"}]' > /tmp/turns.json
bun packages/mock-model/src/cli.ts --port 4011 --script /tmp/turns.json
```

Then in terminal 2:

```bash
bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts run "write a file" </dev/null
ls /tmp/bobi-demo
```

Expected: `permission requested: edit … auto-rejecting`, and no `pwned.txt`.

## 5. Interactive (TUI)

```bash
cd /tmp/bobi-demo
bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts
```

With the write script from step 4 loaded, send any message: Bobi shows an approval prompt for the write.
Choose "reject" or "allow once". (Not yet verified by an automated test – please check manually.)

## 6. Safeguards of the launcher

```bash
bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts run --auto "x"   # refused
bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts upgrade          # refused
```

## 7. Real model

Point Bobi at your LiteLLM gateway instead of the mock:

```bash
export BOBI_MODEL_BASE_URL=http://localhost:4000/v1 BOBI_MODEL=<model id> BOBI_MODEL_API_KEY=<key>
```

or copy `bobi.example.jsonc` to `~/.bobi/config.jsonc`. Audit spans go to `OTEL_EXPORTER_OTLP_ENDPOINT` if set.
