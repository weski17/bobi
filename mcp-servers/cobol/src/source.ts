// COBOL source handling: reference-format normalisation, tokenising and COPY expansion (requirement 16).
// Fixed format: columns 1-6 sequence area, column 7 indicator, 8-72 code (8-11 = area A). Free format is
// detected by a ">>SOURCE FORMAT FREE" directive. COPY ... REPLACING works on text, so partial-word
// replacements such as ==(TESTVAR1)== BY ==ACCT-STATUS== behave as compilers commonly implement them.

export type Line = { readonly file: string; readonly line: number; readonly text: string; readonly areaA: boolean }

export type TokenKind = "word" | "literal" | "number" | "period" | "lparen" | "rparen" | "pseudo" | "op"
export type Token = {
  readonly kind: TokenKind
  /** Upper-cased for words; literals keep their text without quotes. */
  readonly text: string
  readonly file: string
  readonly line: number
  /** First token of a line that starts in area A (paragraph and section names, level 01/77, FD). */
  readonly areaA: boolean
}

const FREE_DIRECTIVE = />>\s*SOURCE(\s+FORMAT)?(\s+IS)?\s+FREE/i

/** Removes an inline "*>" comment that is not inside a literal. */
function stripInlineComment(text: string): string {
  let quote: string | undefined
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = undefined
    } else if (c === "'" || c === '"') quote = c
    else if (c === "*" && text[i + 1] === ">") return text.slice(0, i)
  }
  return text
}

/** True when the text ends inside an open literal (used for continuation lines). */
function openLiteral(text: string): string | undefined {
  let quote: string | undefined
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = undefined
    } else if (c === "'" || c === '"') quote = c
  }
  return quote
}

/** Turns a source file into logical code lines (comments removed, continuations joined). */
export function normalize(source: string, file: string): Line[] {
  const raw = source.replace(/\r\n?/g, "\n").split("\n")
  const free = raw.some((l) => FREE_DIRECTIVE.test(l))
  const out: { file: string; line: number; text: string; areaA: boolean }[] = []
  raw.forEach((original, index) => {
    const line = index + 1
    if (/^\s*>>/.test(original) || /^\s*>>/.test(original.slice(7))) return // compiler directives
    if (free) {
      const text = stripInlineComment(original)
      if (/^\s*\*>/.test(original) || !text.trim()) return
      out.push({ file, line, text: text.trimEnd(), areaA: /^\S/.test(text) })
      return
    }
    if (original.length <= 6) return
    const indicator = original[6]!
    if (indicator === "*" || indicator === "/" || indicator === "D" || indicator === "d") return
    const area = stripInlineComment(original.slice(7, 72))
    // A literal continued on the next line runs to column 72 (editors often strip the trailing spaces).
    const code = openLiteral(area) ? area.padEnd(65) : area.trimEnd()
    if (indicator === "-") {
      const previous = out.at(-1)
      if (!previous) return
      const rest = code.trimStart()
      const quote = openLiteral(previous.text)
      // A continued literal resumes after the quote that opens the continuation line.
      const joined = quote && rest.startsWith(quote) ? previous.text + rest.slice(1) : `${previous.text} ${rest}`
      out[out.length - 1] = { ...previous, text: joined }
      return
    }
    if (!code.trim()) return
    out.push({ file, line, text: code, areaA: /^\S/.test(code.slice(0, 4)) })
  })
  return out
}

const PICTURE_WORDS = new Set(["PIC", "PICTURE"])

