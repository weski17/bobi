// Bobi IDE extension: starts the Bobi server for the workspace and provides the chat panel (phase 4).
import * as vscode from "vscode"
import { ChatView, type FromUi } from "./chatView.ts"
import { BobiClient } from "./client.ts"
import { contextFiles, withSelection } from "./context.ts"
import { ChatController } from "./controller.ts"
import { DiffPresenter, SCHEME } from "./diff.ts"
import { resolveCommand, startBobi, trust, type RunningBobi } from "./server.ts"

let running: RunningBobi | undefined
let controller: ChatController | undefined

/** Returned from activate(); used by the IDE integration test. */
export type BobiApi = { readonly started: Promise<void>; readonly controller: ChatController | undefined }

function config() {
  const c = vscode.workspace.getConfiguration("bobi")
  return { command: resolveCommand(c.get<string[]>("command") ?? []), includeOpenTabs: c.get<boolean>("includeOpenTabs") ?? true }
}

/** Project trust (ADR-0014) as a modal dialog, like workspace trust. */
async function ensureTrust(command: string[], folder: string): Promise<void> {
  const state = await trust(command, folder, "status")
  if (state.status !== "unknown") return
  const choice = await vscode.window.showWarningMessage(
    "This project contains files that instruct or configure Bobi. Trust it?",
    { modal: true, detail: `${state.files.join("\n")}\n\nRules, modes and settings (including auto-approvals) are used only if you trust this project.` },
    "Trust",
    "Don't Trust",
  )
  await trust(command, folder, choice === "Trust" ? "yes" : "no")
}

function context(folder: string) {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).flatMap((t) => (t.input instanceof vscode.TabInputText ? [{ fsPath: t.input.uri.fsPath, scheme: t.input.uri.scheme }] : []))
  const editor = vscode.window.activeTextEditor
  const selection =
    editor && !editor.selection.isEmpty
      ? { fsPath: editor.document.uri.fsPath, startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1, text: editor.document.getText(editor.selection) }
      : undefined
  return { files: contextFiles(folder, tabs, editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined), selection }
}

export function activate(extension: vscode.ExtensionContext): BobiApi {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const diff = new DiffPresenter(folder ?? "/")
  let view: ChatView
  const handle = async (m: FromUi) => {
    try {
      if (!controller) return
      if (m.type === "send") {
        const settings = config()
        const ctx = settings.includeOpenTabs ? context(folder!) : { files: [], selection: undefined }
        await controller.send(withSelection(m.text, folder!, ctx.selection), ctx.files)
      } else if (m.type === "reply") await controller.reply(m.id, m.decision)
      else if (m.type === "mode") await controller.setMode(m.mode)
      else if (m.type === "stop") await controller.stopRequest()
      else if (m.type === "new") controller.newChat()
      else if (m.type === "undo") view.post({ type: "info", message: (await controller.undo()) ? "Undone: the last request's changes were reverted." : "Nothing to undo." })
    } catch (error) {
      view.post({ type: "error", message: (error as Error).message })
    }
  }
  view = new ChatView(extension.extensionUri, (m) => void handle(m))
  extension.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatView.id, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff),
    vscode.commands.registerCommand("bobi.newSession", () => controller?.newChat()),
    vscode.commands.registerCommand("bobi.undo", () => handle({ type: "undo" })),
    vscode.commands.registerCommand("bobi.selectMode", async () => {
      const pick = await vscode.window.showQuickPick(["code", "plan", "ask", "advanced", "orchestrator"], { placeHolder: "Bobi mode" })
      if (pick) await handle({ type: "mode", mode: pick })
    }),
    vscode.commands.registerCommand("bobi.restartServer", async () => {
      await stop()
      if (folder) await start(folder, view, diff)
    }),
  )
  const started = folder ? start(folder, view, diff) : Promise.resolve(view.post({ type: "info", message: "Open a folder to work with Bobi." }))
  return {
    started,
    get controller() {
      return controller
    },
  }
}

async function start(folder: string, view: ChatView, diff: DiffPresenter) {
  const { command } = config()
  try {
    await ensureTrust(command, folder)
    running = await startBobi(command, folder)
    controller = new ChatController(new BobiClient(running.url, running.password), folder, {
      post: (m) => view.post(m),
      showDiff: (r) => diff.show(r),
      error: (message) => view.post({ type: "error", message }),
    })
    await controller.start()
  } catch (error) {
    const message = `Bobi could not start: ${(error as Error).message}`
    view.post({ type: "error", message })
    void vscode.window.showErrorMessage(message, "Open Settings").then((c) => c && vscode.commands.executeCommand("workbench.action.openSettings", "bobi.command"))
  }
}

async function stop() {
  controller?.stop()
  controller = undefined
  await running?.stop()
  running = undefined
}

export function deactivate() {
  return stop()
}
