// REST client for the mainframe's Zowe-compatible file and job REST services (the API the Zowe CLI uses).
import type { Connection } from "./connection.ts"

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type RestOptions = {
  readonly fetch?: typeof fetch
  /** Request timeout in milliseconds (default 30 s). */
  readonly timeout?: number
  /** Responses above this size are truncated (default 1 MB). */
  readonly maxBytes?: number
}

export type Dataset = { dsname: string; dsorg?: string; recfm?: string; lrecl?: string; vol?: string }
export type Job = { jobname: string; jobid: string; owner?: string; status?: string; retcode?: string | null; type?: string; class?: string }
export type SpoolFile = { id: number; ddname: string; stepname?: string; procstep?: string | null; recordcount?: number }

export class MainframeClient {
  constructor(
    readonly connection: Connection,
    private readonly options: RestOptions = {},
  ) {}

  private url(pathname: string, query?: Record<string, string | undefined>) {
    const c = this.connection
    const url = new URL(`${c.protocol}://${c.host}:${c.port}${c.basePath}${pathname}`)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v)
    return url
  }

  private async request(method: string, pathname: string, init: { query?: Record<string, string | undefined>; body?: string; headers?: Record<string, string> } = {}) {
    const c = this.connection
    const response = await (this.options.fetch ?? fetch)(this.url(pathname, init.query), {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${c.user}:${c.password}`).toString("base64")}`,
        // Required by the REST services for every request (CSRF protection).
        "X-CSRF-ZOSMF-HEADER": "true",
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(this.options.timeout ?? 30_000),
      ...(c.rejectUnauthorized ? {} : { tls: { rejectUnauthorized: false } }),
    } as RequestInit)
    if (!response.ok) {
      const text = (await response.text()).slice(0, 500)
      let detail = text
      try {
        const json = JSON.parse(text) as { message?: string; details?: string[] }
        detail = [json.message, ...(json.details ?? [])].filter(Boolean).join(" ") || text
      } catch {
        // plain-text error body
      }
      const hint = response.status === 401 ? " (check ZOWE_OPT_USER / ZOWE_OPT_PASSWORD)" : ""
      throw new RestError(response.status, `${method} ${pathname} failed with HTTP ${response.status}${hint}${detail ? `: ${detail}` : ""}`)
    }
    return response
  }

  private async text(response: Response) {
    const max = this.options.maxBytes ?? 1_000_000
    const text = await response.text()
    return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false }
  }

  async listDatasets(pattern: string): Promise<Dataset[]> {
    const response = await this.request("GET", "/zosmf/restfiles/ds", { query: { dslevel: pattern }, headers: { "X-IBM-Attributes": "base", "X-IBM-Max-Items": "1000" } })
    return ((await response.json()) as { items?: Dataset[] }).items ?? []
  }

  async listMembers(dataset: string, pattern?: string): Promise<string[]> {
    const response = await this.request("GET", `/zosmf/restfiles/ds/${encodeURIComponent(dataset)}/member`, { query: { pattern }, headers: { "X-IBM-Max-Items": "1000" } })
    return (((await response.json()) as { items?: { member: string }[] }).items ?? []).map((m) => m.member)
  }

  async readDataset(dataset: string, member?: string) {
    return this.text(await this.request("GET", `/zosmf/restfiles/ds/${encodeURIComponent(dataset)}${member ? `(${member})` : ""}`))
  }

  async writeDataset(dataset: string, member: string | undefined, content: string) {
    await this.request("PUT", `/zosmf/restfiles/ds/${encodeURIComponent(dataset)}${member ? `(${member})` : ""}`, {
      body: content,
      headers: { "content-type": "text/plain", "X-IBM-Data-Type": "text" },
    })
  }

  async listUss(dir: string) {
    const response = await this.request("GET", "/zosmf/restfiles/fs", { query: { path: dir } })
    return ((await response.json()) as { items?: { name: string; mode?: string; size?: number; mtime?: string }[] }).items ?? []
  }

  async readUss(file: string) {
    return this.text(await this.request("GET", `/zosmf/restfiles/fs${file.split("/").map(encodeURIComponent).join("/")}`))
  }

  async listJobs(query: { owner?: string; prefix?: string; status?: string }): Promise<Job[]> {
    const response = await this.request("GET", "/zosmf/restjobs/jobs", { query: { owner: query.owner, prefix: query.prefix, status: query.status, "max-jobs": "200" } })
    return (await response.json()) as Job[]
  }

  async jobStatus(jobname: string, jobid: string): Promise<Job> {
    return (await (await this.request("GET", `/zosmf/restjobs/jobs/${encodeURIComponent(jobname)}/${encodeURIComponent(jobid)}`)).json()) as Job
  }

  async submitJcl(jcl: string): Promise<Job> {
    const response = await this.request("PUT", "/zosmf/restjobs/jobs", {
      body: jcl,
      headers: { "content-type": "text/plain", "X-IBM-Intrdr-Class": "A", "X-IBM-Intrdr-Recfm": "F", "X-IBM-Intrdr-Lrecl": "80", "X-IBM-Intrdr-Mode": "TEXT" },
    })
    return (await response.json()) as Job
  }

  async submitDataset(dataset: string, member?: string): Promise<Job> {
    const response = await this.request("PUT", "/zosmf/restjobs/jobs", {
      body: JSON.stringify({ file: `//'${dataset}${member ? `(${member})` : ""}'` }),
      headers: { "content-type": "application/json" },
    })
    return (await response.json()) as Job
  }

  async spoolFiles(jobname: string, jobid: string): Promise<SpoolFile[]> {
    return (await (await this.request("GET", `/zosmf/restjobs/jobs/${encodeURIComponent(jobname)}/${encodeURIComponent(jobid)}/files`)).json()) as SpoolFile[]
  }

  async spoolContent(jobname: string, jobid: string, id: number) {
    return this.text(await this.request("GET", `/zosmf/restjobs/jobs/${encodeURIComponent(jobname)}/${encodeURIComponent(jobid)}/files/${id}/records`))
  }
}
