// Small layout layer for the deck: every slide is described once (rectangles, text, pictures in inches) and written twice:
// as a .pptx (pptxgenjs) and as an HTML preview (Chromium) that is used to look at the slides and to detect text overflow,
// because no PowerPoint or LibreOffice is needed or assumed. Fonts are Arial and Courier New, so widths match PowerPoint's.
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

export const W = 13.333
export const H = 7.5
const PX = 144 // 1920 px / 13.333 in: the same canvas as the video

export const C = {
  bg: "0A0F1E", panel: "151F3D", panel2: "0D1530", bar: "121C3A", line: "263359",
  text: "EEF2FF", muted: "9AA7C7", accent: "5EEAD4", accent2: "A78BFA", warn: "FBBF24", red: "F87171", green: "4ADE80", blue: "60A5FA", code: "C7D2FE",
}
export const SANS = "Arial"
export const MONO = "Courier New"

export const slides = []
let cur

export function newSlide({ bg = "content", notes = "" } = {}) {
  cur = { bg, notes, els: [] }
  slides.push(cur)
  return cur
}

export const rect = (x, y, w, h, o = {}) => cur.els.push({ k: "rect", x, y, w, h, fill: C.panel, line: C.line, lw: 1, r: 0.14, ...o })
export const ellipse = (x, y, w, h, o = {}) => cur.els.push({ k: "ellipse", x, y, w, h, fill: C.accent, ...o })
export const image = (file, x, y, w, h, alt) => cur.els.push({ k: "img", file, x, y, w, h, alt })

/**
 * Text. `paras` is a string or an array of paragraphs; a paragraph is a string or an array of runs;
 * a run is a string or { t, c(olor), b(old), i(talic), f(ont), s(ize pt) }. Paragraph options: { runs, align, after }.
 */
export function text(x, y, w, h, paras, o = {}) {
  const list = (Array.isArray(paras) ? paras : [paras]).map((p) => {
    if (typeof p === "string") return { runs: [{ t: p }] }
    if (Array.isArray(p)) return { runs: p.map((r) => (typeof r === "string" ? { t: r } : r)) }
    return { ...p, runs: p.runs.map((r) => (typeof r === "string" ? { t: r } : r)) }
  })
  cur.els.push({ k: "text", x, y, w, h, paras: list, size: 18, color: C.text, font: SANS, bold: false, align: "left", valign: "top", ls: 1.0, after: 0, ...o })
}

// ---------------------------------------------------------------------------------------------------------------------
// pptx
// ---------------------------------------------------------------------------------------------------------------------
export function loadPptx(home = process.env.DECK_HOME ?? path.join(os.homedir(), ".cache", "bobi-deck")) {
  const require = createRequire(path.join(home, "noop.js"))
  return require("pptxgenjs")
}

