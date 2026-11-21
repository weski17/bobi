// Renders the pictures the deck needs, in the look of the feature video (docs/media/bobi-tour/tour.html): the stage
// background (two radial glows and a faint grid), the gradient logo of the intro and the gradient "Bobi" wordmark.
// Output: assets/*.png. Chromium comes from the repository's Playwright (see capture-screens.mjs).
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const candidates = [process.env.PLAYWRIGHT_CORE, path.resolve(here, "../../../packages/browser/node_modules/playwright-core"), "/Users/waeleskeif/Documents/GitHub/bobi/packages/browser/node_modules/playwright-core"].filter(Boolean)
const core = candidates.find((c) => existsSync(c))
if (!core) throw new Error("playwright-core not found; run `bun install` in the repository or set PLAYWRIGHT_CORE")
const { chromium } = require(core)

const OUT = path.join(here, "assets")
mkdirSync(OUT, { recursive: true })
const SANS = `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`

const stage = (extra = "") => `
<style>
  html,body{margin:0;background:transparent}
  #s{position:relative;width:1920px;height:1080px;overflow:hidden;background:${extra} var(--bg)}
  :root{--bg:#0a0f1e;--line:#263359}
  .grid{position:absolute;inset:0;opacity:.14;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:80px 80px}
</style>`
const GLOWS = "radial-gradient(1200px 700px at 78% 15%, #1b2550 0%, transparent 60%), radial-gradient(900px 600px at 8% 95%, #12304a 0%, transparent 60%),"
const GLOWS_TITLE = "radial-gradient(1100px 700px at 50% 30%, #243069 0%, transparent 62%), radial-gradient(900px 600px at 8% 95%, #12304a 0%, transparent 60%), radial-gradient(800px 500px at 95% 90%, #2a1f55 0%, transparent 60%),"

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 300 300">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
  <rect x="20" y="20" width="260" height="260" rx="70" fill="url(#g1)"/>
  <path d="M95 75 v150 M95 150 c0-38 30-55 58-55 c35 0 60 25 60 62 c0 38-25 63-60 63 c-28 0-58-17-58-55" stroke="#0a0f1e" stroke-width="26" fill="none" stroke-linecap="round"/>
  <circle cx="213" cy="88" r="15" fill="#0a0f1e"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

await page.setContent(`${stage(GLOWS)}<div id="s"><div class="grid"></div></div>`)
await page.locator("#s").screenshot({ path: path.join(OUT, "bg-content.png") })
await page.setContent(`${stage(GLOWS_TITLE)}<div id="s"><div class="grid"></div></div>`)
await page.locator("#s").screenshot({ path: path.join(OUT, "bg-title.png") })

await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${LOGO}`)
await page.locator("svg").screenshot({ path: path.join(OUT, "logo.png"), omitBackground: true })

await page.setContent(`<style>html,body{margin:0;background:transparent}
  #w{display:inline-block;padding:10px 30px;font:800 300px/1 ${SANS};letter-spacing:-8px;background:linear-gradient(90deg,#5eead4,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}</style><div id="w">Bobi</div>`)
await page.locator("#w").screenshot({ path: path.join(OUT, "wordmark.png"), omitBackground: true })

await browser.close()
console.log("assets written to", OUT)
