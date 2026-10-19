// Inline code completion (requirement 17): fill-in-the-middle through the configured OpenAI-compatible endpoint
// (POST <baseURL>/completions with prompt + suffix, as served by vLLM, Ollama or LiteLLM). Runs in the server, so
// the API key stays here, .bobiignore'd files are never sent and secrets in the context are masked.
import path from "node:path"
import { findProjectRoot, type BobiConfig } from "@bobi/config"
import { BobiIgnore, type Masker } from "@bobi/core"

export const COMPLETE_PATH = "/bobi/complete"

export type CompletionRequest = {
  /** Absolute path of the file being edited. */
  readonly file: string
  readonly prefix: string
  readonly suffix?: string
  /** Allow a multi-line suggestion (e.g. the rest of the line is empty). Default true. */
  readonly multiline?: boolean
}

export type CompletionOptions = {
  /** Config of the project the file belongs to (its own .bobi/config.jsonc only if trusted). */
  readonly projectConfig: (project: string) => BobiConfig
  readonly env: Record<string, string | undefined>
  readonly mask: Masker
  readonly fetch?: typeof fetch
}

const MAX_PREFIX = 8_000
const MAX_SUFFIX = 2_000
const MAX_TEXT = 2_000

const json = (body: unknown, status = 200) => Response.json(body, { status })

/** Removes the part of a suggestion that repeats the text after the cursor, and limits single-line suggestions. */
export function trimCompletion(text: string, suffix: string, multiline: boolean): string {
  // The stop sequences are applied here too, for endpoints that ignore them.
  let out = multiline ? text.split("\n\n\n")[0]! : text.split("\n")[0]!
  const next = suffix.split("\n")[0]!.trim()
  if (next) {
    const at = out.lastIndexOf(next)
    if (at >= 0 && at + next.length >= out.trimEnd().length) out = out.slice(0, at)
  }
  out = out.slice(0, MAX_TEXT)
  return multiline ? out.replace(/\s+$/, "") : out
}

export async function handleCompletion(request: Request, options: CompletionOptions): Promise<Response> {
  if (request.method !== "POST") return json({ error: "use POST" }, 405)
  let input: CompletionRequest
  try {
    input = (await request.json()) as CompletionRequest
  } catch {
    return json({ error: "body must be JSON" }, 400)
  }
  if (typeof input.file !== "string" || !path.isAbsolute(input.file) || typeof input.prefix !== "string" || (input.suffix !== undefined && typeof input.suffix !== "string"))
    return json({ error: "file (absolute path) and prefix are required" }, 400)

  const project = findProjectRoot(path.dirname(input.file))
  const config = options.projectConfig(project)
  const model = config.autocomplete.model
  if (!model) return json({ error: "autocomplete is off: set autocomplete.model in the Bobi config" }, 409)
  // Only models the server's endpoint config declares (like per-mode models).
  if (![config.model.default, ...config.model.models].includes(model)) return json({ error: `autocomplete model "${model}" is not in model.models of the server config` }, 409)
  if (config.model.protocol !== "openai") return json({ error: "autocomplete needs an OpenAI-compatible endpoint (model.protocol: openai)" }, 409)
  const ignored = new BobiIgnore(project)
  if (ignored.ignores(input.file)) return json({ error: ignored.message(input.file) }, 403)

  const prefix = options.mask(input.prefix.slice(-MAX_PREFIX))
  const suffix = options.mask((input.suffix ?? "").slice(0, MAX_SUFFIX))
  const multiline = input.multiline !== false
  const key = options.env[config.model.apiKeyEnv]
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(`${config.model.baseURL.replace(/\/$/, "")}/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        prompt: prefix,
        suffix,
        max_tokens: config.autocomplete.maxTokens ?? (multiline ? 128 : 48),
        temperature: 0.1,
        stop: multiline ? ["\n\n\n"] : ["\n"],
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    return json({ error: `model endpoint not reachable: ${(error as Error).message}` }, 502)
  }
  if (!response.ok) return json({ error: `model endpoint answered HTTP ${response.status}` }, 502)
  const body = (await response.json().catch(() => ({}))) as { choices?: { text?: string }[] }
  const text = body.choices?.[0]?.text
  if (typeof text !== "string") return json({ error: "model endpoint returned no completion" }, 502)
  return json({ text: options.mask(trimCompletion(text, suffix, multiline)), model })
}
