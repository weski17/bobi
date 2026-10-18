// Test harness: OpenCode SDK in-process + @bobi/core + mock model. No network beyond localhost.
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode/sdk"
import { DEFAULTS, SDK_OFFLINE_OPTIONS, toOpenCodeConfig, type BobiConfig } from "@bobi/config"
import { createBobiCore, MemorySink } from "@bobi/core"
import { startMockModel, type MockModel, type Turn } from "@bobi/mock-model"

export type Harness = {
  readonly dir: string
  readonly mock: MockModel
  readonly audit: MemorySink
  readonly opencode: Awaited<ReturnType<typeof OpenCode.create>>
  /** Starts a session in `dir`, sends one prompt and returns the session id. */
  prompt(text: string, ...turns: Turn[]): Promise<string>
  close(): Promise<void>
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await Bun.sleep(20)
  }
  throw new Error("waitFor: timed out")
}

export async function createHarness(patch: Partial<BobiConfig> = {}, secrets: string[] = [], options: { browser?: boolean } = {}): Promise<Harness> {
  const mock = startMockModel({ models: ["mock-model"] })
  // Resolve symlinks (macOS: /var -> /private/var). OpenCode compares the session directory with the
  // real git worktree path and silently skips snapshots when they differ.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-it-")))
  const configDir = await mkdtemp(path.join(tmpdir(), "bobi-it-config-"))
  const config: BobiConfig = {
    ...structuredClone(DEFAULTS),
    ...patch,
    model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" },
    telemetry: { user: "tester" },
  }
  const audit = new MemorySink()
  // The browser tool is only registered where a test needs it, so other tests don't depend on Chromium.
  const core = createBobiCore({ config, audit, secrets, ...(options.browser ? {} : { browser: false }) })
  process.env.BOBI_MODEL_API_KEY = "it-test-key"
  const opencode = await OpenCode.create({
    config: { directory: configDir, project: false, content: JSON.stringify(toOpenCodeConfig(config)) },
    ...SDK_OFFLINE_OPTIONS,
    fs: { filewatcher: false },
    plugins: [core],
  })
  return {
    dir,
    mock,
    audit,
    opencode,
    async prompt(text, ...turns) {
      mock.enqueue(...turns)
      const session = await opencode.sessions.create({ location: { directory: dir } })
      await opencode.sessions.prompt({ sessionID: session.id, text })
      return session.id
    },
    async close() {
      await opencode.close()
      await mock.stop()
      await rm(dir, { recursive: true, force: true })
      await rm(configDir, { recursive: true, force: true })
    },
  }
}

/** Waits until the session has a pending permission request and returns it. */
export function pendingPermission(h: Harness, sessionID: string) {
  return waitFor(async () => {
    const list = await h.opencode.permission.list({ sessionID })
    return list[0]
  })
}
