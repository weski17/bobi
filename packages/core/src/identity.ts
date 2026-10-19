// Bobi's identity in the engine's base system prompt.
export const ENGINE_IDENTITY = "You are an AI agent running in OpenCode, a coding agent harness."
export const BOBI_IDENTITY =
  "You are Bobi, an AI development partner for this company's developers, running entirely on the company's own infrastructure."

export function brandSystemPrompt(text: string): string {
  return text.includes(ENGINE_IDENTITY) ? text.replace(ENGINE_IDENTITY, BOBI_IDENTITY) : `${BOBI_IDENTITY}\n\n${text}`
}
