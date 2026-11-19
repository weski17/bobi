import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { CLI, createServer, jclDatasets, jclProblems, MainframeClient, startMockMainframe, TOOLS, type MockMainframe } from "../src/index.ts"

const password = crypto.randomUUID()
const home = mkdtempSync(path.join(tmpdir(), "bobi-zowe-home-"))
let mainframe: MockMainframe
let client: Client
let env: Record<string, string>

beforeAll(async () => {
  mainframe = startMockMainframe({ user: "dev1", password })
  mainframe.datasets.set("DEV1.COBOL.SRC(PAYCALC)", "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. PAYCALC.\n")
  mainframe.datasets.set("DEV1.COBOL.SRC(TAXCALC)", "       PROGRAM-ID. TAXCALC.\n")
  mainframe.datasets.set("DEV1.JCL(RUN)", "//RUNJOB JOB 1\n//S1 EXEC PGM=PAYCALC\n//IN DD DSN=DEV1.DATA,DISP=SHR\n")
  mainframe.datasets.set("DEV1.JCL(BAD)", "//BADJOB JOB 1\n//S1 EXEC PGM=X\n//IN DD DSN=PROD.PAYROLL.MASTER,DISP=SHR\n")
  mainframe.datasets.set("DEV1.DATA", "record 1\n")
  mainframe.datasets.set("PROD.PAYROLL.MASTER", "secret production data")
  mainframe.uss.set("/u/dev1/notes.txt", "hello uss")
  env = { HOME: home, ZOWE_OPT_HOST: "127.0.0.1", ZOWE_OPT_PORT: String(mainframe.port), ZOWE_OPT_PROTOCOL: "http", ZOWE_OPT_USER: "dev1", ZOWE_OPT_PASSWORD: password }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer(home, { env }).connect(serverSide)
  client = new Client({ name: "t", version: "1" })
  await client.connect(clientSide)
})
afterAll(async () => {
  await client.close()
  mainframe.stop()
  rmSync(home, { recursive: true, force: true })
})

const call = async (name: string, args: Record<string, unknown>, c = client) => {
  const result = await c.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]!.text
  return { error: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) }
}

test("datasets: list (allowlist filtered), members, read, write", async () => {
  const listed = (await call("list_datasets", { pattern: "*" })).data
  expect(listed.datasets.map((d: { dsname: string }) => d.dsname)).toEqual(["DEV1.COBOL.SRC", "DEV1.DATA", "DEV1.JCL"])
  expect(listed).toMatchObject({ hidden: 1, allowedPatterns: ["DEV1.**"] })
  expect((await call("list_datasets", { pattern: "DEV1.*" })).data.hidden).toBeUndefined()
  expect((await call("list_members", { dataset: "dev1.cobol.src", pattern: "PAY*" })).data.members).toEqual(["PAYCALC"])
  expect((await call("read_dataset", { dataset: "DEV1.COBOL.SRC", member: "paycalc" })).data.content).toContain("PROGRAM-ID. PAYCALC.")
  expect((await call("read_dataset", { dataset: "DEV1.DATA" })).data).toMatchObject({ dataset: "DEV1.DATA", content: "record 1\n" })
  expect((await call("write_dataset", { dataset: "DEV1.COBOL.SRC", member: "NEW", content: "line 1\nline 2" })).data).toEqual({ written: "DEV1.COBOL.SRC(NEW)", lines: 2 })
  expect(mainframe.datasets.get("DEV1.COBOL.SRC(NEW)")).toBe("line 1\nline 2")
})

test("production data outside the allowlist is refused before any request", async () => {
  const before = mainframe.requests.length
  for (const [name, args] of [
    ["read_dataset", { dataset: "PROD.PAYROLL.MASTER" }],
    ["write_dataset", { dataset: "PROD.PAYROLL.MASTER", content: "x" }],
    ["list_members", { dataset: "PROD.LOADLIB" }],
    ["read_uss_file", { path: "/etc/passwd" }],
    ["submit_job", { jcl: "//X JOB 1\n//S EXEC PGM=IEFBR14\n//D DD DSN=PROD.PAYROLL.MASTER,DISP=OLD" }],
  ] as const) {
    const result = await call(name, args)
    expect(result.error).toBe(true)
    expect(result.text).toContain("outside the allowed")
  }
  expect(mainframe.requests.length).toBe(before)
  expect((await call("submit_job", { dataset: "DEV1.JCL", member: "BAD" })).text).toContain("PROD.PAYROLL.MASTER is outside")
})

