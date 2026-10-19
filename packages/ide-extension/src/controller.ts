// The chat session logic, independent of the VS Code API: talks to the Bobi server and drives a UI port.
import { BobiClient, type Agent, type BobiEvent, type Decision, type PermissionRequest } from "./client.ts"

export type ContextFile = { uri: string; name: string }

/** What the controller needs from the IDE. */
export interface UiPort {
  post(message: ToUi): void
  /** Shows proposed edits (diff editor) for an approval; returns when the views are open. */
  showDiff(request: PermissionRequest): Promise<void>
  error(message: string): void
}

export type ToUi =
  | { type: "ready"; modes: { id: string; name: string }[]; mode: string }
  | { type: "user"; text: string; context: string[] }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "approval"; id: string; action: string; resources: string[]; diff: boolean }
  | { type: "approval-done"; id: string; decision: Decision }
  | { type: "busy"; busy: boolean }
  | { type: "mode"; mode: string }
  | { type: "cleared" }
  | { type: "error"; message: string }

const MODE_ORDER = ["code", "plan", "ask", "advanced", "orchestrator"]

function summarize(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const i = input as Record<string, unknown>
    for (const key of ["path", "command", "url", "pattern", "symbol", "query"]) if (typeof i[key] === "string") return String(i[key])
  }
  return ""
}

export class ChatController {
  private sessionID: string | undefined
  private mode = "code"
  private lastUserMessage: string | undefined
  readonly pending = new Map<string, PermissionRequest>()
  private readonly toolNames = new Map<string, string>()
  private busy = false
  private idleWaiters: (() => void)[] = []
  private readonly abort = new AbortController()

  constructor(
    private readonly client: BobiClient,
    private readonly directory: string,
    private readonly ui: UiPort,
  ) {}

  /** Loads modes and starts listening to server events. */
  async start(): Promise<void> {
    void this.listen()
    // The engine loads plugins (and with them Bobi's modes) asynchronously after the location boots.
    const deadline = Date.now() + 15_000
    let modes = await this.loadModes()
    while (modes.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
      modes = await this.loadModes()
    }
    this.ui.post({ type: "ready", modes, mode: this.mode })
  }

  private async loadModes() {
    const agents = await this.client.agents(this.directory)
    return agents
      .filter((a: Agent) => a.mode !== "subagent" && !a.hidden)
      .map((a) => ({ id: a.id, name: a.name ?? a.id }))
      .sort((a, b) => (MODE_ORDER.indexOf(a.id) + 1 || 99) - (MODE_ORDER.indexOf(b.id) + 1 || 99))
  }

  stop() {
    this.abort.abort()
  }

  private async listen() {
    try {
      for await (const event of this.client.events(this.abort.signal)) this.handle(event)
    } catch (error) {
      if (!this.abort.signal.aborted) this.ui.error(`Lost connection to the Bobi server: ${(error as Error).message}`)
    }
  }

  /** Visible for tests. */
  handle(event: BobiEvent) {
    const data = event.data ?? {}
    // Modes changed (e.g. custom_modes.yaml edited): refresh the picker.
    if (event.type === "agent.updated") {
      void this.loadModes().then((modes) => modes.length && this.ui.post({ type: "ready", modes, mode: this.mode }))
      return
    }
    if (!this.sessionID || (data.sessionID && data.sessionID !== this.sessionID)) return
    switch (event.type) {
      case "session.text.delta":
        this.ui.post({ type: "text", delta: String(data.delta ?? "") })
        break
      case "session.tool.input.started":
        this.toolNames.set(String(data.id), String(data.name))
        break
      case "session.tool.called": {
        const name = this.toolNames.get(String(data.id)) ?? String(data.name ?? "tool")
        this.ui.post({ type: "tool", name, summary: summarize(name, data.input) })
        break
      }
      case "session.execution.started":
        this.busy = true
        this.ui.post({ type: "busy", busy: true })
        break
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        this.busy = false
        for (const resolve of this.idleWaiters.splice(0)) resolve()
        this.ui.post({ type: "busy", busy: false })
        if (event.type === "session.execution.failed") this.ui.post({ type: "error", message: "The request failed. See the Bobi server log for details." })
        break
      case "permission.asked":
        void this.ask(data as unknown as PermissionRequest)
        break
      case "session.agent.selected":
        this.mode = String(data.agent)
        this.ui.post({ type: "mode", mode: this.mode })
        break
    }
  }

  private async ask(request: PermissionRequest) {
    this.pending.set(request.id, request)
    const diff = request.action === "edit" && (request.metadata?.files?.length ?? 0) > 0
    this.ui.post({ type: "approval", id: request.id, action: request.action, resources: request.resources, diff })
    if (diff) {
      try {
        await this.ui.showDiff(request)
      } catch (error) {
        this.ui.error(`Cannot show the proposed change: ${(error as Error).message}`)
      }
    }
  }

  async reply(id: string, decision: Decision) {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    await this.client.reply(request.sessionID, id, decision)
    this.ui.post({ type: "approval-done", id, decision })
  }

  async send(text: string, context: ContextFile[] = []) {
    if (!text.trim()) return
    if (!this.sessionID) this.sessionID = (await this.client.createSession(this.directory, this.mode)).id
    this.ui.post({ type: "user", text, context: context.map((c) => c.name) })
    await this.client.prompt(this.sessionID, text, context.map((c) => ({ uri: c.uri, name: c.name })))
    const messages = await this.client.messages(this.sessionID)
    this.lastUserMessage = [...messages].reverse().find((m) => m.type === "user")?.id
  }

  async setMode(mode: string) {
    this.mode = mode
    if (this.sessionID) await this.client.switchAgent(this.sessionID, mode)
    this.ui.post({ type: "mode", mode })
  }

  async stopRequest() {
    if (this.sessionID) await this.client.interrupt(this.sessionID)
  }

  /** Resolves when the current request has finished (or after `timeoutMs`). */
  idle(timeoutMs = 60_000): Promise<void> {
    if (!this.busy) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.idleWaiters.push(() => (clearTimeout(timer), resolve()))
    })
  }

  /** One-click undo of everything the agent changed for the last request (waits until the request is done). */
  async undo(): Promise<boolean> {
    if (!this.sessionID || !this.lastUserMessage) return false
    await this.idle()
    await this.client.revert(this.sessionID, this.lastUserMessage)
    this.lastUserMessage = undefined
    return true
  }

  newChat() {
    this.sessionID = undefined
    this.lastUserMessage = undefined
    this.pending.clear()
    this.ui.post({ type: "cleared" })
  }

  get currentSession() {
    return this.sessionID
  }
}