/** Splits logical lines into tokens. Picture strings (PIC S9(5)V99) stay one token. */
export function tokenize(lines: readonly Line[]): Token[] {
  const tokens: Token[] = []
  for (const { file, line, text, areaA } of lines) {
    let i = 0
    let first = true
    const push = (kind: TokenKind, value: string) => {
      tokens.push({ kind, text: value, file, line, areaA: first && areaA })
      first = false
    }
    while (i < text.length) {
      const c = text[i]!
      if (c === " " || c === "\t" || c === "," || c === ";") {
        i++
        continue
      }
      const last = tokens.at(-1)
      const lastWord = last?.kind === "word" ? last.text : undefined
      const beforeLast = tokens.at(-2)
      const wantsPicture =
        last?.line === line && (PICTURE_WORDS.has(lastWord ?? "") || (lastWord === "IS" && beforeLast?.kind === "word" && PICTURE_WORDS.has(beforeLast.text)))
      if (wantsPicture && lastWord !== "IS" && /^IS\b/i.test(text.slice(i))) {
        push("word", "IS")
        i += 2
        continue
      }
      if (wantsPicture) {
        let j = i
        while (j < text.length && text[j] !== " " && !(text[j] === "." && (j + 1 === text.length || text[j + 1] === " "))) j++
        push("word", text.slice(i, j).toUpperCase())
        i = j
        continue
      }
      // Literals, including X'..', N'..', Z'..' prefixes; doubled quotes escape a quote.
      const prefixed = /^[XNZGxnzg]['"]/.test(text.slice(i, i + 2))
      if (c === "'" || c === '"' || prefixed) {
        const quote = prefixed ? text[i + 1]! : c
        let j = i + (prefixed ? 2 : 1)
        let value = ""
        while (j < text.length) {
          if (text[j] === quote) {
            if (text[j + 1] === quote) {
              value += quote
              j += 2
              continue
            }
            j++
            break
          }
          value += text[j]
          j++
        }
        push("literal", value)
        i = j
        continue
      }
      if (c === "=" && text[i + 1] === "=") {
        const end = text.indexOf("==", i + 2)
        const stop = end === -1 ? text.length : end
        push("pseudo", text.slice(i + 2, stop).trim())
        i = end === -1 ? text.length : end + 2
        continue
      }
      if (c === "." && (i + 1 === text.length || text[i + 1] === " ")) {
        push("period", ".")
        i++
        continue
      }
      if (c === "(") {
        push("lparen", "(")
        i++
        continue
      }
      if (c === ")") {
        push("rparen", ")")
        i++
        continue
      }
      const number = /^[+-]?(\d+(\.\d+)?|\.\d+)(?![A-Za-z0-9-])/.exec(text.slice(i))
      if (number && (c !== "+" && c !== "-" ? true : !/[A-Za-z0-9)]/.test(text[i - 1] ?? " "))) {
        push("number", number[0])
        i += number[0].length
        continue
      }
      const word = /^[A-Za-z0-9][A-Za-z0-9_-]*(?<!-)/.exec(text.slice(i))
      if (word) {
        push("word", word[0].toUpperCase())
        i += word[0].length
        continue
      }
      const op = /^(\*\*|>=|<=|<>|[=<>+\-*/:&])/.exec(text.slice(i))
      push("op", op ? op[0] : c)
      i += op ? op[0].length : 1
    }
  }
  return tokens
}

export type Replacement = { readonly from: string; readonly to: string; readonly word: boolean }

/** Applies COPY ... REPLACING pairs to copybook lines. */
export function applyReplacing(lines: readonly Line[], replacements: readonly Replacement[]): Line[] {
  if (replacements.length === 0) return [...lines]
  return lines.map((line) => {
    let text = line.text
    for (const r of replacements) {
      if (!r.from) continue
      const escaped = r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
      const pattern = r.word ? new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, "gi") : new RegExp(escaped, "gi")
      text = text.replace(pattern, () => r.to)
    }
    return { ...line, text }
  })
}

export type CopyReference = { readonly name: string; readonly file: string; readonly line: number; readonly resolved?: string }

export type ExpandOptions = {
  /** Finds a copybook file by member name (upper case), or undefined (e.g. system copybooks). */
  readonly resolve: (name: string, from: string) => string | undefined
  readonly read: (file: string) => string
  readonly maxDepth?: number
  /** Tokens that COPY may add in total (default 2 000 000); more is an error, not an out-of-memory crash. */
  readonly maxTokens?: number
  /** Shared by the nested expansions of one file. */
  readonly budget?: { left: number }
}

/** Default limit for the tokens COPY statements may add to one program (security review 2026-11-19, M9). */
export const MAX_EXPANDED_TOKENS = 2_000_000