test("USS and jobs: submit inline and from a dataset, status, spool output", async () => {
  expect((await call("list_uss", { path: "/u/dev1" })).data.entries.map((e: { name: string }) => e.name)).toContain("notes.txt")
  expect((await call("read_uss_file", { path: "/u/dev1/notes.txt" })).data.content).toBe("hello uss")
  const inline = (await call("submit_job", { jcl: "//HELLO JOB 1\n//S1 EXEC PGM=IEFBR14\n//T DD DSN=&&TEMP,DISP=(NEW,PASS)\n" })).data.submitted
  expect(inline).toMatchObject({ jobname: "HELLO", jobid: "JOB00001" })
  const stored = (await call("submit_job", { dataset: "DEV1.JCL", member: "RUN" })).data.submitted
  expect(stored.jobname).toBe("RUNJOB")
  expect((await call("list_jobs", {})).data.jobs.map((j: { jobname: string }) => j.jobname)).toEqual(["HELLO", "RUNJOB"])
  expect((await call("list_jobs", { prefix: "RUN*", status: "OUTPUT" })).data.jobs).toHaveLength(1)
  expect((await call("job_status", { jobname: "hello", jobid: "job00001" })).data).toMatchObject({ status: "OUTPUT", retcode: "CC 0000" })
  expect((await call("job_output", { jobname: "RUNJOB", jobid: "JOB00002" })).data.files.map((f: { ddname: string }) => f.ddname)).toEqual(["JESMSGLG", "JESJCL", "SYSOUT"])
  expect((await call("job_output", { jobname: "RUNJOB", jobid: "JOB00002", ddname: "sysout", stepname: "step01" })).data.content).toBe("HELLO FROM THE MOCK MAINFRAME")
  expect((await call("job_output", { jobname: "RUNJOB", jobid: "JOB00002", id: 3 })).data.content).toContain("//RUNJOB JOB")
  expect((await call("job_output", { jobname: "RUNJOB", jobid: "JOB00002", ddname: "NOPE" })).text).toContain("has no spool file NOPE")
})

test("input validation, REST errors and unreachable hosts are tool errors", async () => {
  const errors: [string, Record<string, unknown>, string][] = [
    ["read_dataset", {}, '"dataset" is required'],
    ["read_dataset", { dataset: "DEV1.COBOL.SRC", member: "TOO.LONG.X" }, "not a valid member name"],
    ["read_dataset", { dataset: "DEV1.MISSING" }, "HTTP 404"],
    ["write_dataset", { dataset: "DEV1.X" }, '"content" is required'],
    ["job_status", { jobname: "BAD NAME", jobid: "J1" }, "valid job identifiers"],
    ["submit_job", {}, 'Give either "jcl" or "dataset"'],
    ["submit_job", { jcl: "x", dataset: "DEV1.JCL" }, 'Give either "jcl" or "dataset"'],
    ["list_jobs", { owner: "" }, "non-empty string"],
    ["nope", {}, "Unknown tool"],
  ]
  for (const [name, args, message] of errors) {
    const result = await call(name, args)
    expect(result.error).toBe(true)
    expect(result.text).toContain(message)
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(home, { env: { ...env, ZOWE_OPT_PASSWORD: "wrong-password-for-test" } }).connect(b)
  const wrong = new Client({ name: "t", version: "1" })
  await wrong.connect(a)
  expect((await call("list_jobs", {}, wrong)).text).toContain("HTTP 401 (check ZOWE_OPT_USER / ZOWE_OPT_PASSWORD): not authorized")
  await wrong.close()
  const [c, d] = InMemoryTransport.createLinkedPair()
  await createServer(home, { env: { ...env, ZOWE_OPT_PORT: "1" }, timeout: 2000 }).connect(d)
  const down = new Client({ name: "t", version: "1" })
  await down.connect(c)
  expect((await call("list_jobs", {}, down)).text).toContain("Mainframe not reachable")
  expect((await call("list_jobs", {}, down)).error).toBe(true)
  await down.close()
  const [e, f] = InMemoryTransport.createLinkedPair()
  await createServer(home, { env: { HOME: home } }).connect(f)
  const unconfigured = new Client({ name: "t", version: "1" })
  await unconfigured.connect(e)
  expect((await call("list_jobs", {}, unconfigured)).text).toContain("Mainframe connection not configured")
  await unconfigured.close()
})

test("the client sends basic auth and the CSRF header; large responses are truncated", async () => {
  const seen: Request[] = []
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response("x".repeat(20))
  }) as typeof fetch
  const c = new MainframeClient({ protocol: "https", host: "mf", port: 443, basePath: "/gw", user: "u", password, datasets: [], uss: [], source: "test" }, { fetch: fake, maxBytes: 10 })
  expect(await c.readDataset("A.B")).toEqual({ text: "x".repeat(10), truncated: true })
  expect(seen[0]!.url).toBe("https://mf/gw/zosmf/restfiles/ds/A.B")
  expect(seen[0]!.headers.get("x-csrf-zosmf-header")).toBe("true")
  expect(seen[0]!.headers.get("authorization")).toBe(`Basic ${Buffer.from(`u:${password}`).toString("base64")}`)
  const plain = new MainframeClient(c.connection, { fetch: (async () => new Response("plain failure", { status: 500 })) as unknown as typeof fetch })
  await expect(plain.listJobs({})).rejects.toThrow("HTTP 500: plain failure")
})

