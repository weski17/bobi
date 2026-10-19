// Applies a unified diff (as sent with edit approvals) to the current file content, to show the proposed
// result in a diff editor before the user accepts it.

export class PatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PatchError"
  }
}

type Hunk = { oldStart: number; lines: string[] }

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | undefined
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line)
    if (header) {
      current = { oldStart: Number(header[1]), lines: [] }
      hunks.push(current)
    } else if (current && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\"))) {
      current.lines.push(line)
    }
  }
  return hunks
}

/** Splits text into lines and whether the last line ends with a newline. */
function toLines(text: string): { lines: string[]; eol: boolean } {
  if (text === "") return { lines: [], eol: false }
  const lines = text.split("\n")
  const eol = lines.at(-1) === ""
  if (eol) lines.pop()
  return { lines, eol }
}

export function applyPatch(original: string, patch: string): string {
  const hunks = parseHunks(patch)
  if (hunks.length === 0) return original
  const { lines: source, eol: sourceEol } = toLines(original)
  const out: string[] = []
  let index = 0
  // "\ No newline at end of file" after a "+" or context line: the new file has no final newline.
  let newSideNoEol = false
  for (const hunk of hunks) {
    const start = Math.max(hunk.oldStart - 1, 0)
    if (start < index) throw new PatchError("overlapping hunks")
    out.push(...source.slice(index, start))
    index = start
    let previous = ""
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) {
        if (previous === "+" || previous === " ") newSideNoEol = true
        continue
      }
      const kind = line[0]!
      const text = line.slice(1)
      previous = kind
      if (kind === "+") out.push(text)
      else {
        if (source[index] !== text) throw new PatchError(`patch does not match the file at line ${index + 1}`)
        if (kind === " ") out.push(text)
        index++
      }
    }
  }
  const touchesEnd = index >= source.length
  out.push(...source.slice(index))
  if (out.length === 0) return ""
  const eol = touchesEnd ? !newSideNoEol : sourceEol
  return out.join("\n") + (eol ? "\n" : "")
}
