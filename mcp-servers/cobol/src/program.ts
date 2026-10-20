// COBOL program model: data items, paragraphs, PERFORM/GO TO edges, program calls, file and EXEC usage,
// and statement-level data flow (requirement 16). Static analysis on the expanded token stream: dynamic
// CALL targets are resolved only through a VALUE clause, and pointer/address arithmetic is not followed.
import type { CopyReference, Token } from "./source.ts"

export type Location = { readonly file: string; readonly line: number }

export type DataItem = Location & {
  /** `<name>` or `<name>#<n>` when the program defines the name more than once. */
  readonly id: string
  readonly name: string
  readonly level: number
  readonly section: string
  readonly picture?: string
  readonly usage?: string
  readonly occurs?: string
  readonly redefines?: string
  readonly value?: string
  /** Parent group item id (for level 88: the conditional variable). */
  readonly parent?: string
  /** File (FD/SD) the record belongs to. */
  readonly fileName?: string
  readonly children: string[]
}

export type Paragraph = Location & { readonly name: string; readonly section?: string; readonly kind: "paragraph" | "section" }

export type Access = Location & { readonly item: string; readonly paragraph: string; readonly mode: "read" | "write"; readonly verb: string }
export type Flow = Location & { readonly from: string; readonly to: string; readonly paragraph: string; readonly verb: string }
export type Edge = Location & { readonly from: string; readonly to: string; readonly kind: "perform" | "goto"; readonly thru?: string }
export type ProgramCall = Location & {
  readonly paragraph: string
  readonly target?: string
  /** Data item holding the target when it is not a literal. */
  readonly via?: string
  readonly kind: "call" | "link" | "xctl"
  readonly using: string[]
}
export type ExecUse = Location & {
  readonly paragraph: string
  readonly kind: "online" | "sql"
  readonly command: string
  /** Dataset/file, map or SQL table names. */
  readonly resources: string[]
}
export type FileControl = Location & { readonly name: string; readonly assign?: string; readonly organization?: string }

export type Program = {
  readonly id: string
  readonly file: string
  readonly items: Map<string, DataItem>
  readonly byName: Map<string, string[]>
  readonly paragraphs: Paragraph[]
  readonly edges: Edge[]
  readonly calls: ProgramCall[]
  readonly execs: ExecUse[]
  readonly files: FileControl[]
  readonly accesses: Access[]
  readonly flows: Flow[]
  readonly copies: CopyReference[]
  readonly using: string[]
}

const DIVISION = new Set(["IDENTIFICATION", "ID", "ENVIRONMENT", "DATA", "PROCEDURE"])
const DATA_SECTIONS = new Set(["FILE", "WORKING-STORAGE", "LOCAL-STORAGE", "LINKAGE", "SCREEN", "REPORT", "COMMUNICATION"])
/** Words that end an operand list (statement verbs and scope terminators). */
const VERBS = new Set([
  "ACCEPT", "ADD", "ALTER", "CALL", "CANCEL", "CLOSE", "COMPUTE", "CONTINUE", "DELETE", "DISPLAY", "DIVIDE", "ELSE", "END",
  "END-ADD", "END-CALL", "END-COMPUTE", "END-DELETE", "END-DIVIDE", "END-EVALUATE", "END-IF", "END-MULTIPLY", "END-PERFORM",
  "END-READ", "END-RETURN", "END-REWRITE", "END-SEARCH", "END-START", "END-STRING", "END-SUBTRACT", "END-UNSTRING", "END-WRITE",
  "ENTRY", "EVALUATE", "EXEC", "EXIT", "GENERATE", "GO", "GOBACK", "IF", "INITIALIZE", "INITIATE", "INSPECT", "INVOKE", "MERGE",
  "MOVE", "MULTIPLY", "NEXT", "OPEN", "PERFORM", "READ", "RELEASE", "RETURN", "REWRITE", "SEARCH", "SET", "SORT", "START", "STOP",
  "STRING", "SUBTRACT", "TERMINATE", "THEN", "UNSTRING", "WHEN", "WRITE",
])
const CONTROL = new Set(["IF", "EVALUATE", "WHEN", "UNTIL", "VARYING", "SEARCH"])

