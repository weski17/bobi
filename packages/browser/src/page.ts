// Headless browser access for the agent (requirement 4). Playwright is loaded lazily so that
// Bobi starts without a browser installed; only http(s) pages are allowed.
import type { Browser } from "playwright-core"
import { mayLoad, resolvesPrivate } from "./address.ts"

export type PageResult = { url: string; title: string; text: string; truncated: boolean }

export type PageOptions = { timeoutMs?: number; maxChars?: number }

export class BrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserError"
  }
}

export function assertWebUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BrowserError(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BrowserError(`Only http and https URLs are allowed, got ${url.protocol}`)
  if (url.username || url.password) throw new BrowserError("URLs with embedded credentials are not allowed")
  return url
}

export type BrowserOptions = {
  /** Use a preinstalled Chromium (e.g. in the container image) instead of Playwright's download. */
  readonly executablePath?: string
}

export class HeadlessBrowser {
  private browser: Promise<Browser> | undefined

  constructor(private readonly options: BrowserOptions = {}) {}

  private launch(): Promise<Browser> {
    this.browser ??= import("playwright-core").then(({ chromium }) =>
      chromium.launch({ headless: true, ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}) }).catch((error: Error) => {
        this.browser = undefined
        throw new BrowserError(`Cannot start Chromium. Install it with "bun run browser:install". ${error.message.split("\n")[0]}`)
      }),
    )
    return this.browser
  }

  async open(raw: string, options: PageOptions = {}): Promise<PageResult> {
    const url = assertWebUrl(raw)
    const browser = await this.launch()
    // A fresh context per call: no cookies, storage or credentials carried between pages.
    const context = await browser.newContext({ javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block" })
    try {
      const page = await context.newPage()
      // Block navigation (including redirects) to non-web schemes, and requests to private addresses the user did not
      // approve: a redirect or a script on an approved public page must not reach the intranet or cloud metadata
      // (security review 2026-11-19, M5).
      const approvedPrivate = await resolvesPrivate(url.hostname)
      const permitted = async (raw: string) => {
        const target = new URL(raw)
        if (target.protocol !== "http:" && target.protocol !== "https:") return false
        return mayLoad(url.hostname, approvedPrivate, target.hostname, await resolvesPrivate(target.hostname))
      }
      await page.route("**/*", async (route) => ((await permitted(route.request().url())) ? route.continue() : route.abort("blockedbyclient")))
      // Redirect hops bypass page.route (the network stack follows them), so every request is checked as well; one
      // that should not have been loaded means the page's content is not returned.
      const checks: Promise<string | undefined>[] = []
      page.on("request", (request) => {
        if (request.redirectedFrom()) checks.push(permitted(request.url()).then((ok) => (ok ? undefined : request.url())))
      })
      await page.goto(url.href, { timeout: options.timeoutMs ?? 15_000, waitUntil: "domcontentloaded" })
      const title = await page.title()
      const body = await page.evaluate(() => document.body?.innerText ?? "")
      // Checked after reading the page, so a redirect that happened while it loaded is caught too. The request itself
      // has been made by then (a limit: a GET with side effects on an intranet page cannot be undone).
      const refused = (await Promise.all(checks)).find(Boolean) ?? ((await permitted(page.url())) ? undefined : page.url())
      if (refused) throw new BrowserError(`The page redirected to ${new URL(refused).origin}, a private address that was not approved. Open that address directly if it is intended.`)
      const max = options.maxChars ?? 20_000
      return { url: page.url(), title, text: body.slice(0, max), truncated: body.length > max }
    } finally {
      await context.close()
    }
  }

  async close() {
    const browser = this.browser
    this.browser = undefined
    if (browser) await (await browser).close()
  }
}
