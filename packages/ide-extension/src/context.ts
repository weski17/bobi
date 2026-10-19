// Context for a prompt (requirement 9): open editor tabs as file attachments and the current selection as text.
import path from "node:path"
import type { ContextFile } from "./controller.ts"

export type TabInfo = { fsPath: string; scheme: string }
export type Selection = { fsPath: string; startLine: number; endLine: number; text: string }

const MAX_TABS = 20
const MAX_SELECTION = 20_000

/** Files under `root` that are open in tabs (active first, no duplicates). */
export function contextFiles(root: string, tabs: readonly TabInfo[], active?: string): ContextFile[] {
  const ordered = active ? [{ fsPath: active, scheme: "file" }, ...tabs] : [...tabs]
  const seen = new Set<string>()
  const out: ContextFile[] = []
  for (const tab of ordered) {
    if (tab.scheme !== "file" || seen.has(tab.fsPath)) continue
    const relative = path.relative(root, tab.fsPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue
    seen.add(tab.fsPath)
    out.push({ uri: `file://${tab.fsPath.split(path.sep).map(encodeURIComponent).join("/")}`, name: relative.replaceAll("\\", "/") })
    if (out.length >= MAX_TABS) break
  }
  return out
}

/** Prepends the selected code to the user's text so the model sees exactly what the user means. */
export function withSelection(text: string, root: string, selection?: Selection): string {
  if (!selection || !selection.text.trim()) return text
  const file = path.relative(root, selection.fsPath).replaceAll("\\", "/")
  const code = selection.text.length > MAX_SELECTION ? `${selection.text.slice(0, MAX_SELECTION)}\n… (truncated)` : selection.text
  const lines = selection.startLine === selection.endLine ? `line ${selection.startLine}` : `lines ${selection.startLine}-${selection.endLine}`
  return `Selected in ${file} (${lines}):\n\`\`\`\n${code}\n\`\`\`\n\n${text}`
}