type Cursor = { i: number }

export function parseProgram(tokens: readonly Token[], file: string, copies: readonly CopyReference[]): Program {
  const program: Program = {
    id: "",
    file,
    items: new Map(),
    byName: new Map(),
    paragraphs: [],
    edges: [],
    calls: [],
    execs: [],
    files: [],
    accesses: [],
    flows: [],
    copies: [...copies],
    using: [],
  }
  let id = ""
  const at = (i: number) => tokens[i]
  const loc = (t: Token): Location => ({ file: t.file, line: t.line })

  // Locate divisions.
  const divisions = new Map<string, number>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === "word" && DIVISION.has(t.text) && at(i + 1)?.text === "DIVISION") divisions.set(t.text === "ID" ? "IDENTIFICATION" : t.text, i)
    if (t.text === "PROGRAM-ID") {
      const name = tokens.slice(i + 1, i + 4).find((n) => n.kind === "word" || n.kind === "literal")
      if (name && !id) id = name.text.toUpperCase()
    }
  }
  const procedure = divisions.get("PROCEDURE") ?? tokens.length
  const dataStart = divisions.get("DATA") ?? procedure
  const envStart = divisions.get("ENVIRONMENT") ?? dataStart

  // ENVIRONMENT DIVISION: SELECT name ASSIGN TO ddname.
  for (let i = envStart; i < dataStart; i++) {
    if (tokens[i]!.text !== "SELECT") continue
    let j = i + 1
    if (at(j)?.text === "OPTIONAL") j++
    const name = at(j)
    if (!name) break
    let assign: string | undefined
    let organization: string | undefined
    for (let k = j + 1; k < dataStart && at(k)!.kind !== "period"; k++) {
      const t = at(k)!
      if (t.text === "ASSIGN") {
        let n = k + 1
        if (at(n)?.text === "TO") n++
        if (at(n)) assign = at(n)!.text.toUpperCase()
      }
      if (t.text === "ORGANIZATION") {
        let n = k + 1
        if (at(n)?.text === "IS") n++
        if (at(n)) organization = at(n)!.text
      }
    }
    program.files.push({ ...loc(name), name: name.text, ...(assign ? { assign } : {}), ...(organization ? { organization } : {}) })
  }

  parseData(tokens.slice(dataStart, procedure), program)
  parseProcedure(tokens.slice(procedure), program)
  return { ...program, id: id || file }
}

function addItem(program: Program, item: Omit<DataItem, "id" | "children">): DataItem {
  const ids = program.byName.get(item.name) ?? []
  const id = ids.length === 0 ? item.name : `${item.name}#${ids.length + 1}`
  const full: DataItem = { ...item, id, children: [] }
  program.items.set(id, full)
  program.byName.set(item.name, [...ids, id])
  if (item.parent) program.items.get(item.parent)?.children.push(id)
  return full
}

