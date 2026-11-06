// Browser entry of the Bobi web chat (ADR-0024). It runs the same chat controller as the IDE panel and the same panel
// page (packages/ide-extension/media/chat.js); this file only stands in for the parts VS Code provides:
//   - acquireVsCodeApi(): messages from the page go to the controller, controller messages go back to the page;
//   - the diff editor: the proposed change is shown inside the approval card.
// The page's own login (same origin) authenticates every request, so the client sends no credentials.
import { BobiClient, type PermissionRequest } from "../../ide-extension/src/client.ts"
import { ChatController, type ToUi } from "../../ide-extension/src/controller.ts"

type FromPage = { type: string; text?: string; id?: string; decision?: "once" | "always" | "reject"; mode?: string }

const toPage = (message: ToUi | { type: "info"; message: string }) => window.dispatchEvent(new MessageEvent("message", { data: message }))

function el(tag: string, cls: string, text?: string) {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const lineClass = (line: string) =>
  line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : ""

/** Renders the patches of an edit request below its approval card (text only, never HTML). */
function showDiff(request: PermissionRequest) {
  const card = document.getElementById(`approval-${request.id}`)
  if (!card) return
  const buttons = card.querySelector(".buttons")
  for (const file of request.metadata?.files ?? []) {
    card.insertBefore(el("div", "diff-file", file.file), buttons)
    const pre = el("pre", "diff")
    for (const line of file.patch.split("\n")) pre.appendChild(el("div", lineClass(line), line || " "))
    card.insertBefore(pre, buttons)
  }
}

let controller: ChatController | undefined

async function boot() {
  const { directory } = (await (await fetch("/config.json")).json()) as { directory: string }
  controller = new ChatController(new BobiClient("", undefined), directory, {
    // The card says "open in the diff editor" for edits; here the diff is inside the card.
    post: (m) => toPage(m.type === "approval" ? { ...m, diff: false } : m),
    showDiff: async (r) => showDiff(r),
    error: (message) => toPage({ type: "error", message }),
  })
  await controller.start()
}

const actions: Record<string, (c: ChatController, m: FromPage) => Promise<unknown> | unknown> = {
  send: (c, m) => c.send(m.text ?? ""),
  reply: (c, m) => c.reply(m.id!, m.decision!),
  mode: (c, m) => c.setMode(m.mode!),
  stop: (c) => c.stopRequest(),
  new: (c) => c.newChat(),
  undo: async (c) => toPage({ type: "info", message: (await c.undo()) ? "Undone: the last request's changes were reverted." : "Nothing to undo." }),
}

async function handle(m: FromPage) {
  try {
    if (m.type === "loaded") await boot()
    else if (controller && Object.hasOwn(actions, m.type)) await actions[m.type]!(controller, m)
  } catch (error) {
    toPage({ type: "error", message: (error as Error).message })
  }
}

;(window as unknown as { acquireVsCodeApi: () => { postMessage: (m: FromPage) => void } }).acquireVsCodeApi = () => ({ postMessage: (m) => void handle(m) })
