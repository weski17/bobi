// Minimal client for the Bobi server API (the engine's HTTP API). No engine imports: the extension runs in the
// IDE's Node runtime, not in Bun.

export type Decision = "once" | "always" | "reject"

export type FilePreview = { file: string; patch: string; status?: string; additions?: number; deletions?: number }

export type PermissionRequest = {
  id: string
  sessionID: string
  action: string
  resources: string[]
  metadata?: { files?: FilePreview[]; [key: string]: unknown }
}

export type BobiEvent = { type: string; data: Record<string, unknown> & { sessionID?: string } }

export type Agent = { id: string; name?: string; description?: string; mode?: string; hidden?: boolean }

export class BobiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "BobiApiError"
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined) return
  if (value !== null && typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
  } else params.append(key, String(value))
}

export class BobiClient {
  private readonly auth: string

  constructor(
    readonly url: string,
    password: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  }

  private async request<T>(method: string, path: string, options: { body?: unknown; query?: Record<string, unknown> } = {}): Promise<T> {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(options.query ?? {})) appendQuery(params, k, v)
    const qs = params.toString()
    const response = await this.fetchImpl(`${this.url}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: { authorization: this.auth, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    const text = await response.text()
    if (!response.ok) {
      let message = text
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text
      } catch {}
      throw new BobiApiError(response.status, `${method} ${path}: ${message || response.statusText}`)
    }
    if (!text) return undefined as T
    const parsed = JSON.parse(text) as { data?: T } | T
    return (parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed) as T
  }

  createSession(directory: string, agent?: string) {
    return this.request<{ id: string }>("POST", "/api/session", { body: { location: { directory }, ...(agent ? { agent } : {}) } })
  }

  prompt(sessionID: string, text: string, files: { uri: string; name?: string }[] = []) {
    return this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, { body: { text, ...(files.length ? { files } : {}) } })
  }

  interrupt(sessionID: string) {
    return this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`, { body: {} })
  }

  switchAgent(sessionID: string, agent: string) {
    return this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/agent`, { body: { agent } })
  }

  agents(directory: string) {
    return this.request<Agent[]>("GET", "/api/agent", { query: { location: { directory } } })
  }

  permissions(sessionID: string) {
    return this.request<PermissionRequest[]>("GET", `/api/session/${encodeURIComponent(sessionID)}/permission`)
  }

  reply(sessionID: string, requestID: string, decision: Decision, message?: string) {
    return this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
      body: { decision, ...(message ? { message } : {}) },
    })
  }

  messages(sessionID: string) {
    return this.request<{ id: string; type: string }[]>("GET", `/api/session/${encodeURIComponent(sessionID)}/message`, { query: { order: "asc" } })
  }

  /** Undo everything the agent changed since the given user message (one click). */
  async revert(sessionID: string, messageID: string) {
    await this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/revert/stage`, { body: { messageID, files: true } })
    await this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionID)}/revert/commit`, { body: {} })
  }

  /** Server-sent events, until `signal` aborts. */
  async *events(signal: AbortSignal): AsyncGenerator<BobiEvent> {
    const response = await this.fetchImpl(`${this.url}/api/event`, { headers: { authorization: this.auth }, signal })
    if (!response.ok || !response.body) throw new BobiApiError(response.status, "event stream unavailable")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (!data) continue
          try {
            yield JSON.parse(data) as BobiEvent
          } catch {
            // ignore malformed frames
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