function parseData(tokens: readonly Token[], program: Program) {
  let section = "WORKING-STORAGE"
  let fileName: string | undefined
  const stack: DataItem[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === "word" && DATA_SECTIONS.has(t.text) && tokens[i + 1]?.text === "SECTION") {
      section = t.text
      stack.length = 0
      fileName = undefined
      i++
      continue
    }
    if ((t.text === "FD" || t.text === "SD") && t.kind === "word" && tokens[i + 1]) {
      fileName = tokens[i + 1]!.text
      stack.length = 0
      while (i < tokens.length && tokens[i]!.kind !== "period") i++
      continue
    }
    if (t.kind !== "number" || !/^\d{1,2}$/.test(t.text)) continue
    const previous = tokens[i - 1]
    if (previous && previous.kind !== "period" && previous.text !== "SECTION") continue
    const level = Number(t.text)
    if (!(level >= 1 && level <= 49) && level !== 66 && level !== 77 && level !== 88) continue
    let j = i + 1
    let name = "FILLER"
    const next = tokens[j]
    if (next?.kind === "word" && !["PIC", "PICTURE", "REDEFINES", "OCCURS", "VALUE", "VALUES", "USAGE", "COMP", "COMP-3", "BINARY"].includes(next.text)) {
      name = next.text
      j++
    }
    const clauses: { picture?: string; usage?: string; occurs?: string; redefines?: string; value?: string } = {}
    const values: string[] = []
    while (j < tokens.length && tokens[j]!.kind !== "period") {
      const c = tokens[j]!
      const after = (n: number) => tokens[j + n]
      if (c.text === "PIC" || c.text === "PICTURE") {
        const p = after(1)?.text === "IS" ? after(2) : after(1)
        if (p) clauses.picture = p.text
      } else if (c.text === "REDEFINES" && after(1)) clauses.redefines = after(1)!.text
      else if (c.text === "OCCURS" && after(1)) {
        const to = after(2)?.text === "TO" && after(3) ? ` TO ${after(3)!.text}` : ""
        const depending = tokens.slice(j, j + 9).findIndex((x) => x.text === "DEPENDING")
        const on = depending >= 0 ? tokens[j + depending + (tokens[j + depending + 1]?.text === "ON" ? 2 : 1)] : undefined
        clauses.occurs = `${after(1)!.text}${to}${on ? ` DEPENDING ON ${on.text}` : ""}`
      } else if (c.text === "USAGE") {
        const u = after(1)?.text === "IS" ? after(2) : after(1)
        if (u) clauses.usage = u.text
      } else if (/^(COMP(UTATIONAL)?(-[1-5X])?|BINARY|PACKED-DECIMAL|DISPLAY|INDEX|POINTER)$/.test(c.text) && !clauses.usage) clauses.usage = c.text
      else if (c.text === "VALUE" || c.text === "VALUES") {
        let k = j + 1
        if (tokens[k]?.text === "IS" || tokens[k]?.text === "ARE") k++
        while (k < tokens.length && tokens[k]!.kind !== "period" && !["PIC", "PICTURE", "USAGE", "OCCURS"].includes(tokens[k]!.text)) {
          const v = tokens[k]!
          values.push(v.kind === "literal" ? `'${v.text}'` : v.text)
          k++
        }
        j = k - 1
      }
      j++
    }
    if (values.length) clauses.value = values.join(" ")

    let parent: DataItem | undefined
    if (level === 88) parent = stack.at(-1)
    else if (level === 66 || level === 77 || level === 1) stack.length = 0
    else {
      while (stack.length && stack.at(-1)!.level >= level) stack.pop()
      parent = stack.at(-1)
    }
    const item = addItem(program, {
      file: t.file,
      line: t.line,
      name,
      level,
      section,
      ...clauses,
      ...(clauses.redefines ? { redefines: resolveName(program, clauses.redefines, [], parent?.id) ?? clauses.redefines } : {}),
      ...(parent ? { parent: parent.id } : {}),
      ...(fileName && section === "FILE" ? { fileName } : {}),
    })
    if (level !== 88 && level !== 66) stack.push(item)
    i = j
  }
}

/** Resolves a data name with optional OF/IN qualifiers to an item id. */
export function resolveName(program: Program, name: string, qualifiers: readonly string[], near?: string): string | undefined {
  const ids = program.byName.get(name)
  if (!ids || ids.length === 0) return undefined
  if (ids.length === 1 && qualifiers.length === 0) return ids[0]
  const ancestors = (id: string) => {
    const names: string[] = []
    let current = program.items.get(id)?.parent
    while (current) {
      const item = program.items.get(current)
      if (!item) break
      names.push(item.name)
      current = item.parent
    }
    return names
  }
  const matches = ids.filter((id) => qualifiers.every((q) => ancestors(id).includes(q)))
  if (near) {
    const sibling = matches.find((id) => program.items.get(id)?.parent === near)
    if (sibling) return sibling
  }
  return matches[0] ?? ids[0]
}