export async function writePptx(PptxGenJS, file, assets) {
  const pres = new PptxGenJS()
  pres.layout = "LAYOUT_WIDE"
  pres.title = "Bobi – Dein KI-Entwicklungspartner im eigenen Netz"
  pres.subject = "Vorstellung von Bobi"
  pres.author = "Bobi"
  // The backgrounds are slide layouts (one picture each), not copied into every slide.
  const layouts = { content: "BOBI_CONTENT", title: "BOBI_TITLE" }
  for (const [kind, title] of Object.entries(layouts)) pres.defineSlideMaster({ title, background: { path: path.join(assets, `bg-${kind}.png`) } })
  for (const s of slides) {
    const slide = pres.addSlide({ masterName: layouts[s.bg] })
    for (const e of s.els) {
      if (e.k === "rect" || e.k === "ellipse") {
        const shape = e.k === "ellipse" ? pres.ShapeType.ellipse : e.r > 0 ? pres.ShapeType.roundRect : pres.ShapeType.rect
        slide.addShape(shape, {
          x: e.x, y: e.y, w: e.w, h: e.h,
          fill: { color: e.fill, ...(e.alpha ? { transparency: e.alpha } : {}) },
          line: e.line ? { color: e.line, width: e.lw ?? 1 } : { type: "none" },
          ...(e.k === "rect" && e.r > 0 ? { rectRadius: e.r } : {}),
        })
      } else if (e.k === "img") {
        slide.addImage({ path: e.file, x: e.x, y: e.y, w: e.w, h: e.h, altText: e.alt ?? "" })
      } else {
        const runs = []
        e.paras.forEach((p, pi) => {
          p.runs.forEach((r, ri) => {
            runs.push({
              text: r.t,
              options: {
                fontFace: r.f ?? e.font, fontSize: r.s ?? e.size, color: r.c ?? e.color, bold: r.b ?? e.bold, italic: r.i ?? false,
                align: p.align ?? e.align, paraSpaceAfter: p.after ?? e.after, lineSpacingMultiple: e.ls,
                ...(ri === p.runs.length - 1 && pi < e.paras.length - 1 ? { breakLine: true } : {}),
                ...(e.spacing ? { charSpacing: e.spacing } : {}),
              },
            })
          })
        })
        slide.addText(runs, { x: e.x, y: e.y, w: e.w, h: e.h, margin: 0, valign: e.valign, isTextBox: true, fit: "none", wrap: true })
      }
    }
    if (s.notes) slide.addNotes(s.notes)
  }
  await pres.writeFile({ fileName: file })
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML preview
// ---------------------------------------------------------------------------------------------------------------------
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const px = (v) => `${(v * PX).toFixed(1)}px`
const hex = (c) => `#${c}`

export function previewHtml(assets) {
  const out = slides.map((s, i) => {
    const parts = s.els.map((e, n) => {
      const box = `left:${px(e.x)};top:${px(e.y)};width:${px(e.w)};height:${px(e.h)}`
      if (e.k === "rect" || e.k === "ellipse") {
        const radius = e.k === "ellipse" ? "50%" : px(e.r ?? 0)
        const border = e.line ? `border:${(e.lw ?? 1) * 2}px solid ${hex(e.line)};box-sizing:border-box;` : ""
        return `<div style="${box};background:${hex(e.fill)};${e.alpha ? `opacity:${1 - e.alpha / 100};` : ""}border-radius:${radius};${border}"></div>`
      }
      if (e.k === "img") return `<img src="file://${e.file}" style="${box};object-fit:fill" alt="">`
      const paras = e.paras
        .map((p) => {
          const runs = p.runs
            .map((r) => `<span style="font-family:'${r.f ?? e.font}';font-size:${(r.s ?? e.size) * 2}px;color:${hex(r.c ?? e.color)};font-weight:${(r.b ?? e.bold) ? 700 : 400};font-style:${r.i ? "italic" : "normal"};${e.spacing ? `letter-spacing:${e.spacing * 2}px;` : ""}white-space:pre-wrap">${esc(r.t)}</span>`)
            .join("")
          const size = Math.max(...p.runs.map((r) => r.s ?? e.size))
          return `<div style="text-align:${p.align ?? e.align};margin-bottom:${(p.after ?? e.after) * 2}px;line-height:${(size * 2 * 1.15 * e.ls).toFixed(1)}px;min-height:${(size * 2 * 1.15 * e.ls).toFixed(1)}px">${runs}</div>`
        })
        .join("")
      const justify = e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start"
      return `<div class="txt" data-slide="${i + 1}" data-n="${n}" style="${box};display:flex;flex-direction:column;justify-content:${justify};overflow:hidden">${paras}</div>`
    })
    return `<section class="slide" id="s${i + 1}" style="background:url('file://${path.join(assets, `bg-${s.bg}.png`)}') center/cover">${parts.join("")}</section>`
  })
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000}.slide{position:relative;width:1920px;height:1080px;overflow:hidden;margin:0 0 20px}.slide>*{position:absolute;box-sizing:border-box}</style>${out.join("")}`
}
