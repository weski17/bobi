#!/usr/bin/env node
// Builds the Bobi deck (bobi-deck.pptx) in the look of the feature video, plus an optional HTML/PNG preview.
//   node assets.mjs                  once: background, logo, wordmark (Chromium)
//   node build-deck.mjs              writes bobi-deck.pptx
//   node build-deck.mjs --preview    also renders every slide to preview/NN.png and reports text that does not fit
// pptxgenjs (MIT) is installed outside the repository: `npm install --prefix ~/.cache/bobi-deck pptxgenjs` (or DECK_HOME).
// Every statement on the slides is taken from the repository (docs/STATUS.md, README, ADRs, handbook) or from real runs
// (screens/ and terminal/ are captured by capture-screens.mjs and capture-terminal.sh).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { C, MONO, SANS, ellipse, image, loadPptx, newSlide, previewHtml, rect, slides, text, writePptx } from "./lib.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const assets = path.join(here, "assets")
const screens = path.join(here, "screens")
const TOTAL = 20
const L = 0.83
const CW = 11.67

// ---------------------------------------------------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------------------------------------------------
let page = 0
function header(kicker, title, accentWord) {
  page++
  text(L, 0.42, 9, 0.35, kicker.toUpperCase(), { size: 14, bold: true, color: C.accent, spacing: 3 })
  text(10.2, 0.42, 2.3, 0.35, `${String(page).padStart(2, "0")} / ${TOTAL}`, { size: 14, color: C.muted, align: "right" })
  const parts = accentWord && title.includes(accentWord) ? title.split(accentWord) : [title]
  const runs = parts.length === 2 ? [{ t: parts[0] }, { t: accentWord, c: C.accent }, { t: parts[1] }] : [{ t: title }]
  text(L, 0.78, CW, 0.8, [runs], { size: 36, bold: true })
}

/** A card with a coloured title and a short text. */
function card(x, y, w, h, title, body, color = C.accent, o = {}) {
  rect(x, y, w, h)
  const size = o.titleSize ?? 22
  const bodyY = size === 20 ? 0.68 : 0.78
  text(x + 0.3, y + 0.2, w - 0.6, 0.45, title, { size, bold: true, color })
  text(x + 0.3, y + bodyY, w - 0.6, h - bodyY - 0.12, body, { size: 18, color: C.muted, after: 4 })
}

function chip(x, y, w, label, color = C.text, o = {}) {
  rect(x, y, w, o.h ?? 0.5, { fill: "0F1832", line: o.line ?? C.line, r: 0.25 })
  text(x, y, w, o.h ?? 0.5, label, { size: o.size ?? 18, bold: true, color, align: "center", valign: "middle" })
}

function badge(x, y, n, color = C.accent, d = 0.5) {
  ellipse(x, y, d, d, { fill: color })
  text(x, y, d, d, String(n), { size: 20, bold: true, color: C.bg, align: "center", valign: "middle" })
}

const readTerm = (name) => readFileSync(path.join(here, "terminal", `${name}.txt`), "utf8").replace(/\s+$/, "").split("\n")
/** Long identifiers are shortened with an ellipsis so a line fits the slide; nothing else is changed. */
const short = (line) =>
  line
    .replace(/ses_[A-Za-z0-9]{8,}/g, (m) => `${m.slice(0, 8)}…`)
    .replace(/\b[0-9a-f]{64}\b/g, (m) => `${m.slice(0, 8)}…`)
    .replace(/\b[0-9a-f]{16}\b/g, (m) => `${m.slice(0, 4)}…`)

function termRuns(line) {
  if (line.startsWith("$ ")) return [{ t: "$ ", c: C.muted }, { t: line.slice(2), c: C.text, b: true }]
  if (/^BROKEN|refused|is revoked/.test(line)) return [{ t: line, c: C.red, b: true }]
  if (/^REVOKED|warning \[/.test(line)) return [{ t: line, c: C.warn }]
  if (/^intact|^installed|^trusted|^\s+removed|^no revoked|^reg\/.*\.bobipkg|^reg\/revocations/.test(line)) return [{ t: line, c: C.green }]
  if (line.startsWith("bobi:") || line.startsWith("# ")) return [{ t: line, c: C.muted }]
  return [{ t: line, c: C.code }]
}

/** A terminal window; `lines` are real output lines (use "" for a blank line). Returns its height. */
function terminal(x, y, w, title, lines, o = {}) {
  const size = o.size ?? 18
  const cpl = Math.floor((w - 0.6) / ((size * 0.6) / 72))
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0)
  const h = o.h ?? 0.45 + 0.3 + rows * ((size * 1.15) / 72) + 0.1
  rect(x, y, w, h, { fill: C.panel2, line: C.line, r: 0.12 })
  rect(x + 0.02, y + 0.02, w - 0.04, 0.4, { fill: C.bar, line: null, r: 0.1 })
  rect(x + 0.02, y + 0.22, w - 0.04, 0.2, { fill: C.bar, line: null, r: 0 })
  rect(x + 0.02, y + 0.42, w - 0.04, 0.012, { fill: C.line, line: null, r: 0 })
  ;[0, 1, 2].forEach((i) => ellipse(x + 0.22 + i * 0.2, y + 0.15, 0.11, 0.11, { fill: "39466F" }))
  text(x + 1.0, y + 0.08, w - 1.3, 0.3, title, { size: 14, color: C.muted })
  text(
    x + 0.3,
    y + 0.6,
    w - 0.6,
    h - 0.62,
    lines.map((l) => ({ runs: termRuns(short(l)).map((r) => ({ ...r, f: MONO })) })),
    { size },
  )
  return h
}