type Ref = { id: string; token: Token }

/** Reads data references (with OF/IN qualifiers and subscripts) from tokens[from, to). */
function references(program: Program, tokens: readonly Token[], from: number, to: number): Ref[] {
  const out: Ref[] = []
  for (let i = from; i < to; i++) {
    const t = tokens[i]!
    if (t.kind !== "word" || !program.byName.has(t.text)) continue
    if (tokens[i - 1]?.text === "OF" || tokens[i - 1]?.text === "IN") continue // a qualifier, consumed below
    const qualifiers: string[] = []
    let j = i + 1
    while ((tokens[j]?.text === "OF" || tokens[j]?.text === "IN") && tokens[j + 1]) {
      qualifiers.push(tokens[j + 1]!.text)
      j += 2
    }
    const id = resolveName(program, t.text, qualifiers)
    if (id) out.push({ id, token: t })
  }
  return out
}

/** Index of the next statement verb, period or terminator at or after `from`. */
function statementEnd(tokens: readonly Token[], from: number): number {
  let depth = 0
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === "lparen") depth++
    if (t.kind === "rparen") depth--
    if (depth > 0) continue
    if (t.kind === "period" || (t.kind === "word" && VERBS.has(t.text) && !t.text.startsWith("END-EXEC"))) return i
  }
  return tokens.length
}

