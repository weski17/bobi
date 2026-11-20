import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { assertWebUrl, BrowserError, format, HeadlessBrowser, isPrivateAddress, mayLoad, resolvesPrivate } from "../src/index.ts"

let server: ReturnType<typeof Bun.serve>
let base: string
const browser = new HeadlessBrowser()

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === "/redirect-file") return Response.redirect("file:///etc/passwd", 302)
      // Same server under another private name: stands in for an intranet host the user did not approve.
      if (pathname === "/redirect-internal") return Response.redirect(`http://localhost:${server.port}/internal`, 302)
      if (pathname === "/internal") return new Response("<body>INTERNAL-ADMIN-PAGE</body>", { headers: { "content-type": "text/html" } })
      if (pathname === "/fetch-internal")
        return new Response(
          `<body><div id="r">pending</div><script>fetch("http://localhost:${server.port}/internal").then(r => r.text()).then(t => r.textContent = t, () => r.textContent = "blocked")</script></body>`,
          { headers: { "content-type": "text/html" } },
        )
      if (pathname === "/long") return new Response(`<body>${"a".repeat(500)}</body>`, { headers: { "content-type": "text/html" } })
      return new Response(
        `<html><head><title>Status page</title></head><body><p>static text</p><div id="x"></div>
         <script>document.getElementById("x").textContent = "rendered by javascript"</script></body></html>`,
        { headers: { "content-type": "text/html" } },
      )
    },
  })
  base = `http://127.0.0.1:${server.port}`
})
afterAll(async () => {
  await browser.close()
  server.stop(true)
})

describe("assertWebUrl", () => {
  test("accepts http and https", () => {
    expect(assertWebUrl("https://example.com/a").hostname).toBe("example.com")
    expect(assertWebUrl("http://127.0.0.1:8080").port).toBe("8080")
  })
  test.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://x", "not a url", "https://user:pw@example.com"])("rejects %s", (url) => {
    expect(() => assertWebUrl(url)).toThrow(BrowserError)
  })
})

describe("HeadlessBrowser", () => {
  test("returns title and visible text including JavaScript-rendered content", async () => {
    const page = await browser.open(`${base}/`)
    expect(page.title).toBe("Status page")
    expect(page.text).toContain("static text")
    expect(page.text).toContain("rendered by javascript")
    expect(page.truncated).toBe(false)
  }, 30_000)

  test("truncates long pages", async () => {
    const page = await browser.open(`${base}/long`, { maxChars: 100 })
    expect(page.text).toHaveLength(100)
    expect(page.truncated).toBe(true)
    expect(format(page)).toEndWith("[truncated]")
  }, 30_000)

  test("does not follow redirects to non-web schemes", async () => {
    await expect(browser.open(`${base}/redirect-file`)).rejects.toThrow()
  }, 30_000)

  test("a redirect or a script cannot reach a private host the user did not approve (review 2026-11-19, M5)", async () => {
    await expect(browser.open(`${base}/redirect-internal`)).rejects.toThrow()
    const page = await browser.open(`${base}/fetch-internal`)
    await new Promise((r) => setTimeout(r, 300))
    expect(page.text).not.toContain("INTERNAL-ADMIN-PAGE")
  }, 30_000)

  test("rejects non-web URLs before launching anything", async () => {
    await expect(new HeadlessBrowser().open("file:///etc/passwd")).rejects.toThrow(BrowserError)
  })

  test("close is idempotent", async () => {
    const b = new HeadlessBrowser()
    await b.close()
    await b.close()
  })
})

test("format renders untitled pages", () => {
  expect(format({ url: "http://x", title: "", text: "t", truncated: false })).toBe("# (untitled)\nURL: http://x\n\nt")
})

test("reports a missing Chromium installation clearly and can retry", async () => {
  const b = new HeadlessBrowser({ executablePath: "/nonexistent/chromium" })
  await expect(b.open(`${base}/`)).rejects.toThrow(/Cannot start Chromium/)
  await expect(b.open(`${base}/`)).rejects.toThrow(/Cannot start Chromium/)
  await b.close()
}, 30_000)

describe("private addresses", () => {
  test("loopback, private, link-local, CGNAT and their IPv6 forms are private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "[::1]"])
      expect(isPrivateAddress(ip)).toBe(true)
    for (const ip of ["8.8.8.8", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2001:4860:4860::8888", "example.com"]) expect(isPrivateAddress(ip)).toBe(false)
  })

  test("localhost names count as private", async () => {
    expect(await resolvesPrivate("localhost")).toBe(true)
    expect(await resolvesPrivate("app.localhost")).toBe(true)
    expect(await resolvesPrivate("127.0.0.1")).toBe(true)
  })

  test("after a public page nothing private loads; after a private page only that host", () => {
    expect(mayLoad("docs.example", false, "cdn.example", false)).toBe(true)
    expect(mayLoad("docs.example", false, "169.254.169.254", true)).toBe(false)
    expect(mayLoad("docs.example", false, "docs.example", true)).toBe(false) // DNS rebinding of the approved name
    expect(mayLoad("localhost", true, "localhost", true)).toBe(true)
    expect(mayLoad("localhost", true, "10.0.0.5", true)).toBe(false)
  })
})
