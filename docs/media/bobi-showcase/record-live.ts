#!/usr/bin/env bun
// Records the live-demo clips of the showcase video from the REAL web chat (local demo, real bundled model).
// The page is driven like a person would: pick a mode, type, send, read the answer, accept a diff, undo.
// Frames are taken while something happens; the model's waiting time is cut, and the cut is shown in the clip
// ("Wartezeit gekürzt: N s"), so nothing is faked. Output: .work/live/<clip>.mp4 (1344×756, 30 fps).
//   bun docs/media/bobi-showcase/record-live.ts [ask|fix|secret ...]     (default: all)
//   BOBI_DEMO_URL (default http://127.0.0.1:7682), BOBI_DEMO_ENV (default ~/.bobi-demo.env, holds DEMO_PASSWORD)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { chromium, type Page } from "../../../packages/browser/node_modules/playwright-core/index.js"

const DIR = import.meta.dir
const OUT = path.join(DIR, ".work", "live")
const URL_ = process.env.BOBI_DEMO_URL ?? "http://127.0.0.1:7682"
const envFile = process.env.BOBI_DEMO_ENV ?? path.join(homedir(), ".bobi-demo.env")
const password = /^DEMO_PASSWORD=(.+)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim()
if (!password) throw new Error(`no DEMO_PASSWORD in ${envFile}`)
const W = 1344
const H = 756
const ZOOM = 1.3

type Frame = { file: string; dur: number }

class Clip {
  readonly frames: Frame[] = []
  private n = 0
  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    rmSync(path.join(OUT, name), { recursive: true, force: true })
    mkdirSync(path.join(OUT, name), { recursive: true })
  }

  async shot(dur: number) {
    const file = path.join(OUT, this.name, `${String(this.n++).padStart(5, "0")}.jpg`)
    await this.page.screenshot({ path: file, type: "jpeg", quality: 92 })
    this.frames.push({ file, dur })
  }

  /** Holds the current picture for `seconds`. */
  async hold(seconds: number) {
    await this.shot(seconds)
  }

  /** Types like a person (about 25 characters per second on screen). */
  async type(selector: string, text: string) {
    await this.page.click(selector)
    for (let i = 0; i < text.length; i += 2) {
      await this.page.keyboard.type(text.slice(i, i + 2))
      await this.shot(0.08)
    }
  }

  /** Marks a button like a pointer press, then clicks it. */
  async press(locator: ReturnType<Page["locator"]>) {
    await locator.evaluate((el: HTMLElement) => {
      el.style.outline = "4px solid #5eead4"
      el.style.outlineOffset = "3px"
    })
    await this.shot(0.7)
    await locator.click()
    await this.shot(0.3)
  }

  /**
   * Waits for `ready` without recording; afterwards shows a badge with the real waiting time for a moment.
   * Nothing on the page changes during the cut except the model working.
   */
  async cut(ready: () => Promise<boolean>, maxSeconds = 600) {
    await this.shot(0.8)
    const began = Date.now()
    while (!(await ready())) {
      if (Date.now() - began > maxSeconds * 1000) throw new Error(`${this.name}: waited longer than ${maxSeconds} s`)
      await Bun.sleep(250)
    }
    const seconds = Math.round((Date.now() - began) / 1000)
    if (seconds >= 3) {
      await badge(this.page, `⏩ Wartezeit gekürzt: ${seconds} s (Modell auf der CPU)`)
      await this.shot(1.6)
      await badge(this.page, undefined)
    }
    return seconds
  }

  /** Records at about 8 pictures per second (played a bit faster) until `done`. */
  async stream(done: () => Promise<boolean>, maxSeconds = 300) {
    const began = Date.now()
    while (!(await done())) {
      if (Date.now() - began > maxSeconds * 1000) throw new Error(`${this.name}: answer did not finish`)
      await this.shot(0.09)
      await Bun.sleep(40)
    }
    await this.shot(0.4)
  }

  /** Writes the clip as H.264, 30 fps. */
  encode(): string {
    const list = path.join(OUT, `${this.name}.txt`)
    const last = this.frames[this.frames.length - 1]!
    writeFileSync(list, [...this.frames.map((f) => `file '${f.file}'\nduration ${f.dur.toFixed(3)}`), `file '${last.file}'`].join("\n"))
    const out = path.join(OUT, `${this.name}.mp4`)
    const r = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", out], { stderr: "pipe" })
    if (r.exitCode !== 0) throw new Error(`ffmpeg: ${r.stderr.toString().slice(-400)}`)
    return out
  }
}

async function badge(page: Page, text: string | undefined) {
  await page.evaluate((t) => {
    document.getElementById("bobi-cut")?.remove()
    if (!t) return
    const b = document.createElement("div")
    b.id = "bobi-cut"
    b.textContent = t
    Object.assign(b.style, { position: "fixed", left: "50%", top: "42%", transform: "translateX(-50%)", zIndex: "9999", padding: "12px 22px", borderRadius: "12px", font: "700 19px system-ui", color: "#0a0f1e", background: "#fbbf24", boxShadow: "0 8px 24px rgba(0,0,0,.45)" })
    document.body.appendChild(b)
  }, text)
}

