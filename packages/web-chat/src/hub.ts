// Event hub of the web chat gate (ADR-0024, follow-up): the gate reads the Bobi server's event stream ONCE, on its own
// connection, and hands the events to any number of browsers as plain long-poll requests. Every answer is a finished
// piece of JSON, so a tunnel or proxy that holds back streamed responses (Cloudflare quick tunnels do) cannot hold
// back the chat. The events are the server's own; nothing is made up or reordered.

export type HubEvent = { readonly seq: number; readonly event: unknown }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The data of every complete server-sent-events frame in `buffer`, and what is left over. */
export function frames(buffer: string): { data: string[]; rest: string } {
  const data: string[] = []
  let rest = buffer
  let end: number
  while ((end = rest.indexOf("\n\n")) >= 0) {
    const chunk = rest.slice(0, end)
    rest = rest.slice(end + 2)
    const text = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
    if (text) data.push(text)
  }
  return { data, rest }
}

export class EventHub {
  private events: HubEvent[] = []
  private seq = 0
  private readonly waiters = new Set<() => void>()
  private readonly abort = new AbortController()

  constructor(
    private readonly url: string,
    private readonly auth: string,
    private readonly limit = 2000,
  ) {
    void this.run()
  }

  /** Number of the newest event; a browser that has seen it asks for what comes after. */
  get last() {
    return this.seq
  }

  close() {
    this.abort.abort()
    this.wake()
  }

  private wake() {
    for (const waiter of [...this.waiters]) waiter()
  }

  private push(event: unknown) {
    this.events.push({ seq: ++this.seq, event })
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
    this.wake()
  }

  /** Keeps one connection to the server's event stream open; reconnects after a drop. */
  private async run() {
    while (!this.abort.signal.aborted) {
      try {
        await this.read()
      } catch {
        // server not up yet or connection lost: try again
      }
      if (!this.abort.signal.aborted) await sleep(1000)
    }
  }

  private async read() {
    const response = await fetch(`${this.url}/api/event`, { headers: { authorization: this.auth, accept: "text/event-stream", "accept-encoding": "identity" }, signal: this.abort.signal })
    if (!response.ok || !response.body) throw new Error(`event stream unavailable (${response.status})`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        const parsed = frames(buffer + decoder.decode(value, { stream: true }))
        buffer = parsed.rest
        for (const text of parsed.data) this.ingest(text)
      }
    } finally {
      reader.releaseLock()
    }
  }

  private ingest(text: string) {
    try {
      this.push(JSON.parse(text))
    } catch {
      // malformed frame: ignored, like the IDE client does
    }
  }

  /**
   * The events after `after`. Without any, waits up to `waitMs` for the next one (or until `signal` aborts) and
   * then answers, possibly with none. A cursor from the future (the gate was restarted) is reset to `last`.
   */
  async since(after: number, waitMs: number, signal?: AbortSignal): Promise<{ last: number; events: unknown[] }> {
    if (after > this.seq) return { last: this.seq, events: [] }
    if (!this.events.some((e) => e.seq > after) && waitMs > 0 && !this.abort.signal.aborted) await this.waitForNext(waitMs, signal)
    return { last: this.seq, events: this.events.filter((e) => e.seq > after).map((e) => e.event) }
  }

  private waitForNext(waitMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.waiters.delete(done)
        signal?.removeEventListener("abort", done)
        resolve()
      }
      const timer = setTimeout(done, waitMs)
      this.waiters.add(done)
      signal?.addEventListener("abort", done)
    })
  }
}
