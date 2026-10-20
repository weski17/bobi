#!/usr/bin/env bun
// Renders intro.html frame by frame (deterministic, 30 fps) and encodes a WebM with Playwright's ffmpeg.
//   bun docs/media/bobi-intro/record.ts [out.webm]          full video
//   bun docs/media/bobi-intro/record.ts --stills 2,6,10     PNG stills for review
import { existsSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { chromium } from "../../../packages/browser/node_modules/playwright-core/index.js"

const FPS = 30
const DURATION = 30
const page = path.join(import.meta.dir, "intro.html")
const args = process.argv.slice(2)
const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await tab.goto(`file://${page}#record`)
await tab.evaluate(() => document.fonts.ready)

if (args[0] === "--stills") {
  for (const t of args[1]!.split(",").map(Number)) {
    await tab.evaluate((time) => (window as unknown as { __seek(t: number): void }).__seek(time), t)
    await tab.screenshot({ path: path.join(import.meta.dir, `still-${String(t).padStart(4, "0")}.png`) })
  }
} else {
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright")
  const dir = readdirSync(cache).find((d) => d.startsWith("ffmpeg-"))
  const ffmpeg = [path.join(cache, dir!, "ffmpeg-mac"), path.join(cache, dir!, "ffmpeg-linux")].find((f) => existsSync(f))!
  const out = args[0] ?? path.join(import.meta.dir, "bobi-intro.webm")
  const encoder = Bun.spawn([ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0", "-c:v", "libvpx", "-b:v", "8M", "-qmin", "4", "-qmax", "30", "-deadline", "good", "-cpu-used", "2", out], { stdin: "pipe" })
  for (let frame = 0; frame < FPS * DURATION; frame++) {
    await tab.evaluate((time) => (window as unknown as { __seek(t: number): void }).__seek(time), frame / FPS)
    encoder.stdin.write(await tab.screenshot({ type: "jpeg", quality: 92 }))
    if (frame % 150 === 0) console.error(`frame ${frame}/${FPS * DURATION}`)
  }
  encoder.stdin.end()
  if ((await encoder.exited) !== 0) throw new Error("ffmpeg failed")
  console.error(`wrote ${out}`)
}
await browser.close()