export type Expanded = { readonly tokens: Token[]; readonly copies: CopyReference[] }

/**
 * Tokenises a source file and expands COPY statements (recursively, cycles and depth bounded).
 * `EXEC SQL INCLUDE name END-EXEC` is expanded the same way, except for SQLCA/SQLDA.
 */
export function expand(source: string, file: string, given: ExpandOptions, depth = 0, stack: readonly string[] = []): Expanded {
  // Depth and cycles alone do not bound the size: copybooks that COPY each other several times grow exponentially.
  const options = given.budget ? given : { ...given, budget: { left: given.maxTokens ?? MAX_EXPANDED_TOKENS } }
  const budget = options.budget!
  const tokens = tokenize(normalize(source, file))
  const out: Token[] = []
  const copies: CopyReference[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const sqlInclude =
      t.kind === "word" && t.text === "EXEC" && tokens[i + 1]?.text === "SQL" && tokens[i + 2]?.text === "INCLUDE" && tokens[i + 3]
        ? tokens[i + 3]!
        : undefined
    if (sqlInclude && !["SQLCA", "SQLDA"].includes(sqlInclude.text)) {
      let end = i + 4
      while (end < tokens.length && tokens[end]!.text !== "END-EXEC") end++
      if (tokens[end + 1]?.kind === "period") end++
      include(sqlInclude.text, [], t)
      i = end
      continue
    }
    if (!(t.kind === "word" && t.text === "COPY" && (tokens[i + 1]?.kind === "word" || tokens[i + 1]?.kind === "literal"))) {
      out.push(t)
      continue
    }
    const name = tokens[i + 1]!.text.toUpperCase()
    let j = i + 2
    if (tokens[j]?.text === "OF" || tokens[j]?.text === "IN") j += 2 // library name
    if (tokens[j]?.text === "SUPPRESS") j++
    const replacements: Replacement[] = []
    if (tokens[j]?.text === "REPLACING") {
      j++
      while (j < tokens.length && tokens[j]!.kind !== "period") {
        const from = tokens[j]
        if (tokens[j + 1]?.text !== "BY" || !tokens[j + 2]) break
        const to = tokens[j + 2]!
        replacements.push({ from: from!.text, to: to.text, word: from!.kind !== "pseudo" })
        j += 3
      }
    }
    while (j < tokens.length && tokens[j]!.kind !== "period") j++
    include(name, replacements, t)
    i = j // skip the terminating period
  }
  return { tokens: out, copies }

  function include(name: string, replacements: readonly Replacement[], at: Token) {
    const resolved = options.resolve(name, file)
    copies.push({ name, file: at.file, line: at.line, ...(resolved ? { resolved } : {}) })
    if (!resolved || stack.includes(resolved) || depth >= (options.maxDepth ?? 10)) return
    let text: string
    try {
      text = options.read(resolved)
    } catch {
      return
    }
    const lines = applyReplacing(normalize(text, resolved), replacements)
    const nested = expandLines(lines, resolved, options, depth + 1, [...stack, file])
    budget.left -= nested.tokens.length
    if (budget.left < 0) throw new Error(`COPY expansion is larger than ${options.maxTokens ?? MAX_EXPANDED_TOKENS} tokens (copybooks that include each other many times)`)
    out.push(...nested.tokens)
    copies.push(...nested.copies)
  }
}

function expandLines(lines: readonly Line[], file: string, options: ExpandOptions, depth: number, stack: readonly string[]): Expanded {
  // Re-serialise in free format so the replaced text is tokenised like any other source.
  const source = [">>SOURCE FORMAT FREE", ...lines.map((l) => (l.areaA ? l.text : ` ${l.text.trimStart()}`))]
  const result = expand(source.join("\n"), file, options, depth, stack)
  // Restore the original line numbers (free-format line n+1 → lines[n]).
  const numbers = lines.map((l) => l.line)
  return {
    tokens: result.tokens.map((t) => (t.file === file ? { ...t, line: numbers[t.line - 2] ?? t.line } : t)),
    copies: result.copies.map((c) => (c.file === file ? { ...c, line: numbers[c.line - 2] ?? c.line } : c)),
  }
}