const idle = (page: Page) => () => page.evaluate(() => !(document.getElementById("send") as HTMLButtonElement).disabled)
const answered = (page: Page, before: number) => () => page.evaluate((n) => document.querySelectorAll(".msg.bobi").length > n && (document.querySelector(".msg.bobi:last-of-type")?.textContent ?? "").length > 0, before)
const count = (page: Page, selector: string) => page.evaluate((s) => document.querySelectorAll(s).length, selector)

/** Title of the newest approval card that still has buttons ("Bobi wants to edit: …"), if any. */
const openApproval = (page: Page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll(".approval")].filter((c) => c.querySelector(".buttons button"))
    return cards.length ? (cards[cards.length - 1]!.querySelector(".title")?.textContent ?? "") : undefined
  })
/** The request has run and finished (the send button is usable again after having been disabled). */
const idleAfterStart = async (page: Page) => (await count(page, ".msg.bobi, .tool")) > 0 && (await idle(page)())

async function fresh(page: Page, mode: string) {
  await page.click("#new")
  await page.waitForTimeout(400)
  await page.selectOption("#mode", mode)
  await page.waitForTimeout(400)
}

/** Prompt → (cut) → streamed answer. */
async function askAndRead(clip: Clip, prompt: string) {
  const { page } = clip
  const before = await count(page, ".msg.bobi")
  await clip.type("#input", prompt)
  await clip.hold(0.5)
  await page.keyboard.press("Enter")
  await clip.cut(answered(page, before))
  await clip.stream(idle(page))
}

const CLIPS: Record<string, (clip: Clip) => Promise<void>> = {
  /** Task 1 of the tester guide: explain a function, read-only mode. */
  ask: async (clip) => {
    await fresh(clip.page, "ask")
    await clip.hold(1.2)
    await askAndRead(clip, "Lies src/checkout.ts und erkläre in zwei Sätzen, was total macht.")
    await clip.hold(2.5)
  },
  /**
   * Task 2 and 3: a real bug fix shown as a diff, accepted, then undone. Only a file edit is accepted; anything else the
   * model asks for (a shell command, for example) is rejected on screen. Without an accepted edit the clip fails.
   */
  fix: async (clip) => {
    const { page } = clip
    await fresh(page, "code")
    await clip.hold(1.0)
    await clip.type("#input", "Ändere src/checkout.ts direkt: In total soll priceCents mit qty multipliziert werden.")
    await clip.hold(0.5)
    await page.keyboard.press("Enter")
    let edited = false
    for (let round = 0; round < 6; round++) {
      await clip.cut(async () => (await openApproval(page)) !== undefined || ((await idle(page)()) && round > 0) || (await idleAfterStart(page)))
      const title = await openApproval(page)
      if (title === undefined) break
      const card = page.locator(".approval", { has: page.locator(".buttons button") }).last()
      if (/\bedit\b/.test(title)) {
        await card.scrollIntoViewIfNeeded()
        await clip.hold(4)
        await clip.press(card.locator("button", { hasText: "Accept" }))
        edited = true
      } else {
        await clip.hold(1.5)
        await clip.press(card.locator("button", { hasText: "Reject" }))
      }
    }
    await clip.cut(idle(page))
    if (!edited) throw new Error("fix: the model did not propose a file edit; record again")
    await clip.hold(2.5)
    await clip.press(page.locator("#undo"))
    await clip.cut(async () => (await count(page, ".info")) > 0, 60)
    await clip.hold(3)
  },
  /** Task 5: a file listed in .bobiignore is refused. */
  secret: async (clip) => {
    await fresh(clip.page, "ask")
    await clip.hold(1.0)
    // Asks for the read tool explicitly, so the refusal shown is Bobi's (.bobiignore), not a guess of the model.
    await askAndRead(clip, "Benutze das read-Werkzeug für secrets/prod.env und zeige mir den Inhalt.")
    await clip.hold(3)
  },
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS)
const browser = await chromium.launch()
try {
  for (const name of wanted) {
    const record = CLIPS[name]
    if (!record) throw new Error(`unknown clip ${name}; known: ${Object.keys(CLIPS).join(", ")}`)
    // Larger text without changing the layout: a smaller viewport at 1.3× pixel density gives a 1344×756 picture.
    const context = await browser.newContext({ viewport: { width: Math.round(W / ZOOM), height: Math.round(H / ZOOM) }, deviceScaleFactor: ZOOM, httpCredentials: { username: "demo", password } })
    const page = await context.newPage()
    await page.goto(URL_)
    await page.waitForFunction(() => (document.getElementById("mode") as HTMLSelectElement).options.length > 0, undefined, { timeout: 60_000 })
    const clip = new Clip(page, name)
    await record(clip)
    console.error(`${name}: ${clip.frames.length} frames, ${clip.frames.reduce((s, f) => s + f.dur, 0).toFixed(1)} s → ${clip.encode()}`)
    writeFileSync(path.join(OUT, `${name}.log.txt`), (await page.locator("#log").innerText()).slice(0, 4000))
    await context.close()
  }
} finally {
  await browser.close()
}
