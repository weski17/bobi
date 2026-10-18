import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { assertWebUrl, BrowserError, format, HeadlessBrowser } from "../src/index.ts"

let server: ReturnType<typeof Bun.serve>
let base: string
const browser = new HeadlessBrowser()

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === "/redirect-file") return Response.redirect("file:///etc/passwd", 302)
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
