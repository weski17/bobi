// Code tips over HTTP (requirement 14): POST /bobi/tips with { file, text } returns local analysis results.
// No model call; .bobiignore'd files and projects with tips.enabled: false get none.
import path from "node:path"
import { findProjectRoot, type BobiConfig } from "@bobi/config"
import { BobiIgnore } from "@bobi/core"
import { analyze } from "@bobi/tips"

export const TIPS_PATH = "/bobi/tips"

export async function handleTips(request: Request, projectConfig: (project: string) => BobiConfig): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "use POST" }, { status: 405 })
  const input = (await request.json().catch(() => undefined)) as { file?: unknown; text?: unknown } | undefined
  if (!input || typeof input.file !== "string" || !path.isAbsolute(input.file) || typeof input.text !== "string")
    return Response.json({ error: "file (absolute path) and text are required" }, { status: 400 })
  const project = findProjectRoot(path.dirname(input.file))
  const { enabled, ...limits } = projectConfig(project).tips
  if (enabled === false || new BobiIgnore(project).ignores(input.file)) return Response.json({ tips: [] })
  return Response.json({ tips: analyze(input.file, input.text, limits) })
}