const pngSize = (file) => {
  const b = readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

/** A real screenshot in a frame, as large as fits into the box (boxW x boxH), top-left aligned. Returns the drawn height. */
function shot(name, x, y, boxW, caption, boxH = 99, captionY) {
  const file = path.join(screens, name)
  if (!existsSync(file)) {
    text(x, y, boxW, 1, `(Screenshot ${name} fehlt)`, { color: C.warn })
    return 1
  }
  const size = pngSize(file)
  const scale = Math.min(boxW / size.w, boxH / size.h)
  const w = size.w * scale
  const h = size.h * scale
  rect(x - 0.05, y - 0.05, w + 0.1, h + 0.1, { fill: C.panel2, line: C.line, r: 0.1 })
  image(file, x, y, w, h, caption ?? "Screenshot des Bobi-Web-Chats")
  if (caption) text(x, captionY ?? y + h + 0.15, boxW, 0.4, caption, { size: 18, color: C.muted })
  return h
}

/** A screenshot with a numbered dot in its corner that matches the step chip above it. */
function shotStep(name, x, y, w, n, color) {
  const h = shot(name, x, y, w)
  badge(x + 0.12, y + 0.12, n, color, 0.42)
  return h
}

// ---------------------------------------------------------------------------------------------------------------------
// 1 Titel
// ---------------------------------------------------------------------------------------------------------------------
newSlide({
  bg: "title",
  notes: "Willkommen. Bobi ist ein KI-Entwicklungspartner, der komplett im eigenen Netz läuft. Heute zeige ich, was es kann, was neu dazugekommen ist, und ich zeige es live.",
})
page++
image(path.join(assets, "logo.png"), 5.87, 0.75, 1.6, 1.6, "Bobi-Logo")
image(path.join(assets, "wordmark.png"), 4.65, 2.3, 4.03, 1.96, "Bobi")
text(0.7, 4.35, 11.93, 0.6, "Dein KI-Entwicklungspartner – komplett im eigenen Netz", { size: 28, bold: true, align: "center" })
text(1.7, 5.05, 9.93, 0.9, "Plant, liest und schreibt Code, führt Befehle aus. Mit eigenen Modellen. Dein Code verlässt das Netz nie.", { size: 20, color: C.muted, align: "center" })
chip(2.3, 6.2, 2.7, "On-Premise", C.accent)
chip(5.3, 6.2, 2.95, "Eigene Modelle", C.accent2)
chip(8.55, 6.2, 2.5, "Mit Freigabe", C.green)

// ---------------------------------------------------------------------------------------------------------------------
// 2 Warum
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Das Ziel: ein Entwicklungspartner, der im Firmennetz bleibt. Der Modell-Endpunkt ist frei einstellbar, es gibt keinen fest eingebauten Cloud-Anbieter, und jede Aktion wird protokolliert." })
header("Warum Bobi", "Dein Code bleibt im Netz", "im Netz")
{
  const w = (CW - 0.7) / 3
  card(L, 2.05, w, 4.4, "Eigene Modelle", ["Ein Endpunkt, den du einstellst.", "Passt zu LiteLLM, vLLM oder Ollama, ohne Code zu ändern."], C.accent)
  card(L + w + 0.35, 2.05, w, 4.4, "Keine Cloud", ["Kein Anbieter fest eingebaut.", "Standard zeigt auf einen lokalen Endpunkt."], C.accent2)
  card(L + 2 * (w + 0.35), 2.05, w, 4.4, "Nachvollziehbar", ["Jede Aktion wird protokolliert: Nutzer, Modus, Werkzeug, Ergebnis.", "Weiterleitbar an Langfuse oder ein anderes Backend."], C.green)
}

// ---------------------------------------------------------------------------------------------------------------------
// 3 Zwei Oberflächen
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Es gibt zwei Oberflächen: die IDE, ein Code-OSS mit dem Bobi-Panel, und die Shell für Skripte und CI. Beide teilen denselben Kern, also dieselben Modi, Regeln und dieselbe Konfiguration." })
header("Aufbau", "Zwei Oberflächen, ein Kern", "ein Kern")
{
  card(L, 2.05, 5.6, 1.85, "Bobi IDE", "Code-OSS mit Chat-Panel, Diffs vor dem Übernehmen.", C.blue)
  card(L + 6.07, 2.05, 5.6, 1.85, "Bobi Shell", "Terminal, interaktiv und headless für Skripte und CI.", C.accent2)
  rect(L, 4.2, CW, 1.2, { fill: "10203A", line: C.accent })
  text(L + 0.3, 4.2, CW - 0.6, 1.2, [[{ t: "Ein Kern  ", c: C.accent, b: true }, { t: "gleiche Modi · gleiche Regeln · gleiche Konfiguration" }]], { size: 22, valign: "middle", align: "center" })
  rect(L, 5.7, CW, 0.95, { fill: C.panel2 })
  text(L + 0.3, 5.7, CW - 0.6, 0.95, [[{ t: "Dein Modell-Endpunkt  ", c: C.muted }, { t: "LiteLLM · vLLM · Ollama", c: C.text, b: true }]], { size: 20, valign: "middle", align: "center" })
}

// ---------------------------------------------------------------------------------------------------------------------
// 4 Schleife
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Bobi arbeitet in einer Schleife: planen, ein Werkzeug aufrufen, das Ergebnis prüfen, wiederholen. Jede schreibende Aktion und jeder Terminal-Befehl fragt zuerst, vor jeder Änderung gibt es einen Checkpoint, und Rückgängig geht mit einem Klick." })
header("Die Schleife", "Planen, handeln, prüfen", "handeln")
{
  const steps = ["Planen", "Werkzeug aufrufen", "Ergebnis prüfen", "Wiederholen"]
  const w = 2.72
  steps.forEach((s, i) => {
    const x = L + i * (w + 0.263)
    rect(x, 2.05, w, 1.0, { fill: C.panel, line: [C.accent, C.accent2, C.blue, C.green][i], lw: 1.5, r: 0.18 })
    text(x, 2.05, w, 1.0, s, { size: 20, bold: true, align: "center", valign: "middle" })
    if (i < 3) text(x + w, 2.05, 0.263, 1.0, "›", { size: 30, bold: true, color: C.muted, align: "center", valign: "middle" })
  })
  const cw = (CW - 0.7) / 3
  card(L, 3.5, cw, 2.9, "Freigabe", "Jede schreibende Aktion und jeder Befehl fragt zuerst. Auto-Freigabe nur per Einstellung.", C.green)
  card(L + cw + 0.35, 3.5, cw, 2.9, "Checkpoint", "Vor jeder Änderung wird automatisch gesichert.", C.accent)
  card(L + 2 * (cw + 0.35), 3.5, cw, 2.9, "Rückgängig", "Mit einem Klick zurück zum Stand davor.", C.accent2)
}

// ---------------------------------------------------------------------------------------------------------------------
// 5 Modi
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Sechs eingebaute Modi geben Bobi eine Rolle und begrenzen seine Rechte. Ask kann nur lesen, plan schreibt nur Markdown, security sucht Schwachstellen. Eigene Modi legt man pro Projekt in einer Datei an." })
header("Modi", "Sechs Modi für sechs Rollen", "sechs Rollen")
{
  const modes = [
    ["code", "Programmieren, der Standard", C.accent],
    ["plan", "Planen, schreibt nur Markdown", C.blue],
    ["ask", "Fragen beantworten, nur lesen", C.green],
    ["advanced", "Wie code, plus MCP", C.accent2],
    ["orchestrator", "Große Aufgaben zerlegen", C.warn],
    ["security", "Schwachstellen finden, Patches vorschlagen", C.red],
  ]
  const w = (CW - 0.7) / 3
  modes.forEach(([name, body, color], i) => {
    const x = L + (i % 3) * (w + 0.35)
    const y = 2.0 + Math.floor(i / 3) * 2.15
    rect(x, y, w, 1.9)
    text(x + 0.3, y + 0.2, w - 0.6, 0.5, name, { size: 24, bold: true, color, font: MONO })
    text(x + 0.3, y + 0.85, w - 0.6, 0.95, body, { size: 18, color: C.muted })
  })
  text(L, 6.4, CW, 0.5, [[{ t: "Eigene Modi ", c: C.accent, b: true }, { t: "pro Projekt in " }, { t: ".bobi/custom_modes.yaml", f: MONO, c: C.code }]], { size: 20 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 6 Projekt-Kontext
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Bobi liest, was im Projekt steht: eine AGENTS.md mit der Projektbeschreibung, Regeln, die immer oder nur in einem Modus gelten, und eine .bobiignore für Dateien, die er nie anfassen darf. Fremde Projekte nutzt er erst, wenn du ihnen vertraust." })
header("Projekt-Kontext", "Bobi kennt dein Projekt", "kennt")
{
  const lines = ["AGENTS.md", ".bobiignore", ".bobi/", "  config.jsonc", "  custom_modes.yaml", "  rules/   rules-<modus>/", "  skills/   commands/"]
  terminal(L, 2.05, 5.2, "dein-projekt/", lines, { h: 4.3 })
  card(6.35, 2.05, 6.15, 1.3, "AGENTS.md", "Beschreibung des Projekts. /init schreibt sie.", C.accent, { titleSize: 20 })
  card(6.35, 3.55, 6.15, 1.3, "Regeln", "Immer aktiv, oder nur in einem Modus.", C.accent2, { titleSize: 20 })
  card(6.35, 5.05, 6.15, 1.3, ".bobiignore", "Diese Dateien bleiben unberührt.", C.red, { titleSize: 20 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 7 Mehr als ein Chat
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Der Orchestrator zerlegt große Aufgaben und gibt sie an andere Modi ab. Skills und eigene Slash-Befehle machen Wiederkehrendes teilbar. Beim Literate Coding schreibt man in Klartext an die Code-Stelle, drückt ein Tastenkürzel und prüft das Ergebnis als Diff." })
header("Werkzeuge", "Mehr als ein Chat", "Mehr")
{
  const w = (CW - 0.35) / 2
  card(L, 2.05, w, 2.1, "Orchestrator", "Zerlegt große Aufgaben und delegiert sie an andere Modi.", C.warn)
  card(L + w + 0.35, 2.05, w, 2.1, "Skills und Befehle", "SKILL.md und eigene Slash-Befehle. /commit, /pr, /security-review.", C.accent)
  card(L, 4.4, w, 2.1, "Literate Coding", "Anweisung in Klartext an die Code-Stelle schreiben, Tastenkürzel, Ergebnis als Diff.", C.accent2)
  card(L + w + 0.35, 4.4, w, 2.1, "Git", "Commit-Nachrichten und Pull Requests. Push fragt immer.", C.blue)
}

// ---------------------------------------------------------------------------------------------------------------------
// 8 Tipps und Security
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Code-Tipps markieren komplexe Funktionen und Anti-Patterns, lokal und ohne Modellaufruf. Hier prüft Bobi seinen eigenen Code und findet zwei zu komplexe Funktionen. Der Security-Modus sucht Schwachstellen und schlägt Patches vor." })
header("Qualität beim Schreiben", "Tipps und Security-Agent", "Security-Agent")
{
  const t = readTerm("tips-self")
  terminal(L, 2.05, 7.2, "bobi tips: Bobi prüft seinen eigenen Code", [t[0], t[1].replace(/^packages\/core\/src\//, "…/"), t[2].replace(/^packages\/core\/src\//, "…/"), "", t[3]], { h: 4.6 })
  card(8.4, 2.05, 4.1, 2.15, "Code-Tipps", "Komplexität, Länge, Verschachtelung. Lokal, ohne Modell.", C.warn, { titleSize: 20 })
  card(8.4, 4.4, 4.1, 2.25, "Security", "Modus security: Schwachstellen finden, Patches vorschlagen.", C.red, { titleSize: 20 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 9 MCP
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Bobi spricht MCP, lokal und entfernt, pro Modus freischaltbar. Drei eigene Server gehören dazu: ein Code-Graph, eine COBOL-Analyse, getestet an AWS CardDemo, und der Zugriff auf den Mainframe über Zowe-kompatible Dienste mit Allowlist." })
header("MCP", "Code, COBOL, Mainframe", "COBOL")
{
  const w = (CW - 0.7) / 3
  card(L, 2.05, w, 3.6, "Code-Graph", ["Aufrufketten und Abhängigkeiten.", "Diagramme aus dem Code."], C.accent)
  card(L + w + 0.35, 2.05, w, 3.6, "COBOL", ["Parser, Datenfluss, Auswirkungsanalyse.", "Getestet an AWS CardDemo."], C.accent2)
  card(L + 2 * (w + 0.35), 2.05, w, 3.6, "Mainframe", ["Datasets und Jobs über Zowe.", "Nur freigegebene Datasets."], C.blue)
  text(L, 5.95, CW, 0.5, "MCP-Client für lokale und entfernte Server, pro Modus freischaltbar.", { size: 20, color: C.muted })
}

// ---------------------------------------------------------------------------------------------------------------------
// 10 Sicherheit
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Sicherheit ist Teil des Produkts. Bobi läuft in einer Sandbox, darf nur auf freigegebene Ziele zugreifen und behandelt Inhalte aus Dateien, Webseiten und Terminal als Daten, nie als Anweisung. Das wird mit einem Red Team getestet. Secrets werden maskiert, alles wird protokolliert." })
header("Sicherheit", "Sicher gebaut", "Sicher")
{
  const items = [
    ["Sandbox", "Container ohne Zugriff auf Produktivdaten.", C.accent],
    ["Allowlist", "Netzwerk nur zu freigegebenen Zielen.", C.blue],
    ["Prompt-Injection", "Inhalte sind Daten, nie Anweisungen. Red-Team-getestet.", C.red],
    ["Secrets maskiert", "In Prompts, Logs, Audit und Checkpoints.", C.warn],
    ["Audit", "Nutzer, Modus, Werkzeug, Ergebnis. OpenTelemetry.", C.green],
    ["Rechte im Repo", "Versioniert, per Pull Request prüfbar.", C.accent2],
  ]
  const w = (CW - 0.7) / 3
  items.forEach(([t, b, c], i) => card(L + (i % 3) * (w + 0.35), 2.0 + Math.floor(i / 3) * 2.3, w, 2.1, t, b, c, { titleSize: 22 }))
}

// ---------------------------------------------------------------------------------------------------------------------
// 11 Dossier  (NEU)
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Neu: das signierte Änderungsprotokoll. Es hält Auftrag, Modell, jeden Werkzeugaufruf und jede Freigabe fest, als Hash-Kette mit Signatur. Man kann es für eine ganze Sitzung oder für eine einzelne Aufgabe erzeugen. Die Ausgabe rechts stammt aus einer echten Sitzung mit dem Modell." })
header("Neu · Nachweisbar", "Das Änderungsprotokoll", "Änderungsprotokoll")
{
  const seal = readTerm("dossier-seal")
  const verify = readTerm("dossier-verify")
  const forged = readTerm("dossier-verify-forged")
  const pick = (re) => seal.find((l) => re.test(l))
  terminal(
    5.7,
    1.9,
    6.8,
    "echte Sitzung, eine Aufgabe",
    [
      "$ bobi dossier --task 1 --out task.json",
      pick(/^- Models/),
      pick(/^- Tokens/),
      pick(/^- Tool calls/),
      pick(/^- Approvals/),
      "",
      verify[0],
      verify[1],
      "",
      '# "task": 1 → 2 in der Datei geändert',
      forged[0],
      forged[1],
    ],
    { h: 5.0 },
  )
  card(L, 1.9, 4.6, 1.5, "Was drinsteht", "Auftrag, Modell, jeder Werkzeugaufruf, jede Freigabe.", C.accent, { titleSize: 20 })
  card(L, 3.55, 4.6, 1.5, "Warum man ihm traut", "Hash-Kette und Signatur: Änderungen fallen auf.", C.green, { titleSize: 20 })
  card(L, 5.2, 4.6, 1.6, "Pro Aufgabe", "Auch für einen einzelnen Prompt, mit --task.", C.accent2, { titleSize: 20 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 12 Modellvergleich  (NEU)
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Neu: der Modellvergleich. Dieselbe Aufgabe läuft mit zwei bis vier Modellen, jedes in einem eigenen Git-Worktree, und Bobi startet danach selbst denselben Testbefehl. So sieht man, welches Modell auf dem eigenen Code besteht. Ehrlich gesagt: Ein Lauf mit echten Modellen steht noch aus, bisher lief es nur gegen den Mock." })
header("Neu · Nachweisbar", "Modellvergleich auf deinem Code", "deinem Code")
{
  terminal(L, 2.05, 6.4, "bobi compare", ['$ bobi compare --models a,b \\', '    --test "bun test" "<Aufgabe>"', "", "→ jedes Modell in einem", "  eigenen git worktree", "→ Bobi startet den Test selbst"], { h: 3.0 })
  card(7.45, 2.05, 5.05, 3.0, "Die Tabelle zeigt", ["Test bestanden oder nicht", "Zeit, Dateien, geänderte Zeilen", "Werkzeugaufrufe und Token"], C.accent2)
  rect(L, 5.35, CW, 1.15, { fill: "2A2210", line: C.warn })
  text(L + 0.3, 5.35, CW - 0.6, 1.15, [[{ t: "Noch offen: ", c: C.warn, b: true }, { t: "ein Lauf mit echten Modellen. Bisher nur gegen das Mock-Modell getestet." }]], { size: 20, valign: "middle" })
}

// ---------------------------------------------------------------------------------------------------------------------
// 13 Registry (NEU)
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Neu: eine signierte Registry für Skills und Slash-Befehle. Installieren geht nur von Herausgebern, denen man vertraut. Und neu ist die Sperrliste: Ein Herausgeber kann ein Paket sperren, danach lässt es sich nicht mehr installieren, auch nicht mit force. Alle Ausgaben hier sind echte Läufe." })
header("Neu · Nachweisbar", "Registry mit Sperrliste", "Sperrliste")
{
  const pack = readTerm("registry-pack")
  const trust = readTerm("registry-trust")
  const inst = readTerm("registry-install")
  const rev = readTerm("registry-revoke")
  const ref = readTerm("registry-refused")
  const chk = readTerm("registry-check")
  terminal(L, 1.75, 5.7, "Herausgeberin und Nutzer", [pack[0], pack[1], "", trust[0], trust[1], "", inst[0], inst[1]], { h: 5.3 })
  terminal(6.8, 1.75, 5.7, "Danach: gesperrt", [rev[0], rev[1], "", ref[0], ref[2], "", chk[0], chk[2]], { h: 5.3 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 14 Web-Chat und Demo (NEU)
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Neu: der Web-Chat. Das Chat-Panel der IDE läuft auch als Webseite, ausgeliefert von einem schmalen Gate, das nur die Aufrufe des Chats durchlässt. Das Demo-Image bringt Server und ein kleines lokales Modell mit, der Container hat kein Internet. Das Bild ist ein echter Screenshot." })
header("Neu · Ausprobieren", "Web-Chat und Online-Demo", "Online-Demo")
{
  shot("chat-approval.png", L, 2.0, 7.0, "Echte Freigabekarte in der Demo", 4.5)
  card(8.2, 2.0, 4.3, 1.55, "Nur ein Browser", "Anmelden, ausprobieren, nichts installieren.", C.accent, { titleSize: 20 })
  card(8.2, 3.72, 4.3, 1.55, "Schmales Gate", "Lässt nur die Aufrufe des Chats durch.", C.accent2, { titleSize: 20 })
  card(8.2, 5.44, 4.3, 1.4, "Ohne Internet", "Das Modell steckt im Image.", C.green, { titleSize: 20 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 15 CI (NEU)
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Neu in der CI: Der Tipps-Check meldet bei Pull Requests nur, was die Änderung neu hinzufügt. Und der Image-Scan mit Trivy lässt den Build fehlschlagen, sobald ein neuer Fund auftaucht. Die 54 bekannten Funde stehen in einer Basisliste mit Ablaufdatum 6. Februar 2027. Das ist ein Stand, kein Freispruch." })
header("Neu · Qualität in der CI", "Die CI passt mit auf", "CI")
{
  const w = (CW - 0.35) / 2
  rect(L, 2.0, w, 4.6)
  text(L + 0.3, 2.2, w - 0.6, 0.45, "Tipps-Check bei Pull Requests", { size: 22, bold: true, color: C.accent })
  text(L + 0.3, 2.8, w - 0.6, 1.45, [[{ t: "Nur Neues", s: 54, b: true, c: C.green }]], { size: 54 })
  text(L + 0.3, 4.3, w - 0.6, 2.1, ["Meldet nur, was die Änderung neu hinzufügt.", [{ t: "bobi tips --since origin/main", f: MONO, c: C.code, s: 18 }], "Bei den letzten Pull Requests: 0 neue Tipps."], { size: 18, color: C.muted, after: 8 })
  rect(L + w + 0.35, 2.0, w, 4.6)
  text(L + w + 0.65, 2.2, w - 0.6, 0.45, "Image-Scan mit Trivy", { size: 22, bold: true, color: C.accent2 })
  text(L + w + 0.65, 2.8, w - 0.6, 1.45, [[{ t: "54", s: 66, b: true, c: C.warn }, { t: "  bekannte Funde", s: 22, c: C.muted }]], { size: 66 })
  text(L + w + 0.65, 4.3, w - 0.6, 2.1, ["Ein neuer Fund bricht den Build ab.", "Die bekannten stehen in einer Basisliste, die am 6.2.2027 abläuft."], { size: 18, color: C.muted, after: 8 })
}

// ---------------------------------------------------------------------------------------------------------------------
// 16 Live-Demo
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Jetzt die Live-Demo. Wir gehen fünf Aufgaben durch: etwas erklären lassen, einen Fehler beheben lassen und den Diff prüfen, rückgängig machen, eine Änderung ablehnen und zuletzt eine gesperrte Datei lesen lassen, was nicht klappen darf. Die Bilder sind echte Screenshots aus der Demo." })
header("Live-Demo", "Fünf Aufgaben, live", "live")
{
  const steps = [["1", "Erklären", C.accent], ["2", "Fehler beheben", C.accent2], ["3", "Rückgängig", C.blue], ["4", "Ablehnen", C.warn], ["5", "Gesperrte Datei", C.red]]
  const w = (CW - 0.6) / 5
  steps.forEach(([n, label, color], i) => {
    const x = L + i * (w + 0.15)
    rect(x, 2.0, w, 1.05)
    badge(x + 0.12, 2.28, n, color, 0.5)
    text(x + 0.72, 2.0, w - 0.78, 1.05, label, { size: 18, bold: true, valign: "middle" })
  })
  shotStep("chat-answer.png", L, 3.4, 5.6, 1, C.accent)
  shotStep("chat-secret.png", L, 5.1, 5.6, 5, C.red)
  shotStep("chat-approval.png", 6.9, 3.4, 5.6, 2, C.accent2)
}

// ---------------------------------------------------------------------------------------------------------------------
// 17 Zahlen
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Ein paar Zahlen zur Qualität: über 500 Tests sind grün, die Abdeckung des Kerns muss mindestens 80 Prozent betragen, sonst wird die Prüfung rot, das Red Team mit zehn Angriffen wurde vollständig eingedämmt, und hundert parallele Sitzungen liefen ohne Fehler. Wichtig: Das alles lief gegen ein Mock-Modell, nicht gegen ein echtes." })
header("Qualität", "Qualität in Zahlen", "Zahlen")
{
  const stats = [["500+", "Tests grün", C.green], ["≥ 80 %", "Abdeckung, von der CI erzwungen", C.accent], ["10/10", "Red-Team-Angriffe eingedämmt", C.accent2], ["100", "parallele Sitzungen, 0 Fehler", C.blue]]
  const w = (CW - 0.9) / 4
  stats.forEach(([n, label, color], i) => {
    const x = L + i * (w + 0.3)
    rect(x, 2.2, w, 2.7)
    text(x, 2.5, w, 1.2, n, { size: 54, bold: true, color, align: "center" })
    text(x + 0.2, 3.85, w - 0.4, 1.2, label, { size: 18, color: C.muted, align: "center" })
  })
  text(L, 5.3, CW, 0.9, "Alles gegen ein Mock-Modell, ohne echtes Modell und ohne Netz.", { size: 20, color: C.warn })
}

// ---------------------------------------------------------------------------------------------------------------------
// 18 Grenzen
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Ehrlich zu den Grenzen: Das kleine Modell auf der CPU ist langsam, eine Antwort dauert Sekunden bis Minuten, bei unseren Messungen zwischen 22 und 85 Sekunden. Die Online-Demo läuft noch nicht dauerhaft. Die Trivy-Liste läuft im Februar 2027 ab. Und vieles ist bisher nur gegen das Mock-Modell getestet, der Modellvergleich noch gar nicht mit echten Modellen." })
header("Ehrlich", "Grenzen und offene Punkte", "Grenzen")
{
  const items = [
    ["Das Demo-Modell ist klein und langsam", "Auf der CPU: Sekunden bis Minuten pro Antwort."],
    ["Die Online-Demo läuft noch nicht dauerhaft", "Aktuell nur lokal auf einem Rechner, kein Server."],
    ["Vieles nur gegen das Mock-Modell getestet", "Der Modellvergleich lief noch nie mit echten Modellen."],
    ["Die Trivy-Basisliste läuft am 6.2.2027 ab", "Sie ist ein Stand, kein Freispruch."],
  ]
  items.forEach(([t, b], i) => {
    const y = 2.0 + i * 1.18
    rect(L, y, CW, 1.05)
    ellipse(L + 0.3, y + 0.4, 0.25, 0.25, { fill: C.warn })
    text(L + 0.85, y + 0.1, CW - 1.1, 0.45, t, { size: 20, bold: true })
    text(L + 0.85, y + 0.55, CW - 1.1, 0.4, b, { size: 18, color: C.muted })
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// 19 Nächste Schritte
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ notes: "Die nächsten Schritte: Zuerst die Demo für zwei oder drei Tester erreichbar machen, dann deren Rückmeldungen einsammeln. Parallel ein Modellvergleich mit echten Modellen. Ollama aktualisieren macht die Trivy-Liste kürzer. Was danach gebaut wird, entscheiden wir nach den Rückmeldungen." })
header("Ausblick", "Nächste Schritte", "Nächste")
{
  const steps = [
    ["Tester einladen", "Zwei bis drei Leute probieren die Demo aus.", C.accent],
    ["Rückmeldungen auswerten", "Was war unklar, was ging kaputt?", C.accent2],
    ["Modellvergleich mit echten Modellen", "Ein echter Lauf auf eigenem Code.", C.blue],
    ["Ollama aktualisieren", "Die Trivy-Liste wird kürzer.", C.green],
  ]
  steps.forEach(([t, b, c], i) => {
    const y = 2.0 + i * 1.18
    rect(L, y, CW, 1.05)
    badge(L + 0.3, y + 0.28, i + 1, c, 0.5)
    text(L + 1.1, y + 0.1, CW - 1.4, 0.45, t, { size: 20, bold: true })
    text(L + 1.1, y + 0.55, CW - 1.4, 0.4, b, { size: 18, color: C.muted })
  })
  text(L, 6.8, CW, 0.4, "Danach entscheiden wir, was gebaut wird.", { size: 18, color: C.muted })
}

// ---------------------------------------------------------------------------------------------------------------------
// 20 Danke
// ---------------------------------------------------------------------------------------------------------------------
newSlide({ bg: "title", notes: "Vielen Dank. Fragen, Wünsche und Kritik sind ausdrücklich willkommen, auch gern nach dem Ausprobieren." })
page++
image(path.join(assets, "logo.png"), 5.87, 1.3, 1.6, 1.6, "Bobi-Logo")
text(1.2, 3.1, 10.93, 1.3, "Fragen?", { size: 54, bold: true, align: "center" })
text(1.7, 4.4, 9.93, 0.6, "Danke fürs Zuschauen und Ausprobieren.", { size: 24, color: C.muted, align: "center" })
chip(2.0, 5.7, 4.4, "Handbuch: docs/HANDBUCH.md", C.accent, { size: 18 })
chip(6.9, 5.7, 4.4, "Code: github.com/weski17/bobi", C.accent2, { size: 18 })

// ---------------------------------------------------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------------------------------------------------
if (page !== TOTAL) throw new Error(`expected ${TOTAL} slides, built ${page}`)
const out = path.join(here, "bobi-deck.pptx")
await writePptx(loadPptx(), out, assets)
console.log(`wrote ${out} (${slides.length} slides)`)

// Text must not sit on other text or on a picture (shapes behind text are fine: cards, chips, windows).
{
  const hit = (a, b) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01
  const found = []
  slides.forEach((slide, i) => {
    const texts = slide.els.filter((e) => e.k === "text")
    const pics = slide.els.filter((e) => e.k === "img")
    texts.forEach((a, n) => {
      for (const b of texts.slice(n + 1)) if (hit(a, b)) found.push(`slide ${i + 1}: text "${a.paras[0].runs[0].t.slice(0, 30)}" overlaps text "${b.paras[0].runs[0].t.slice(0, 30)}"`)
      for (const b of pics) if (hit(a, b) && !a.paras[0].runs[0].t.match(/^\d$/)) found.push(`slide ${i + 1}: text "${a.paras[0].runs[0].t.slice(0, 30)}" lies on a picture`)
    })
  })
  console.log(found.length ? `OVERLAPS:\n${found.join("\n")}` : "layout: no text overlaps text or pictures")
}

if (process.argv.includes("--preview")) {
  const dir = path.join(here, "preview")
  mkdirSync(dir, { recursive: true })
  const htmlFile = path.join(dir, "preview.html")
  writeFileSync(htmlFile, previewHtml(assets))
  const require = createRequire(import.meta.url)
  const core = [process.env.PLAYWRIGHT_CORE, path.resolve(here, "../../../packages/browser/node_modules/playwright-core"), "/Users/waeleskeif/Documents/GitHub/bobi/packages/browser/node_modules/playwright-core"].filter(Boolean).find((c) => existsSync(c))
  const { chromium } = require(core)
  const browser = await chromium.launch()
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await tab.goto(`file://${htmlFile}`)
  await tab.evaluate(() => document.fonts.ready)
  const problems = await tab.$$eval(".txt", (nodes) =>
    nodes
      .filter((n) => n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2)
      .map((n) => `slide ${n.dataset.slide}: "${n.textContent.slice(0, 60)}" (needs ${n.scrollHeight}px of ${n.clientHeight}px, width ${n.scrollWidth}/${n.clientWidth})`),
  )
  for (let i = 1; i <= slides.length; i++) await tab.locator(`#s${i}`).screenshot({ path: path.join(dir, `${String(i).padStart(2, "0")}.png`) })
  await browser.close()
  console.log(problems.length ? `TEXT DOES NOT FIT:\n${problems.join("\n")}` : "preview: all text fits")
}