function parseProcedure(tokens: readonly Token[], program: Program) {
  if (tokens.length === 0) return
  // PROCEDURE DIVISION [USING a b].
  let start = 2
  if (tokens[start]?.text === "USING") {
    let j = start + 1
    while (j < tokens.length && tokens[j]!.kind !== "period") {
      if (tokens[j]!.kind === "word" && !["BY", "REFERENCE", "VALUE", "CONTENT"].includes(tokens[j]!.text)) program.using.push(tokens[j]!.text)
      j++
    }
    start = j
  }
  while (start < tokens.length && tokens[start]!.kind !== "period") start++
  start++

  // Pass 1: paragraph and section names (in area A, followed by a period or SECTION).
  const names = new Set<string>()
  const heads = new Map<number, Paragraph>()
  let section: string | undefined
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind !== "word" || !t.areaA || VERBS.has(t.text)) continue
    if (tokens[i + 1]?.text === "SECTION" && tokens[i + 2]?.kind === "period") {
      section = t.text
      const p: Paragraph = { file: t.file, line: t.line, name: t.text, kind: "section" }
      heads.set(i, p)
      names.add(t.text)
      program.paragraphs.push(p)
    } else if (tokens[i + 1]?.kind === "period" && t.text !== "EXIT") {
      const p: Paragraph = { file: t.file, line: t.line, name: t.text, kind: "paragraph", ...(section ? { section } : {}) }
      heads.set(i, p)
      names.add(t.text)
      program.paragraphs.push(p)
    }
  }

  // Pass 2: statements.
  const MAIN = "(main)"
  let current = MAIN
  const cursor: Cursor = { i: start }
  const access = (ref: Ref, mode: Access["mode"], verb: string) =>
    program.accesses.push({ file: ref.token.file, line: ref.token.line, item: ref.id, paragraph: current, mode, verb })
  const flow = (from: Ref[], to: Ref[], verb: string) => {
    for (const f of from) for (const d of to) program.flows.push({ file: d.token.file, line: d.token.line, from: f.id, to: d.id, paragraph: current, verb })
  }
  const reads = (refs: Ref[], verb: string) => refs.forEach((r) => access(r, "read", verb))
  const writes = (refs: Ref[], verb: string) => refs.forEach((r) => access(r, "write", verb))
  const indexOf = (word: string, from: number, to: number) => {
    for (let k = from; k < to; k++) if (tokens[k]!.kind === "word" && tokens[k]!.text === word) return k
    return -1
  }

  for (; cursor.i < tokens.length; cursor.i++) {
    const i = cursor.i
    const t = tokens[i]!
    const head = heads.get(i)
    if (head) {
      current = head.name
      cursor.i += head.kind === "section" ? 2 : 1
      continue
    }
    if (t.kind !== "word") continue
    const verb = t.text
    const end = verb === "EXEC" ? indexOf("END-EXEC", i, tokens.length) : statementEnd(tokens, i + 1)
    const stop = end === -1 ? tokens.length : end
    switch (verb) {
      case "MOVE": {
        const to = indexOf("TO", i + 1, stop)
        if (to < 0) break
        const corresponding = ["CORRESPONDING", "CORR"].includes(tokens[i + 1]?.text ?? "")
        const src = references(program, tokens, i + 1, to)
        const dst = references(program, tokens, to + 1, stop)
        reads(src, verb)
        writes(dst, verb)
        if (corresponding) for (const s of src) for (const d of dst) correspondingFlows(program, s, d, current)
        else flow(src.slice(0, 1), dst, verb)
        break
      }
      case "COMPUTE": {
        const eq = tokens.slice(i + 1, stop).findIndex((x) => x.text === "=" || x.text === "EQUAL")
        if (eq < 0) break
        const dst = references(program, tokens, i + 1, i + 1 + eq)
        const src = references(program, tokens, i + 2 + eq, stop)
        reads(src, verb)
        writes(dst, verb)
        flow(src, dst, verb)
        break
      }
      case "ADD":
      case "SUBTRACT":
      case "MULTIPLY":
      case "DIVIDE": {
        const giving = indexOf("GIVING", i + 1, stop)
        const pivotWord = { ADD: "TO", SUBTRACT: "FROM", MULTIPLY: "BY", DIVIDE: "INTO" }[verb]
        const pivot = indexOf(pivotWord, i + 1, giving >= 0 ? giving : stop)
        const byPivot = verb === "DIVIDE" && pivot < 0 ? indexOf("BY", i + 1, giving >= 0 ? giving : stop) : pivot
        const operands = references(program, tokens, i + 1, giving >= 0 ? giving : stop)
        const remainder = indexOf("REMAINDER", i + 1, stop)
        const dst = giving >= 0 ? references(program, tokens, giving + 1, remainder >= 0 ? remainder : stop) : byPivot >= 0 ? references(program, tokens, byPivot + 1, stop) : []
        if (remainder >= 0) dst.push(...references(program, tokens, remainder + 1, stop))
        const src = operands
        reads(src, verb)
        writes(dst, verb)
        flow(src.filter((s) => !dst.some((d) => d.token === s.token)), dst, verb)
        break
      }
      case "INITIALIZE":
      case "ACCEPT":
        writes(references(program, tokens, i + 1, stop), verb)
        break
      case "DISPLAY":
        reads(references(program, tokens, i + 1, stop), verb)
        break
      case "SET": {
        const to = indexOf("TO", i + 1, stop)
        const dst = references(program, tokens, i + 1, to >= 0 ? to : stop)
        // SET condition-name TO TRUE writes the conditional variable.
        const targets = dst.map((d) => {
          const item = program.items.get(d.id)
          return item?.level === 88 && item.parent ? { ...d, id: item.parent } : d
        })
        writes(targets, verb)
        if (to >= 0) {
          const src = references(program, tokens, to + 1, stop)
          reads(src, verb)
          flow(src, targets, verb)
        }
        break
      }
      case "STRING":
      case "UNSTRING": {
        const into = indexOf("INTO", i + 1, stop)
        if (into < 0) break
        const src = references(program, tokens, i + 1, into)
        const dst = references(program, tokens, into + 1, stop)
        reads(src, verb)
        writes(dst, verb)
        flow(src, dst, verb)
        break
      }
      case "READ":
      case "RETURN": {
        const into = indexOf("INTO", i + 1, stop)
        if (into >= 0) {
          const dst = references(program, tokens, into + 1, stop)
          writes(dst, verb)
          const fileToken = tokens[i + 1]
          const records = [...program.items.values()].filter((it) => it.fileName === fileToken?.text && it.level === 1)
          flow(records.map((r) => ({ id: r.id, token: fileToken! })), dst, verb)
        }
        break
      }
      case "WRITE":
      case "REWRITE":
      case "RELEASE": {
        const from = indexOf("FROM", i + 1, stop)
        const record = references(program, tokens, i + 1, from >= 0 ? from : stop).slice(0, 1)
        writes(record, verb)
        if (from >= 0) {
          const src = references(program, tokens, from + 1, stop)
          reads(src, verb)
          flow(src, record, verb)
        }
        break
      }
      case "IF":
      case "EVALUATE":
      case "WHEN":
      case "SEARCH":
        reads(references(program, tokens, i + 1, stop), verb)
        break
      case "PERFORM": {
        const target = tokens[i + 1]
        if (target?.kind === "word" && names.has(target.text)) {
          const thru = ["THRU", "THROUGH"].includes(tokens[i + 2]?.text ?? "") ? tokens[i + 3]?.text : undefined
          program.edges.push({ file: target.file, line: target.line, from: current, to: target.text, kind: "perform", ...(thru ? { thru } : {}) })
        }
        // UNTIL / VARYING conditions read data.
        const until = tokens.slice(i + 1, stop).findIndex((x) => CONTROL.has(x.text))
        if (until >= 0) {
          const varying = indexOf("VARYING", i + 1, stop)
          if (varying >= 0) {
            const from = indexOf("FROM", varying, stop)
            writes(references(program, tokens, varying + 1, from >= 0 ? from : varying + 2), verb)
          }
          reads(references(program, tokens, i + 1 + until, stop), verb)
        }
        break
      }
      case "GO": {
        let j = i + 1
        if (tokens[j]?.text === "TO") j++
        for (; j < stop; j++) {
          const target = tokens[j]!
          if (target.text === "DEPENDING") break
          if (target.kind === "word" && names.has(target.text))
            program.edges.push({ file: target.file, line: target.line, from: current, to: target.text, kind: "goto" })
        }
        break
      }
      case "CALL": {
        const target = tokens[i + 1]
        if (!target) break
        const usingAt = indexOf("USING", i + 1, stop)
        const using = usingAt >= 0 ? references(program, tokens, usingAt + 1, stop) : []
        reads(using, verb)
        program.calls.push({ ...callTarget(program, target), file: t.file, line: t.line, paragraph: current, kind: "call", using: using.map((u) => u.id) })
        break
      }
      case "EXEC":
        parseExec(program, tokens, i, stop, current, access)
        cursor.i = stop
        break
    }
  }
}

