// Headless browser access for the agent (requirement 4). Playwright is loaded lazily so that
// Bobi starts without a browser installed; only http(s) pages are allowed.
import type { Browser } from "playwright-core"

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
      // Block navigation (including redirects) to non-web schemes.
      await page.route("**/*", (route) => {
        const target = new URL(route.request().url())
        return target.protocol === "http:" || target.protocol === "https:" ? route.continue() : route.abort()
      })
      await page.goto(url.href, { timeout: options.timeoutMs ?? 15_000, waitUntil: "domcontentloaded" })
      const title = await page.title()
      const body = await page.evaluate(() => document.body?.innerText ?? "")
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
