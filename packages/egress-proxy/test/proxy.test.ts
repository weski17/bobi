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

/** Sends raw bytes to the proxy and collects the answer until it closes the connection or `waitMs` pass. */
async function rawRequest(port: number, text: string, waitMs = 1500) {
  let received = ""
  let closed = false
  const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data: (_s, d) => void (received += d.toString()), close: () => void (closed = true) } })
  if (text) socket.write(text)
  const until = Date.now() + waitMs
  while (!closed && Date.now() < until) await Bun.sleep(25)
  socket.end()
  return { received, closed }
}

describe("proxy hardening (review 2026-11-19, M6)", () => {
  let origin: ReturnType<typeof Bun.serve>
  beforeAll(() => {
    origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => new Response(`host=${r.headers.get("host")}`) })
  })
  afterAll(() => origin.stop(true))

  test("a wildcard rule never reaches a private address; an exact rule may", async () => {
    const proxy = startProxy({
      rules: parseAllowlist(`*.example.test:${origin.port}, gateway.test:${origin.port}`),
      resolve: async () => ["127.0.0.1"],
      log: () => {},
    })
    try {
      expect((await fetch(`http://evil.example.test:${origin.port}/`, { proxy: proxy.url })).status).toBe(403)
      const res = await fetch(`http://gateway.test:${origin.port}/`, { proxy: proxy.url })
      expect(res.status).toBe(200)
    } finally {
      proxy.stop()
    }
  })

  test("the Host header is the checked target, not what the client sends", async () => {
    const proxy = startProxy({ rules: parseAllowlist(`127.0.0.1:${origin.port}`), log: () => {} })
    try {
      const { received } = await rawRequest(proxy.port, `GET http://127.0.0.1:${origin.port}/ HTTP/1.1\r\nHost: admin.internal\r\n\r\n`)
      expect(received).toContain(`host=127.0.0.1:${origin.port}`)
      expect(received).not.toContain("admin.internal")
    } finally {
      proxy.stop()
    }
  })

})

describe("proxy limits (review 2026-11-19, M6)", () => {
  test("host names with other characters are refused", async () => {
    const proxy = startProxy({ rules: parseAllowlist(`*.example.test:443`), resolve: async () => ["203.0.113.1"], log: () => {} })
    try {
      const { received } = await rawRequest(proxy.port, "CONNECT 127.0.0.1\u0000.example.test:443 HTTP/1.1\r\n\r\n")
      expect(received).toContain("403")
    } finally {
      proxy.stop()
    }
  })

  test("a client that never finishes its request head is disconnected", async () => {
    const proxy = startProxy({ rules: [], headerTimeoutSeconds: 1, log: () => {} })
    try {
      const { closed } = await rawRequest(proxy.port, "GET http://x/ HTTP/1.1\r\n", 3000)
      expect(closed).toBe(true)
    } finally {
      proxy.stop()
    }
  })

  test("connections beyond the limit get 503", async () => {
    const proxy = startProxy({ rules: [], maxConnections: 1, log: () => {} })
    try {
      const first = await Bun.connect({ hostname: "127.0.0.1", port: proxy.port, socket: { data: () => {} } })
      const { received } = await rawRequest(proxy.port, "")
      expect(received).toContain("503")
      first.end()
    } finally {
      proxy.stop()
    }
  })
})

describe("proxy resolution and idle tunnels (review 2026-11-19, M6)", () => {
  let origin: ReturnType<typeof Bun.serve>
  beforeAll(() => {
    origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") })
  })
  afterAll(() => origin.stop(true))

  test("an exact rule is resolved with the system resolver; an unknown name is refused", async () => {
    const proxy = startProxy({ rules: parseAllowlist(`localhost:${origin.port}, nothing-here.invalid:443`), log: () => {} })
    try {
      const { received } = await rawRequest(proxy.port, `GET http://localhost:${origin.port}/ HTTP/1.1\r\nHost: localhost\r\n\r\n`)
      expect(received).toContain("200")
      expect((await rawRequest(proxy.port, "CONNECT nothing-here.invalid:443 HTTP/1.1\r\n\r\n")).received).toContain("403")
    } finally {
      proxy.stop()
    }
  })

  test("an idle tunnel is closed after the idle timeout", async () => {
    const quiet = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } })
    const proxy = startProxy({ rules: parseAllowlist(`127.0.0.1:${quiet.port}`), idleTimeoutSeconds: 1, log: () => {} })
    try {
      const { received, closed } = await rawRequest(proxy.port, `CONNECT 127.0.0.1:${quiet.port} HTTP/1.1\r\n\r\n`, 4000)
      expect(received).toContain("200 Connection Established")
      expect(closed).toBe(true)
    } finally {
      proxy.stop()
      quiet.stop(true)
    }
  })
})
