// Runs inside Bobi IDE's extension host (--extensionTestsPath). Plain CommonJS: no test framework needed.
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vscode = require("vscode")

const wait = async (check, label, ms = 30000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out: ${label}`)
}

exports.run = async function run() {
  const ext = await wait(() => vscode.extensions.getExtension("bobi.bobi-chat"), "extension present")
  const api = await ext.activate()
  await api.started
  const controller = await wait(() => api.controller, "Bobi server started")
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath
  const file = path.join(folder, "app.ts")

  // The built-in Copilot chat UI is off by default; Bobi's own panel works regardless.
  assert.strictEqual(vscode.workspace.getConfiguration("chat").get("disableAIFeatures"), true, "built-in AI features disabled")
  const commands = await vscode.commands.getCommands(true)
  for (const c of ["bobi.newSession", "bobi.undo", "bobi.selectMode", "bobi.restartServer", "bobi.chat.focus"]) assert.ok(commands.includes(c), `command ${c}`)
  await vscode.commands.executeCommand("bobi.chat.focus")

  await controller.send("fix the answer")
  // The proposed change opens in the diff editor before anything is written.
  const tab = await wait(
    () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputTextDiff && t.label.includes("proposed by Bobi")),
    "diff editor with the proposal",
  )
  assert.strictEqual(fs.readFileSync(file, "utf8"), "export const answer = 41\n", "file unchanged before approval")
  const proposed = await vscode.workspace.openTextDocument(tab.input.modified)
  assert.strictEqual(proposed.getText(), "export const answer = 42\n", "diff shows the proposal")

  const pending = await wait(() => [...controller.pending.keys()][0], "pending approval")
  await controller.reply(pending, "once")
  await wait(() => fs.readFileSync(file, "utf8") === "export const answer = 42\n", "file written after approval")

  assert.strictEqual(await controller.undo(), true)
  assert.strictEqual(fs.readFileSync(file, "utf8"), "export const answer = 41\n", "undo restored the file")
  fs.writeFileSync(path.join(folder, ".ide-test-passed"), "ok")
}
