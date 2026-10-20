// In-memory mock of the mainframe REST services for tests and demos (no real mainframe needed).
// Checks basic auth and the CSRF header like the real services.

export type MockMainframe = {
  readonly url: string
  readonly port: number
  /** "DSN" or "DSN(MEMBER)" → content. */
  readonly datasets: Map<string, string>
  readonly uss: Map<string, string>
  readonly jobs: { jobname: string; jobid: string; owner: string; status: string; retcode: string | null; jcl: string }[]
  readonly requests: { method: string; path: string }[]
  stop(): void
}

export function startMockMainframe(options: { user: string; password: string; port?: number }): MockMainframe {
  const datasets = new Map<string, string>()
  const uss = new Map<string, string>()
  const jobs: MockMainframe["jobs"] = []
  const requests: MockMainframe["requests"] = []
  const expected = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString("base64")}`
  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const error = (status: number, message: string) => json({ message, details: [`mock: ${message}`] }, status)

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      const path = decodeURIComponent(url.pathname)
      requests.push({ method: request.method, path: `${url.pathname}${url.search}` })
      if (request.headers.get("authorization") !== expected) return error(401, "not authorized")
      if (request.headers.get("x-csrf-zosmf-header") !== "true") return error(403, "missing CSRF header")
      const ds = /^\/zosmf\/restfiles\/ds\/([^/(]+)(?:\(([^)]+)\))?(\/member)?$/.exec(path)
      if (path === "/zosmf/restfiles/ds" && request.method === "GET") {
        const level = (url.searchParams.get("dslevel") ?? "").replace(/\*\*?/g, "")
        const names = new Set([...datasets.keys()].map((k) => k.replace(/\(.*$/, "")).filter((k) => k.startsWith(level)))
        return json({ items: [...names].sort().map((dsname) => ({ dsname, dsorg: [...datasets.keys()].some((k) => k.startsWith(`${dsname}(`)) ? "PO" : "PS" })), returnedRows: names.size })
      }
      if (ds && ds[3]) {
        const prefix = `${ds[1]}(`
        const members = [...datasets.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length, -1))
        if (members.length === 0) return error(404, `${ds[1]} not found`)
        const pattern = url.searchParams.get("pattern")?.replace("*", "")
        return json({ items: members.filter((m) => !pattern || m.startsWith(pattern)).map((member) => ({ member })) })
      }
      if (ds) {
        const key = ds[2] ? `${ds[1]}(${ds[2]})` : ds[1]!
        if (request.method === "GET") return datasets.has(key) ? new Response(datasets.get(key)) : error(404, `${key} not found`)
        if (request.method === "PUT") {
          datasets.set(key, await request.text())
          return new Response(null, { status: 204 })
        }
      }
      if (path === "/zosmf/restfiles/fs" && request.method === "GET") {
        const dir = (url.searchParams.get("path") ?? "/").replace(/\/$/, "")
        const items = [...uss.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => ({ name: k.slice(dir.length + 1), mode: "-rw-r--r--", size: uss.get(k)!.length }))
        return json({ items: [{ name: ".", mode: "drwxr-xr-x" }, ...items] })
      }
      if (path.startsWith("/zosmf/restfiles/fs/") && request.method === "GET") {
        const file = path.slice("/zosmf/restfiles/fs".length)
        return uss.has(file) ? new Response(uss.get(file)) : error(404, `${file} not found`)
      }
      if (path === "/zosmf/restjobs/jobs" && request.method === "GET") {
        const owner = url.searchParams.get("owner")
        const prefix = url.searchParams.get("prefix")?.replace("*", "")
        return json(jobs.filter((j) => (!owner || j.owner === owner) && (!prefix || j.jobname.startsWith(prefix))).map(({ jcl: _jcl, ...j }) => j))
      }
      if (path === "/zosmf/restjobs/jobs" && request.method === "PUT") {
        let jcl = await request.text()
        if (request.headers.get("content-type") === "application/json") {
          const file = /^\/\/'(.+)'$/.exec((JSON.parse(jcl) as { file: string }).file)?.[1] ?? ""
          if (!datasets.has(file)) return error(404, `${file} not found`)
          jcl = datasets.get(file)!
        }
        const jobname = /^\/\/(\S+)\s+JOB/m.exec(jcl)?.[1] ?? "NONAME"
        const job = { jobname, jobid: `JOB${String(jobs.length + 1).padStart(5, "0")}`, owner: options.user.toUpperCase(), status: "OUTPUT", retcode: "CC 0000", jcl }
        jobs.push(job)
        const { jcl: _jcl, ...visible } = job
        return json({ ...visible, status: "INPUT", retcode: null }, 201)
      }
      const jobPath = /^\/zosmf\/restjobs\/jobs\/([^/]+)\/([^/]+)(\/files(?:\/(\d+)\/records)?)?$/.exec(path)
      if (jobPath && request.method === "GET") {
        const found = jobs.find((j) => j.jobname === jobPath[1] && j.jobid === jobPath[2])
        if (!found) return error(404, "job not found")
        const { jcl, ...visible } = found
        if (!jobPath[3]) return json(visible)
        const files = [
          { id: 2, ddname: "JESMSGLG", stepname: "JES2", recordcount: 1 },
          { id: 3, ddname: "JESJCL", stepname: "JES2", recordcount: jcl.split("\n").length },
          { id: 102, ddname: "SYSOUT", stepname: "STEP01", recordcount: 1 },
        ]
        if (!jobPath[4]) return json(files)
        const id = Number(jobPath[4])
        if (id === 2) return new Response(`${found.jobname} ENDED - RC=0000`)
        if (id === 3) return new Response(jcl)
        if (id === 102) return new Response("HELLO FROM THE MOCK MAINFRAME")
        return error(404, "spool file not found")
      }
      return error(404, `no route ${request.method} ${path}`)
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port!,
    datasets,
    uss,
    jobs,
    requests,
    stop: () => server.stop(true),
  }
}
