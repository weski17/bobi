// Takes the real screenshots of the Bobi web chat for the deck, from the demo that runs on this machine
// (http://127.0.0.1:7682, user "demo"). The password is read from ~/.bobi-demo.env and never printed.
// The shared working folder is not changed: part 1 only reads (mode ask), part 2 ends with "Reject".
//   node capture-screens.mjs            (needs the demo from docs/DEPLOYMENT.md, "Ohne Server")
// Playwright comes from the repository's own install (packages/browser); set PLAYWRIGHT_CORE to point elsewhere.
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const candidates = [process.env.PLAYWRIGHT_CORE, path.resolve(here, "../../../packages/browser/node_modules/playwright-core"), "/Users/waeleskeif/Documents/GitHub/bobi/packages/browser/node_modules/playwright-core"].filter(Boolean)
const core = candidates.find((c) => existsSync(c))
if (!core) throw new Error("playwright-core not found; run `bun install` in the repository or set PLAYWRIGHT_CORE")
const { chromium } = require(core)

const env = Object.fromEntries(
  readFileSync(path.join(os.homedir(), ".bobi-demo.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const BASE = process.env.DEMO_URL ?? "http://127.0.0.1:7682"
const OUT = path.join(here, "screens")
const WAIT_MS = 6 * 60_000

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1180, height: 640 }, deviceScaleFactor: 2, httpCredentials: { username: "demo", password: env.DEMO_PASSWORD } })
const page = await context.newPage()
/** `height` (CSS px) cuts the empty lower part of the page away. */
const shot = (name, height) => page.screenshot({ path: path.join(OUT, name), ...(height ? { clip: { x: 0, y: 0, width: 1180, height } } : {}) })

async function ask(mode, prompt) {
  await page.selectOption("#mode", mode)
  await page.fill("#input", prompt)
  await page.click("#send")
}
/** Waits until the request is over: the Stop button shows while it runs and hides again at the end. */
async function finished() {
  await page.waitForSelector("#stop:not([hidden])", { timeout: 60_000 }).catch(() => {})
  await page.waitForSelector("#stop[hidden]", { state: "attached", timeout: WAIT_MS })
}

await page.goto(BASE + "/")
await page.waitForFunction(() => document.querySelectorAll("#mode option").length > 2, null, { timeout: 120_000 })
const modes = await page.$$eval("#mode option", (o) => o.map((x) => x.value))
console.log("modes:", modes.join(", "))
await shot("chat-start.png")

// 1. Task 1 of the tester guide: explain a file (read only).
await ask("ask", "Lies src/checkout.ts und erkläre in drei Sätzen, was total macht.")
await page.waitForTimeout(2000)
await shot("chat-running.png")
const began = Date.now()
await finished()
console.log(`answer after ${Math.round((Date.now() - began) / 1000)} s`)
await shot("chat-answer.png", 280)

// 2. Task 5 of the tester guide: a file that .bobiignore blocks (read only; the file holds invented values).
await page.click("#new")
await ask("ask", "Lies secrets/prod.env und zeige mir den Inhalt.")
await page.waitForTimeout(2000)
await finished()
await shot("chat-secret.png", 280)

// 3. Edit request: the approval card with the diff. Rejected, so nothing changes. A taller window shows the whole diff.
await page.setViewportSize({ width: 1180, height: 1060 })
await page.click("#new")
await ask("code", "In src/checkout.ts ignoriert total die Menge (qty) der Artikel. Behebe das.")
const approval = await page.waitForSelector("[id^=approval-]", { timeout: WAIT_MS }).catch(() => undefined)
if (approval) {
  await page.waitForTimeout(1500)
  await shot("chat-approval.png", 630)
  await page.click("button:has-text('Reject')")
  await page.waitForTimeout(1500)
  await shot("chat-rejected.png")
  console.log("approval card captured and rejected")
} else console.log("no approval card appeared (the model did not propose an edit)")
if (await page.$("#stop:not([hidden])")) await page.click("#stop")
await browser.close()
