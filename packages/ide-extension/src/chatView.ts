// The Bobi chat panel: a webview view in the Bobi activity bar container.
import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import type { ToUi } from "./controller.ts"

export type FromUi =
  | { type: "loaded" }
  | { type: "send"; text: string }
  | { type: "reply"; id: string; decision: "once" | "always" | "reject" }
  | { type: "mode"; mode: string }
  | { type: "stop" }
  | { type: "new" }
  | { type: "undo" }

export class ChatView implements vscode.WebviewViewProvider {
  static readonly id = "bobi.chat"
  private view: vscode.WebviewView | undefined
  private loaded = false
  private ready: ToUi | undefined
  private readonly queue: (ToUi | { type: "info"; message: string })[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (message: FromUi) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view
    this.loaded = false
    const media = vscode.Uri.joinPath(this.extensionUri, "media")
    view.webview.options = { enableScripts: true, localResourceRoots: [media] }
    const nonce = randomBytes(16).toString("base64")
    const csp = `default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';`
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css"))}"></head>
<body><div id="app">
  <div id="bar"><select id="mode" title="Mode"></select><button id="new" class="secondary" title="New chat">New</button><button id="undo" class="secondary" title="Undo the last request's changes">Undo</button></div>
  <div id="log"></div>
  <div id="compose"><textarea id="input" placeholder="Ask Bobi … (Enter to send, Shift+Enter for a new line)"></textarea>
  <div><button id="send">Send</button><button id="stop" class="secondary" hidden>Stop</button></div></div>
</div><script nonce="${nonce}" src="${view.webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js"))}"></script></body></html>`
    view.webview.onDidReceiveMessage((m: FromUi) => {
      if (m.type === "loaded") {
        this.loaded = true
        if (this.ready) void view.webview.postMessage(this.ready)
        for (const queued of this.queue.splice(0)) void view.webview.postMessage(queued)
      }
      this.onMessage(m)
    })
  }

  post(message: ToUi | { type: "info"; message: string }) {
    if (message.type === "ready") this.ready = message
    if (this.view && this.loaded) void this.view.webview.postMessage(message)
    else if (message.type !== "ready") this.queue.push(message)
  }

  reveal() {
    void vscode.commands.executeCommand(`${ChatView.id}.focus`)
  }
}
