// Renders the README banner and the GitHub social preview image from one description.
//   bun docs/media/banner/make.ts
// Output: banner.png (1600x420 at 2x, for the README) and social-preview.png (1280x640, upload under
// Settings > General > Social preview). Chromium comes from the repository's Playwright (packages/browser).
// The picture: Bobi's mark and name on the left; on the right the one promise of the product, drawn as a boundary
// with Bobi's parts inside and lines from outside that stop in front of it.
import { existsSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const candidates = [process.env.PLAYWRIGHT_CORE, path.resolve(here, "../../../packages/browser/node_modules/playwright-core"), "/Users/waeleskeif/Documents/GitHub/bobi/packages/browser/node_modules/playwright-core"].filter(Boolean)
const core = candidates.find((c) => existsSync(c))
if (!core) throw new Error("playwright-core not found; run `bun install` in the repository or set PLAYWRIGHT_CORE")
const { chromium } = require(core)

// Colours of branding/default/icon.svg, on a light background.
const C = { paper: "#F5F8FC", dots: "#E1E9F3", navy: "#1F3A5F", cyan: "#5BC0EB", ink: "#14233A", muted: "#5B6B82", stub: "#A9B8CC", white: "#FFFFFF" }
const DISPLAY = `Futura, "Avenir Next", "Century Gothic", sans-serif`
const TEXT = `"Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif`

/** The product mark (same drawing as branding/default/icon.svg), size px at (x, y). */
const mark = (x: number, y: number, size: number) => `
  <g transform="translate(${x} ${y}) scale(${size / 896}) translate(-64 -64)">
    <rect x="64" y="64" width="896" height="896" rx="200" fill="${C.navy}"/>
    <circle cx="512" cy="560" r="230" fill="none" stroke="#FFF" stroke-width="96"/>
    <rect x="282" y="200" width="96" height="590" rx="48" fill="#FFF"/>
    <circle cx="742" cy="270" r="62" fill="${C.cyan}"/>
  </g>`

const node = (cx: number, cy: number, label: string) => `
  <rect x="${cx - 52}" y="${cy - 19}" width="104" height="38" rx="19" fill="${C.white}" stroke="${C.navy}" stroke-width="2.5"/>
  <text x="${cx}" y="${cy + 5.5}" text-anchor="middle" font-family='${TEXT}' font-size="16" font-weight="600" fill="${C.ink}">${label}</text>`

/** The boundary: 532 x 250 (before scale) at (x, y). Lines from outside stop short of it; everything inside is connected. */
const boundary = (x: number, y: number, scale = 1) => {
  const core = { x: 180, y: 135 }
  const parts = [
    { x: 78, y: 78, label: "Bobi IDE" },
    { x: 78, y: 192, label: "Bobi Shell" },
    { x: 312, y: 135, label: "Your model" },
  ]
  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <rect x="2" y="2" width="392" height="246" rx="34" fill="${C.white}" stroke="${C.navy}" stroke-width="4"/>
    <text x="30" y="40" font-family='${TEXT}' font-size="17" font-weight="500" fill="${C.muted}">Your network</text>
    ${parts.map((p) => `<line x1="${core.x}" y1="${core.y}" x2="${p.x}" y2="${p.y}" stroke="${C.cyan}" stroke-width="4" stroke-linecap="round"/>`).join("")}
    ${parts.map((p) => node(p.x, p.y, p.label)).join("")}
    ${mark(core.x - 30, core.y - 30, 60)}
    ${[70, 125, 180].map((ly) => `
      <line x1="530" y1="${ly}" x2="436" y2="${ly}" stroke="${C.stub}" stroke-width="4" stroke-linecap="round"/>
      <line x1="422" y1="${ly - 13}" x2="422" y2="${ly + 13}" stroke="${C.stub}" stroke-width="4" stroke-linecap="round"/>`).join("")}
    <text x="530" y="42" text-anchor="end" font-family='${TEXT}' font-size="17" font-weight="500" fill="${C.muted}">Cloud: none</text>
  </g>`
}

const frame = (w: number, h: number, body: string) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:${C.paper}}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="${C.dots}"/></pattern></defs>
  <rect width="${w}" height="${h}" fill="${C.paper}"/><rect width="${w}" height="${h}" fill="url(#dots)"/>
  ${body}
</svg>`

const word = (x: number, y: number, size: number) => `<text x="${x}" y="${y}" font-family='${DISPLAY}' font-size="${size}" font-weight="700" letter-spacing="-3" fill="${C.navy}">Bobi</text>`
const line = (x: number, y: number, size: number, weight: number, fill: string, s: string) => `<text x="${x}" y="${y}" font-family='${TEXT}' font-size="${size}" font-weight="${weight}" fill="${fill}">${s}</text>`

const wide = frame(
  1600,
  420,
  `${mark(96, 82, 150)}${word(278, 198, 150)}
   ${line(96, 300, 36, 600, C.ink, "Your AI development partner.")}
   ${line(96, 346, 24, 400, C.muted, "Entirely on-premise. Your models, your network.")}
   ${boundary(862, 60, 1.2)}`,
)

const social = frame(
  1280,
  640,
  `${mark(80, 92, 140)}${word(250, 200, 140)}
   ${line(80, 318, 42, 600, C.ink, "Your AI development partner.")}
   ${line(80, 368, 26, 400, C.muted, "Entirely on-premise. Your models, your network.")}
   ${boundary(690, 240, 0.95)}
   ${line(80, 568, 24, 500, C.muted, "github.com/weski17/bobi")}`,
)

const browser = await chromium.launch()
const shoot = async (html: string, w: number, h: number, scale: number, file: string) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(here, file) })
  await page.close()
}
await shoot(wide, 1600, 420, 2, "banner.png")
await shoot(social, 1280, 640, 1, "social-preview.png")
await browser.close()
console.log("banner.png and social-preview.png written to", here)
