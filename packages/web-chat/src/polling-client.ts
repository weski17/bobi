// The chat client of the web page: the same BobiClient as the IDE panel, except that the live events come from the gate's
// long-poll endpoint instead of one long-lived stream (see hub.ts). Everything else is unchanged.
import { BobiClient, type BobiEvent } from "../../ide-extension/src/client.ts"

const RETRY_MS = 2000

export class PollingClient extends BobiClient {
  constructor(
    private readonly base: string,
    private readonly fetcher: typeof fetch = ((input, init) => fetch(input, init)) as typeof fetch,
  ) {
    super(base, undefined, fetcher)
  }

  /** Long-polls `/chat/poll` until `signal` aborts. The first call only learns the current position. */
  override async *events(signal: AbortSignal): AsyncGenerator<BobiEvent> {
    let after: number | undefined
    while (!signal.aborted) {
      try {
        const response = await this.fetcher(`${this.base}/chat/poll${after === undefined ? "" : `?after=${after}`}`, { signal })
        if (!response.ok) throw new Error(`poll failed (${response.status})`)
        const body = (await response.json()) as { last: number; events: BobiEvent[] }
        after = body.last
        for (const event of body.events) yield event
      } catch {
        if (signal.aborted) return
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
      }
    }
  }
}