test("jclDatasets skips comments, temporary datasets and backward references", () => {
  expect(jclDatasets("//* DSN=IN.COMMENT\n//A DD DSN=&&T\n//B DD DSN=*.STEP1.OUT\n//C DD DSNAME='dev1.lib(mem)',DISP=SHR\n DSN=NOT.JCL\n")).toEqual(["DEV1.LIB"])
})

test("jclProblems refuses jobs whose datasets cannot be checked (review 2026-11-19, H5)", () => {
  const job = (...lines: string[]) => ["//DEV1J JOB (ACCT),'T',CLASS=A", ...lines].join("\n")
  expect(jclProblems(job("//S1 EXEC PGM=IEFBR14", "//DD1 DD DSN=DEV1.X,DISP=SHR"))).toEqual([])
  expect(jclProblems(job("//S1 EXEC PGM=IDCAMS", "//SYSIN DD *", "  DELETE PROD.PAY.MASTER", "/*"))).toEqual([expect.stringContaining("IDCAMS")])
  expect(jclProblems(job("//S1 EXEC PGM=IKJEFT01"))[0]).toContain("IKJEFT01")
  expect(jclProblems(job("//S1 EXEC PGM=BPXBATCH,PARM='SH rm -rf /prod'"))[0]).toContain("BPXBATCH")
  expect(jclProblems(job("//S1 EXEC MYPROC,HLQ=PROD"))[0]).toContain("procedure")
  expect(jclProblems(job("//S1 EXEC PROC=MYPROC"))[0]).toContain("procedure")
  expect(jclProblems(job("//LIBS JCLLIB ORDER=PROD.PROCLIB"))[0]).toContain("JCLLIB")
  expect(jclProblems(job("// INCLUDE MEMBER=PRODJCL"))[0]).toContain("INCLUDE")
  expect(jclProblems(job("//S1 EXEC PGM=IEBGENER", "//SYSUT2 DD SYSOUT=(A,INTRDR)"))[0]).toContain("INTRDR")
  expect(jclProblems(job("//S1 EXEC PGM=IEFBR14", "//F DD PATH='/prod/x'"))[0]).toContain("PATH=")
  // Comments and text after column 72 do not count.
  expect(jclProblems(job("//* EXEC PGM=IDCAMS", "//S1 EXEC PGM=IEFBR14" + " ".repeat(60) + "INTRDR"))).toEqual([])
})

test("stdio CLI lists the tools", async () => {
  const stdio = new Client({ name: "t", version: "1" })
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, home], env: { HOME: home, PATH: process.env.PATH ?? "" } }))
  try {
    expect((await stdio.listTools()).tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
  } finally {
    await stdio.close()
  }
}, 30_000)
