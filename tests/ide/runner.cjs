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

  // Literate coding: instructions as a comment at the cursor, Cmd+Alt+Enter (bobi.literate).
  // Type the instruction like a user does (the document may still be open from the diff).
  const doc = await vscode.workspace.openTextDocument(file)
  const editor = await vscode.window.showTextDocument(doc)
  await editor.edit((e) => e.insert(new vscode.Position(doc.lineCount - 1, 0), "// double the answer\n"))
  await doc.save()
  const line = doc.getText().split("\n").findIndex((l) => l.includes("double the answer"))
  editor.selection = new vscode.Selection(line, 3, line, 3)
  const pendingBefore = controller.pending.size
  await vscode.commands.executeCommand("bobi.literate")
  const literate = await wait(() => [...controller.pending.keys()].slice(pendingBefore)[0] ?? [...controller.pending.keys()][0], "literate approval")
  await controller.reply(literate, "once")
  await wait(() => fs.readFileSync(file, "utf8").includes("export const doubled = answer * 2"), "literate edit applied")

  // Commit message button in Source Control.
  const { execFileSync } = require("node:child_process")
  execFileSync("git", ["add", "app.ts"], { cwd: folder })
  await controller.idle()
  await vscode.commands.executeCommand("bobi.generateCommitMessage")
  const git = vscode.extensions.getExtension("vscode.git").exports.getAPI(1)
  await wait(() => git.repositories[0] && git.repositories[0].inputBox.value === "Double the answer", "commit message in the SCM input box")

  // Autocomplete: ghost text from the configured model, accepted with Tab (inlineSuggest.commit).
  const calcFile = path.join(folder, "calc.ts")
  fs.writeFileSync(calcFile, "import { answer } from './app'\nexport const triple = answer ")
  const calc = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(calcFile))
  const end = calc.document.positionAt(calc.document.getText().length)
  calc.selection = new vscode.Selection(end, end)
  await wait(async () => {
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    await new Promise((r) => setTimeout(r, 700))
    await vscode.commands.executeCommand("editor.action.inlineSuggest.commit")
    return calc.document.getText().endsWith("answer * 3")
  }, "inline suggestion accepted", 20000).catch((e) => {
    throw new Error(`${e.message}; last suggestion ${JSON.stringify(api.lastSuggestion)}; text ${JSON.stringify(calc.document.getText())}; focus ${vscode.window.state.focused}`)
  })

  fs.writeFileSync(path.join(folder, ".ide-test-passed"), "ok")
}
