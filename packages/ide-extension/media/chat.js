// Bobi chat panel (webview). Talks to the extension with postMessage only; no network access (CSP).
const vscode = acquireVsCodeApi()
const log = document.getElementById("log")
const input = document.getElementById("input")
const mode = document.getElementById("mode")
const send = document.getElementById("send")
const stop = document.getElementById("stop")
let current // the assistant message being streamed

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function scroll() {
  log.scrollTop = log.scrollHeight
}
function submit() {
  const text = input.value
  if (!text.trim()) return
  input.value = ""
  current = undefined
  vscode.postMessage({ type: "send", text })
}

send.addEventListener("click", submit)
stop.addEventListener("click", () => vscode.postMessage({ type: "stop" }))
document.getElementById("new").addEventListener("click", () => vscode.postMessage({ type: "new" }))
document.getElementById("undo").addEventListener("click", () => vscode.postMessage({ type: "undo" }))
mode.addEventListener("change", () => vscode.postMessage({ type: "mode", mode: mode.value }))
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
})

window.addEventListener("message", ({ data: m }) => {
  switch (m.type) {
    case "ready":
      mode.replaceChildren(...m.modes.map((x) => Object.assign(el("option", "", x.name), { value: x.id })))
      mode.value = m.mode
      break
    case "mode":
      mode.value = m.mode
      break
    case "user": {
      const box = el("div", "msg user", m.text)
      if (m.context.length) box.appendChild(el("div", "context", `context: ${m.context.join(", ")}`))
      log.appendChild(box)
      current = undefined
      break
    }
    case "text":
      if (!current) log.appendChild((current = el("div", "msg bobi", "")))
      current.textContent += m.delta
      break
    case "tool":
      log.appendChild(el("div", "tool", `⚙ ${m.name}${m.summary ? ` – ${m.summary}` : ""}`))
      current = undefined
      break
    case "approval": {
      const card = el("div", "approval")
      card.id = `approval-${m.id}`
      card.appendChild(el("div", "title", `Bobi wants to ${m.action}: ${m.resources.join(", ")}`))
      if (m.diff) card.appendChild(el("div", "hint", "The proposed change is open in the diff editor."))
      const buttons = el("div", "buttons")
      for (const [label, decision] of [["Accept", "once"], ["Always", "always"], ["Reject", "reject"]]) {
        const b = el("button", decision === "reject" ? "secondary" : "", label)
        b.addEventListener("click", () => vscode.postMessage({ type: "reply", id: m.id, decision }))
        buttons.appendChild(b)
      }
      card.appendChild(buttons)
      log.appendChild(card)
      current = undefined
      break
    }
    case "approval-done": {
      const card = document.getElementById(`approval-${m.id}`)
      if (card) card.replaceChildren(el("div", "done", m.decision === "reject" ? "✗ rejected" : m.decision === "always" ? "✓ always allowed" : "✓ accepted"))
      break
    }
    case "busy":
      stop.hidden = !m.busy
      send.disabled = m.busy
      break
    case "cleared":
      log.replaceChildren()
      current = undefined
      break
    case "error":
      log.appendChild(el("div", "error", m.message))
      break
    case "info":
      log.appendChild(el("div", "info", m.message))
      break
  }
  scroll()
})

vscode.postMessage({ type: "loaded" })
