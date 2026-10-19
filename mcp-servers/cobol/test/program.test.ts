import { expect, test } from "bun:test"
import path from "node:path"
import { CobolProject, parseJcl, parseProgram } from "../src/index.ts"
import { tokenize, normalize } from "../src/source.ts"

const project = CobolProject.build(path.join(import.meta.dir, "fixture"))
const pay = project.programs.get("PAYCALC")!

test("indexes programs (fixed and free format), copybooks and JCL", () => {
  expect([...project.programs.keys()].sort()).toEqual(["PAYCALC", "TAXCALC"])
  expect([...project.copybooks.keys()]).toEqual(["EMPREC"])
  expect(project.problems).toEqual([])
  expect(project.programs.get("TAXCALC")!.using).toEqual(["LK-GROSS", "LK-TAX"])
})

test("data items: levels, groups, PIC/USAGE/VALUE, REDEFINES, 88, copybook origin with REPLACING", () => {
  expect(pay.items.get("WS-GROSS")).toMatchObject({ level: 5, picture: "S9(7)V99", usage: "COMP-3", value: "ZERO", parent: "WS-TOTALS" })
  expect(pay.items.get("WS-NET-X")).toMatchObject({ redefines: "WS-TOTALS", picture: "X(15)" })
  expect(pay.items.get("END-OF-FILE")).toMatchObject({ level: 88, parent: "WS-EOF", value: "'Y'" })
  expect(pay.items.get("WS-SALARY")).toMatchObject({ file: "cpy/EMPREC.cpy", line: 4, parent: "WS-EMPLOYEE" })
  expect(pay.items.get("EMP-FILE-REC")).toMatchObject({ fileName: "EMP-FILE", section: "FILE" })
  expect(pay.items.get("WS-MSG")!.value).toBe(`'A LONG MESSAGE THAT${" ".repeat(13)}CONTINUES ON THE NEXT LINE'`)
  expect(pay.files).toEqual([{ file: "cbl/PAYCALC.cbl", line: 7, name: "EMP-FILE", assign: "EMPIN", organization: "SEQUENTIAL" }])
})

test("procedure: paragraphs, PERFORM THRU, GO TO, dynamic CALL via VALUE, LINK, SQL tables", () => {
  expect(pay.paragraphs.map((p) => p.name)).toEqual(["0000-MAIN", "1000-READ", "1000-EXIT", "2000-CALC"])
  expect(pay.edges.map((e) => `${e.from}>${e.to}:${e.kind}${e.thru ? `:${e.thru}` : ""}`)).toEqual([
    "0000-MAIN>1000-READ:perform:1000-EXIT",
    "0000-MAIN>2000-CALC:perform",
    "0000-MAIN>1000-READ:perform:1000-EXIT",
    "1000-READ>1000-EXIT:goto",
  ])
  expect(pay.calls).toMatchObject([
    { kind: "call", target: "TAXCALC", via: "WS-TAX-PGM", using: ["WS-GROSS", "WS-TAX"] },
    { kind: "link", target: "PAYAUDIT", using: ["WS-TOTALS"] },
  ])
  expect(pay.execs.find((e) => e.kind === "sql")).toMatchObject({ command: "UPDATE", resources: ["TABLE:PAYROLL.EMPLOYEE"] })
})

test("data flow and accesses", () => {
  expect(pay.flows.map((f) => `${f.from}>${f.to}:${f.verb}`)).toEqual([
    "EMP-FILE-REC>WS-EMPLOYEE:READ",
    "WS-SALARY>WS-GROSS:MOVE",
    "WS-GROSS>WS-TAX:COMPUTE",
    "WS-TAX>WS-NET:SUBTRACT",
    "WS-GROSS>WS-NET:SUBTRACT",
    "WS-NET>WS-PAYOUT:MOVE",
  ])
  // SET condition TO TRUE writes the conditional variable.
  expect(pay.accesses.filter((a) => a.item === "WS-EOF")).toMatchObject([{ mode: "write", verb: "SET", paragraph: "1000-READ" }])
  expect(pay.accesses.find((a) => a.item === "WS-ID")).toMatchObject({ mode: "read", verb: "EXEC SQL UPDATE" })
})

const parse = (code: string) => parseProgram(tokenize(normalize(`>>SOURCE FREE\n${code}`, "t.cbl")), "t.cbl", [])

