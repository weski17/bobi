import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { allowed, parseAllowlist, parseRule, parseTarget, startProxy, type Decision, type RunningProxy } from "../src/index.ts"

describe("allowlist", () => {
  test("parses entries, comments and default port", () => {
    expect(parseAllowlist("# gateway\nhost.containers.internal:4000\n*.intranet.example, git.example.com")).toEqual([
      { host: "host.containers.internal", wildcard: false, port: 4000 },
      { host: "intranet.example", wildcard: true, port: 443 },
      { host: "git.example.com", wildcard: false, port: 443 },
    ])
  })

  test.each(["", "http://x", "a b", "host:0", "host:99999", "*.:443"])("rejects %p", (entry) => {
    expect(() => parseRule(entry)).toThrow(/invalid/)
  })

  test("matches host and port exactly, wildcards only on subdomains", () => {
    const rules = parseAllowlist("api.example.com:443,*.corp.example:443")
    expect(allowed({ host: "api.example.com", port: 443 }, rules)).toBe(true)
    expect(allowed({ host: "API.example.com.", port: 443 }, rules)).toBe(true)
    expect(allowed({ host: "api.example.com", port: 80 }, rules)).toBe(false)
    expect(allowed({ host: "evil-api.example.com", port: 443 }, rules)).toBe(false)
    expect(allowed({ host: "a.corp.example", port: 443 }, rules)).toBe(true)
    expect(allowed({ host: "corp.example", port: 443 }, rules)).toBe(false)
    expect(allowed({ host: "corp.example.evil.com", port: 443 }, rules)).toBe(false)
  })

  test("parses CONNECT authorities", () => {
    expect(parseTarget("example.com:8443", 443)).toEqual({ host: "example.com", port: 8443 })
    expect(parseTarget("example.com", 443)).toEqual({ host: "example.com", port: 443 })
    expect(parseTarget("[::1]:4000", 443)).toEqual({ host: "[::1]", port: 4000 })
    expect(parseTarget("bad host", 443)).toBeUndefined()
  })
})

describe("proxy", () => {
  let origin: ReturnType<typeof Bun.serve>
  let proxy: RunningProxy
  const decisions: Decision[] = []

  beforeAll(() => {
    origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => new Response(`origin saw ${new URL(r.url).pathname}`) })
    proxy = startProxy({ rules: parseAllowlist(`127.0.0.1:${origin.port}`), log: (d) => void decisions.push(d) })
  })
  afterAll(() => {
    proxy.stop()
    origin.stop(true)
  })

  test("forwards plain HTTP to allowed targets", async () => {
    const res = await fetch(`http://127.0.0.1:${origin.port}/hello?x=1`, { proxy: proxy.url })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("origin saw /hello")
    expect(decisions.at(-1)).toMatchObject({ method: "GET", target: `127.0.0.1:${origin.port}`, allowed: true })
  })

  test("blocks targets that are not on the allowlist", async () => {
    const res = await fetch("http://example.com/", { proxy: proxy.url })
    expect(res.status).toBe(403)
    expect(decisions.at(-1)).toMatchObject({ target: "example.com:80", allowed: false })
  })

  test("tunnels CONNECT to allowed targets and refuses others", async () => {
    const connect = (authority: string) =>
      new Promise<string>((resolve) => {
        let text = ""
        void Bun.connect({
          hostname: "127.0.0.1",
          port: proxy.port,
          socket: {
            open: (s) => void s.write(`CONNECT ${authority} HTTP/1.1\r\nhost: ${authority}\r\n\r\n`),
            data: (s, d) => {
              text += d.toString()
              if (text.includes("\r\n\r\n")) {
                if (text.startsWith("HTTP/1.1 200")) s.write(`GET /tunnel HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n`)
                else s.end()
              }
            },
            close: () => resolve(text),
          },
        })
      })
    const ok = await connect(`127.0.0.1:${origin.port}`)
    expect(ok).toStartWith("HTTP/1.1 200 Connection Established")
    expect(ok).toContain("origin saw /tunnel")
    expect(await connect("example.com:443")).toStartWith("HTTP/1.1 403")
  })

  test("rejects malformed requests", async () => {
    const res = await new Promise<string>((resolve) => {
      let text = ""
      void Bun.connect({
        hostname: "127.0.0.1",
        port: proxy.port,
        socket: {
          open: (s) => void s.write("GET /relative HTTP/1.1\r\nhost: x\r\n\r\n"),
          data: (_s, d) => void (text += d.toString()),
          close: () => resolve(text),
        },
      })
    })
    expect(res).toStartWith("HTTP/1.1 400")
  })

  test("refuses oversized request headers", async () => {
    const res = await new Promise<string>((resolve) => {
      let text = ""
      void Bun.connect({
        hostname: "127.0.0.1",
        port: proxy.port,
        socket: {
          open: (s) => void s.write(`GET http://x/ HTTP/1.1\r\nx: ${"a".repeat(70 * 1024)}`),
          data: (_s, d) => void (text += d.toString()),
          close: () => resolve(text),
        },
      })
    })
    expect(res).toStartWith("HTTP/1.1 431")
  })

  test("reports unreachable allowed targets as 502", async () => {
    const closed = startProxy({ rules: parseAllowlist("127.0.0.1:1"), log: () => {} })
    try {
      const res = await fetch("http://127.0.0.1:1/", { proxy: closed.url })
      expect(res.status).toBe(502)
    } finally {
      closed.stop()
    }
  })
})
