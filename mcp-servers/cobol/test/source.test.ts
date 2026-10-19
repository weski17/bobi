import { expect, test } from "bun:test"
import { applyReplacing, expand, normalize, tokenize } from "../src/source.ts"

const fixed = (code: string, indicator = " ") => `000100${indicator}${code}`

test("normalize drops comments, sequence and identification areas, and joins continuations", () => {
  const source = [
    fixed("IDENTIFICATION DIVISION.".padEnd(65) + "IGNORED1"),
    fixed("comment", "*"),
    fixed("page eject", "/"),
    fixed("debug line", "D"),
    fixed("    DISPLAY 'ABC"),
    fixed("    'DEF'.", "-"),
    fixed("    MOVE A TO B *> inline"),
    "short",
    fixed(""),
  ].join("\r\n")
  const lines = normalize(source, "p.cbl")
  expect(lines.map((l) => l.text.trim())).toEqual(["IDENTIFICATION DIVISION.", `DISPLAY 'ABC${" ".repeat(49)}DEF'.`, "MOVE A TO B"])
  expect(lines[0]).toMatchObject({ line: 1, areaA: true })
  expect(lines[1]).toMatchObject({ line: 5, areaA: false })
})

test("a continuation without an open literal joins words; one without a previous line is ignored", () => {
  expect(normalize([fixed("X", "-"), fixed("    MOVE A"), fixed("    TO B.", "-")].join("\n"), "p").map((l) => l.text.trim())).toEqual(["MOVE A TO B."])
})

test("free format: directive, *> comments, area A by column 1", () => {
  const lines = normalize(">>SOURCE FORMAT IS FREE\nPROGRAM-ID. X.\n  *> note\n  MOVE 'a*>b' TO C *> c\n\n", "p")
  expect(lines.map((l) => [l.text, l.areaA])).toEqual([["PROGRAM-ID. X.", true], ["  MOVE 'a*>b' TO C", false]])
})

test("tokenize: words, literals, numbers, pictures, pseudo-text, operators", () => {
  const tokens = tokenize(normalize(`>>SOURCE FREE\n01 A PIC S9(5)V99 VALUE -12.50.\n MOVE X'0F' TO B(1). COMPUTE C = D ** 2 + E - 1.\n COPY X REPLACING ==:P:== BY ==WS==. MOVE 'IT''S' TO F; G, H.\n PIC IS 9(3). A:B`, "p"))
  const texts = tokens.map((t) => `${t.kind}:${t.text}`)
  expect(texts.slice(0, 7)).toEqual(["number:01", "word:A", "word:PIC", "word:S9(5)V99", "word:VALUE", "number:-12.50", "period:."])
  expect(texts).toContain("literal:0F")
  expect(texts).toContain("lparen:(")
  expect(texts).toContain("op:**")
  expect(texts).toContain("op:+")
  expect(texts).toContain("pseudo::P:")
  expect(texts).toContain("literal:IT'S")
  expect(texts).toContain("word:9(3)")
  expect(texts).toContain("op::")
  expect(tokens[0]!.areaA).toBe(true)
})

test("an unterminated pseudo-text or literal runs to the end of the line", () => {
  const texts = tokenize(normalize(">>SOURCE FREE\n COPY A REPLACING ==X BY\n DISPLAY 'open\n MOVE 1 TO A.", "p")).map((t) => `${t.kind}:${t.text}`)
  expect(texts).toContain("pseudo:X BY")
  expect(texts).toContain("literal:open")
})

test("applyReplacing: partial-word pseudo-text and whole words", () => {
  const lines = normalize(">>SOURCE FREE\n 05 FLG-(T1)-OK PIC X.\n MOVE TAG TO TAGGED.", "c")
  const out = applyReplacing(lines, [
    { from: "(T1)", to: "ACCT", word: false },
    { from: "TAG", to: "LABEL", word: true },
    { from: "", to: "x", word: true },
  ])
  expect(out.map((l) => l.text.trim())).toEqual(["05 FLG-ACCT-OK PIC X.", "MOVE LABEL TO TAGGED."])
  expect(applyReplacing(lines, [])).toEqual(lines)
})

test("expand: nested COPY, REPLACING, OF library, EXEC SQL INCLUDE, cycles and missing members", () => {
  const files: Record<string, string> = {
    "A.cpy": " 01 :P:-REC.\n   COPY B.",
    "B.cpy": " 05 B-FIELD PIC X.\n COPY A.",
    "D.cpy": " 01 DCL-ROW PIC X.",
  }
  const source = ">>SOURCE FREE\n COPY A OF LIB SUPPRESS REPLACING ==:P:== BY ==WS== TAG BY TAG2.\n COPY 'MISSING'.\n EXEC SQL INCLUDE D END-EXEC.\n EXEC SQL INCLUDE SQLCA END-EXEC.\n COPY BROKEN."
  const result = expand(source, "main.cbl", {
    resolve: (name) => (name === "BROKEN" ? "broken.cpy" : files[`${name}.cpy`] ? `${name}.cpy` : undefined),
    read: (file) => {
      if (!(file in files)) throw new Error("unreadable")
      return `>>SOURCE FREE\n${files[file]}`
    },
  })
  const words = result.tokens.filter((t) => t.kind === "word").map((t) => t.text)
  expect(words).toContain("WS-REC")
  expect(words).toContain("B-FIELD")
  expect(words).toContain("DCL-ROW")
  expect(words).toContain("SQLCA") // left in place: supplied by the precompiler
  expect(result.copies.map((c) => [c.name, c.resolved ?? null])).toEqual([
    ["A", "A.cpy"],
    ["B", "B.cpy"],
    ["A", "A.cpy"],
    ["MISSING", null],
    ["D", "D.cpy"],
    ["BROKEN", "broken.cpy"],
  ])
  const field = result.tokens.find((t) => t.text === "B-FIELD")!
  expect(field).toMatchObject({ file: "B.cpy", line: 2 })
  expect(expand("       COPY A.", "x.cbl", { resolve: () => "A.cpy", read: () => "       01 X PIC X.", maxDepth: 0 }).tokens).toEqual([])
})
