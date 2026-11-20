import { expect, test } from "bun:test"
import { analyze, DEFAULT_LIMITS, supported } from "../src/index.ts"

const rules = (tips: { rule: string }[]) => tips.map((t) => t.rule)

test("TypeScript: complexity, length, nesting, parameters, empty catch, any, loose equality", () => {
  const branches = Array.from({ length: 11 }, (_, i) => `  if (x === ${i}) return ${i}`).join("\n")
  const code = `
export function branchy(x: number) {
${branches}
  return x && x > 0 ? 1 : 0
}
export function nested(a: boolean) {
  if (a) { for (const b of [1]) { while (a) { switch (b) { case 1: try { if (a) {} } catch (e) { /* ignored on purpose */ } } } } }
}
function many(a: any, b: number, c: number, d: number, e: number, f: number) {
  try { run() } catch {}
  return a == b || a != null
}
class Store { save(x: number) { if (x) { return 1 } else if (x > 2) { return 2 } return 3 } }
const arrow = (y: number) => y
const long = function () {
${Array.from({ length: 61 }, () => "  run()").join("\n")}
}
`
  const tips = analyze("/p/a.ts", code)
  expect(rules(tips)).toEqual(expect.arrayContaining(["complexity", "nesting", "parameters", "empty-catch", "explicit-any", "loose-equality", "function-length"]))
  expect(tips.find((t) => t.rule === "complexity")).toMatchObject({ symbol: "branchy", line: 2, severity: "warning" })
  expect(tips.find((t) => t.rule === "nesting")!.message).toContain("nested nests blocks 6 levels deep")
  expect(tips.find((t) => t.rule === "parameters")).toMatchObject({ symbol: "many", severity: "info" })
  expect(tips.filter((t) => t.rule === "empty-catch")).toHaveLength(1)
  expect(tips.filter((t) => t.rule === "loose-equality")).toHaveLength(1)
  expect(tips.find((t) => t.rule === "function-length")!.symbol).toBe("long")
  expect(tips.some((t) => t.symbol === "Store.save")).toBe(false)
  expect(tips.some((t) => t.symbol === "arrow")).toBe(false)
})

test("JavaScript files get no `any` tip; limits are configurable; names of anonymous and member functions", () => {
  const js = "const o = { run: function (a, b) { if (a == b) {} } }\nexport default function (x) { return x }\nclass K { constructor() { if (1) {} } }"
  expect(rules(analyze("/p/a.mjs", js))).toEqual(["loose-equality"])
  const tight = analyze("/p/a.jsx", js, { complexity: 1, parameters: 1 })
  expect(tight.map((t) => t.symbol)).toEqual(expect.arrayContaining(["run", "constructor"]))
  expect(rules(analyze("/p/a.tsx", "const f = (a: any) => <div>{a}</div>"))).toEqual(["explicit-any"])
  expect(analyze("/p/a.cts", "export const x = 1")).toEqual([])
})

test("COBOL: long paragraphs, nesting, GO TO, PERFORM THRU, ALTER", () => {
  const line = (code: string) => `       ${code}`
  const body = Array.from({ length: 61 }, (_, i) => line(`    MOVE ${i} TO WS-A`))
  const cobol = [
    line("IDENTIFICATION DIVISION."),
    line("PROGRAM-ID. TIPS."),
    line("DATA DIVISION."),
    line("WORKING-STORAGE SECTION."),
    line("01 WS-A PIC 9(3)."),
    line("PROCEDURE DIVISION."),
    line("MAIN-PARA."),
    line("    PERFORM STEP-A THRU STEP-B"),
    line("    ALTER EXIT-PARA TO PROCEED TO STEP-B"),
    line("    GO TO STEP-B."),
    line("STEP-A."),
    ...body,
    line("    ."),
    line("STEP-B."),
    line("    IF WS-A = 1"),
    line("      IF WS-A = 2"),
    line("        EVALUATE TRUE WHEN OTHER"),
    line("          PERFORM UNTIL WS-A > 5"),
    line("            IF WS-A = 3 DISPLAY 'X' END-IF"),
    line("          END-PERFORM"),
    line("        END-EVALUATE"),
    line("      END-IF"),
    line("    END-IF."),
    line("EXIT-PARA."),
    line("    EXIT."),
  ].join("\n")
  const tips = analyze("/p/TIPS.cbl", cobol)
  expect(rules(tips)).toEqual(["perform-thru", "alter", "go-to", "function-length", "nesting"])
  expect(tips.find((t) => t.rule === "function-length")).toMatchObject({ symbol: "STEP-A", line: 11 })
  expect(tips.find((t) => t.rule === "nesting")!.message).toContain("5 levels deep")
  expect(analyze("/p/EMPTY.cpy", "       01 X PIC X.")).toEqual([])
})

test("supported languages and size limit", () => {
  expect(supported("/a/b.ts")).toBe("typescript")
  expect(supported("/a/b.d.ts")).toBeUndefined()
  expect(supported("/a/B.CBL")).toBe("cobol")
  expect(supported("/a/b.py")).toBeUndefined()
  expect(analyze("/a/b.py", "def f(): pass")).toEqual([])
  expect(analyze("/a/b.ts", `// ${"x".repeat(600_000)}`)).toEqual([])
  expect(DEFAULT_LIMITS).toEqual({ complexity: 10, functionLines: 60, nesting: 4, parameters: 5 })
})

test("a COBOL file with tens of thousands of paragraphs is analysed quickly (review 2026-11-19, M9)", () => {
  const source = "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n" + Array.from({ length: 40_000 }, (_, i) => `       P${i}.\n`).join("")
  const began = performance.now()
  analyze("x.cbl", source)
  expect(performance.now() - began).toBeLessThan(2_000)
})

test("COBOL tips ignore COPY statements (copybooks are not resolved)", () => {
  const source = "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n           COPY CUSTREC.\n       PROCEDURE DIVISION.\n       MAIN.\n           STOP RUN.\n"
  expect(analyze("y.cbl", source)).toEqual([])
})