test("statements: arithmetic forms, STRING/UNSTRING, WRITE FROM, INITIALIZE, ACCEPT, MOVE CORRESPONDING, sections", () => {
  const p = parse(`IDENTIFICATION DIVISION.
PROGRAM-ID. 'STMTS'.
DATA DIVISION.
WORKING-STORAGE SECTION.
01 A PIC 9. 01 B PIC 9. 01 C PIC 9. 01 D PIC 9. 01 R PIC 9.
01 S1. 05 K PIC X. 05 L PIC X.
01 S2. 05 K PIC X. 05 M PIC X.
01 T OCCURS 1 TO 9 DEPENDING ON A. 05 TV PIC X.
01 IDX USAGE IS INDEX.
01 P POINTER.
FILE SECTION.
FD OUT-F.
01 OUT-REC PIC X(10).
PROCEDURE DIVISION.
MAIN SECTION.
STEP-1.
    ADD A B TO C
    ADD A TO B GIVING D
    SUBTRACT A FROM B
    MULTIPLY A BY B
    DIVIDE A INTO B
    DIVIDE A BY B GIVING C REMAINDER R
    STRING A B DELIMITED BY SIZE INTO C
    UNSTRING C DELIMITED BY ' ' INTO A B
    WRITE OUT-REC FROM A
    REWRITE OUT-REC
    INITIALIZE S1
    ACCEPT D
    MOVE CORRESPONDING S1 TO S2
    MOVE K OF S2 TO L
    SET IDX TO A
    PERFORM VARYING A FROM 1 BY 1 UNTIL A > B
        DISPLAY TV (A)
    END-PERFORM
    EVALUATE TRUE WHEN A = 1 CONTINUE END-EVALUATE
    GO TO STEP-2 STEP-1 DEPENDING ON A.
STEP-2.
    CALL UNKNOWN-NAME
    CALL B
    MOVE NOTHING
    COMPUTE NOTHING
    STRING A
    READ OUT-F
    EXEC CICS RETURN END-EXEC
    EXIT.`)
  expect(p.id).toBe("STMTS")
  expect(p.paragraphs.map((x) => `${x.kind}:${x.name}:${x.section ?? ""}`)).toEqual(["section:MAIN:", "paragraph:STEP-1:MAIN", "paragraph:STEP-2:MAIN"])
  const flows = p.flows.map((f) => `${f.from}>${f.to}:${f.verb}`)
  expect(flows).toEqual(
    expect.arrayContaining([
      "A>C:ADD", "B>C:ADD", "A>D:ADD", "B>D:ADD", "A>B:SUBTRACT", "A>B:MULTIPLY", "A>B:DIVIDE", "A>C:DIVIDE", "A>R:DIVIDE",
      "A>C:STRING", "C>A:UNSTRING", "A>OUT-REC:WRITE", "K>K#2:MOVE CORRESPONDING", "K#2>L:MOVE", "A>IDX:SET",
    ]),
  )
  expect(flows).not.toContain("L>M:MOVE CORRESPONDING")
  expect(p.items.get("T")!.occurs).toBe("1 TO 9 DEPENDING ON A")
  expect(p.items.get("IDX")!.usage).toBe("INDEX")
  expect(p.items.get("P")!.usage).toBe("POINTER")
  expect(p.accesses.filter((a) => a.verb === "INITIALIZE").map((a) => a.item)).toEqual(["S1"])
  expect(p.accesses.filter((a) => a.verb === "PERFORM" && a.mode === "write").map((a) => a.item)).toEqual(["A"])
  expect(p.edges.filter((e) => e.kind === "goto").map((e) => e.to)).toEqual(["STEP-2", "STEP-1"])
  expect(p.calls.map((c) => [c.target ?? null, c.via ?? null])).toEqual([[null, null], [null, "B"]])
  expect(p.execs.at(-1)).toMatchObject({ kind: "online", command: "RETURN" })
})

test("a source without PROGRAM-ID or divisions is keyed by its file", () => {
  expect(parse("DISPLAY 'X'.").id).toBe("t.cbl")
})

test("qualified names and duplicates resolve to the right item", async () => {
  const { resolveName } = await import("../src/program.ts")
  const p = parse(`DATA DIVISION. WORKING-STORAGE SECTION.
01 G1. 05 F PIC X.
01 G2. 05 F PIC X. 05 F2 REDEFINES F PIC X.
PROCEDURE DIVISION.
    MOVE F OF G2 TO F IN G1.`)
  expect(resolveName(p, "F", ["G2"])).toBe("F#2")
  expect(resolveName(p, "F", [])).toBe("F")
  expect(resolveName(p, "NOPE", [])).toBeUndefined()
  expect(p.items.get("F2")!.redefines).toBe("F#2")
  expect(p.flows.map((f) => `${f.from}>${f.to}`)).toEqual(["F#2>F"])
})

test("JCL: jobs, PGM/PROC/bare procedure steps, DD with continuation, SYSOUT, DUMMY, instream", () => {
  const steps = parseJcl(
    [
      "//NIGHTLY JOB (1),'X'",
      "//* comment",
      "//S1 EXEC PGM=prog1,REGION=0M",
      "//IN   DD DISP=SHR,",
      "//        DSN=A.B.C",
      "//OUT  DD SYSOUT=*",
      "//NUL  DD DUMMY",
      "//SYSIN DD *",
      "  data",
      "//S2 EXEC PROC=MYPROC",
      "//S3 EXEC OTHER",
      "//OTHER DD UNIT=SYSDA",
      "not jcl",
    ].join("\n"),
    "jcl/N.jcl",
  )
  expect(steps).toMatchObject([
    { job: "NIGHTLY", step: "S1", program: "PROG1", dd: { IN: "A.B.C", OUT: "SYSOUT", NUL: "DUMMY", SYSIN: "INSTREAM" } },
    { step: "S2", proc: "MYPROC" },
    { step: "S3", proc: "OTHER", dd: { OTHER: "UNIT=SYSDA" } },
  ])
})

test("system diagram filtered to programs, without jobs", async () => {
  const { systemDiagram } = await import("../src/index.ts")
  const only = systemDiagram(project, { programs: ["taxcalc"], jobs: false })
  expect(only).toContain('PAYCALC -->|call| TAXCALC')
  expect(only).not.toContain("PAYAUDIT")
  expect(only).not.toContain("job_")
  expect(systemDiagram(project)).toContain('PAYAUDIT(["PAYAUDIT"])')
})
