// Inline completion in the IDE (requirement 17). The server decides whether autocomplete is on (a model in the
// Bobi config), refuses .bobiignore'd files and masks secrets; the IDE only sends the text around the cursor.
import type { BobiClient } from "./client.ts"

export const MAX_PREFIX = 6_000
export const MAX_SUFFIX = 1_500

/** Prefix/suffix around the cursor; multi-line only when the rest of the line is empty. */
export function completionInput(text: string, offset: number, file: string) {
  const prefix = text.slice(Math.max(0, offset - MAX_PREFIX), offset)
  const suffix = text.slice(offset, offset + MAX_SUFFIX)
  const restOfLine = suffix.split("\n")[0]!
  return { file, prefix, suffix, multiline: restOfLine.trim() === "" }
}

export type CompleterOptions = {
  /** Wait after the last keystroke before asking (default 200 ms). */
  readonly delayMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (message: string) => void
}

/** Debounces requests, cancels outdated ones and stops asking once the server says autocomplete is off. */
export class Completer {
  private generation = 0
  private controller: AbortController | undefined
  /** Set when the server reported autocomplete as off (until reset, e.g. after a server restart). */
  off: string | undefined

  constructor(
    private readonly client: Pick<BobiClient, "complete">,
    private readonly options: CompleterOptions = {},
  ) {}

  reset() {
    this.off = undefined
  }

  async complete(text: string, offset: number, file: string, cancelled: () => boolean = () => false): Promise<string | undefined> {
    if (this.off) return undefined
    const mine = ++this.generation
    this.controller?.abort()
    await (this.options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.options.delayMs ?? 200)
    if (mine !== this.generation || cancelled()) return undefined
    const controller = new AbortController()
    this.controller = controller
    try {
      const result = await this.client.complete(completionInput(text, offset, file), controller.signal)
      if (result.off) {
        // 409: off for the workspace; 403: only this file (.bobiignore) – keep asking for others.
        if (result.status === 409) this.off = result.off
        return undefined
      }
      if (mine !== this.generation || cancelled()) return undefined
      return result.text || undefined
    } catch (error) {
      if ((error as Error).name !== "AbortError") this.options.log?.(`Bobi autocomplete: ${(error as Error).message}`)
      return undefined
    }
  }
}