function callTarget(program: Program, target: Token): { target?: string; via?: string } {
  if (target.kind === "literal") return { target: target.text.toUpperCase() }
  const id = resolveName(program, target.text, [])
  if (!id) return {}
  const value = program.items.get(id)?.value
  const literal = value && /^'([^']+)'$/.exec(value)
  return { via: id, ...(literal ? { target: literal[1]!.trim().toUpperCase() } : {}) }
}

function correspondingFlows(program: Program, from: Ref, to: Ref, paragraph: string) {
  const source = program.items.get(from.id)
  const target = program.items.get(to.id)
  if (!source || !target) return
  for (const child of source.children) {
    const name = program.items.get(child)?.name
    const match = target.children.find((c) => program.items.get(c)?.name === name)
    if (match) program.flows.push({ file: to.token.file, line: to.token.line, from: child, to: match, paragraph, verb: "MOVE CORRESPONDING" })
  }
}

/** Option value inside EXEC ... END-EXEC: NAME ( value ). */
function option(tokens: readonly Token[], from: number, to: number, name: string): Token[] | undefined {
  for (let k = from; k < to; k++) {
    if (tokens[k]!.text !== name || tokens[k + 1]?.kind !== "lparen") continue
    const out: Token[] = []
    let depth = 0
    for (let n = k + 1; n < to; n++) {
      if (tokens[n]!.kind === "lparen") depth++
      else if (tokens[n]!.kind === "rparen") {
        depth--
        if (depth === 0) return out
      } else out.push(tokens[n]!)
    }
    return out
  }
  return undefined
}

