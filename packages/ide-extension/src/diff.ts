// Shows edits proposed in an approval request in the diff editor before anything is written (requirement 9).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import type { PermissionRequest } from "./client.ts"
import { applyPatch } from "./patch.ts"

export const SCHEME = "bobi-proposed"

export class DiffPresenter implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>()
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changed.event

  constructor(private readonly root: string) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? ""
  }

  async show(request: PermissionRequest): Promise<void> {
    for (const preview of request.metadata?.files ?? []) {
      const absolute = path.resolve(this.root, preview.file)
      const current = existsSync(absolute) ? readFileSync(absolute, "utf8") : ""
      const proposed = applyPatch(current, preview.patch)
      const after = vscode.Uri.from({ scheme: SCHEME, path: absolute, query: `${request.id}:after` })
      this.contents.set(after.toString(), proposed)
      let before = vscode.Uri.file(absolute)
      if (!existsSync(absolute)) {
        before = vscode.Uri.from({ scheme: SCHEME, path: absolute, query: `${request.id}:before` })
        this.contents.set(before.toString(), "")
      }
      this.changed.fire(after)
      const name = path.basename(absolute)
      await vscode.commands.executeCommand("vscode.diff", before, after, `${name} ↔ proposed by Bobi`, { preview: true })
    }
  }
}