function parseExec(program: Program, tokens: readonly Token[], i: number, stop: number, paragraph: string, access: (ref: Ref, mode: Access["mode"], verb: string) => void) {
  const kind = tokens[i + 1]?.text
  const command = tokens.slice(i + 2, Math.min(stop, i + 4)).filter((t) => t.kind === "word" && !["END-EXEC"].includes(t.text))
  const first = tokens[i]!
  if (kind === "CICS") {
    const name = command[0]?.text ?? ""
    const verb = `EXEC CICS ${name}`
    const refsIn = (opt: string) => {
      const value = option(tokens, i, stop, opt)
      return value ? references(program, value, 0, value.length) : []
    }
    for (const opt of ["FROM", "RIDFLD", "COMMAREA", "LENGTH", "KEYLENGTH"]) refsIn(opt).forEach((r) => access(r, "read", verb))
    for (const opt of ["INTO", "RESP", "RESP2", "SET"]) refsIn(opt).forEach((r) => access(r, "write", verb))
    const resources: string[] = []
    for (const opt of ["DATASET", "FILE", "MAP", "MAPSET", "QUEUE", "TRANSID"]) {
      const value = option(tokens, i, stop, opt)
      if (!value?.length) continue
      const v = value[0]!
      const resolved = v.kind === "literal" ? v.text : callTarget(program, v).target ?? v.text
      resources.push(`${opt}:${resolved.trim().toUpperCase()}`)
    }
    program.execs.push({ file: first.file, line: first.line, paragraph, kind: "online", command: name, resources })
    if (name === "LINK" || name === "XCTL") {
      const target = option(tokens, i, stop, "PROGRAM")?.[0]
      const commarea = refsIn("COMMAREA")
      if (target) program.calls.push({ ...callTarget(program, target), file: first.file, line: first.line, paragraph, kind: name === "LINK" ? "link" : "xctl", using: commarea.map((c) => c.id) })
    }
    return
  }
  if (kind === "SQL") {
    const words = tokens.slice(i + 2, stop)
    const statement = words[0]?.text ?? ""
    const tables = new Set<string>()
    for (let k = 0; k < words.length; k++) {
      if (["FROM", "INTO", "UPDATE", "JOIN", "TABLE"].includes(words[k]!.text) && words[k + 1]?.kind === "word" && words[k - 1]?.text !== ":") {
        // schema.table is tokenised as word "." word only with a space; accept both forms
        let name = words[k + 1]!.text
        if (words[k + 2]?.text === "." && words[k + 3]) name += `.${words[k + 3]!.text}`
        if (statement === "FETCH" || (words[k]!.text === "INTO" && statement === "SELECT")) continue
        tables.add(name)
      }
    }
    const verb = `EXEC SQL ${statement}`
    for (let k = 0; k < words.length; k++) {
      if (words[k]!.text !== ":" || words[k + 1]?.kind !== "word") continue
      const id = resolveName(program, words[k + 1]!.text, [])
      if (!id) continue
      const writesHost = ["FETCH", "SELECT"].includes(statement) && words.slice(0, k).some((w) => w.text === "INTO")
      access({ id, token: words[k + 1]! }, writesHost ? "write" : "read", verb)
    }
    program.execs.push({ file: first.file, line: first.line, paragraph, kind: "sql", command: statement, resources: [...tables].map((t) => `TABLE:${t}`) })
  }
}
