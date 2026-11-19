// Starts `bobi serve` for a workspace folder and runs `bobi trust`. The IDE's PATH (when launched from the Dock)
// often lacks Homebrew and Bun, so common locations are added.
import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type TrustState = { project: string; status: "none" | "trusted" | "untrusted" | "unknown"; files: string[] }
export type RunningBobi = { url: string; password: string; stop(): Promise<void> }

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".bun", "bin"), path.join(os.homedir(), ".local", "bin")]

export function bobiEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const parts = (base.PATH ?? "").split(path.delimiter).filter(Boolean)
  for (const extra of EXTRA_PATH) if (!parts.includes(extra)) parts.push(extra)
  return { ...base, PATH: parts.join(path.delimiter), NO_COLOR: "1" }
}

/** The command that runs Bobi: setting, else `bobi` from ~/.local/bin (scripts/install.sh), else `bobi` on PATH. */
/**
 * The `bobi.command` setting, from the user's own settings only. A workspace (`.vscode/settings.json`) or folder value
 * is ignored: a repository must never choose which program the IDE starts (security review 2026-11-19, K2). The
 * manifest also declares the setting machine-scoped and restricted in untrusted workspaces.
 */
export function userCommand(inspected: { globalValue?: unknown } | undefined): string[] {
  const value = inspected?.globalValue
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? [...value] : []
}

export function resolveCommand(configured: readonly string[] = [], home = os.homedir()): string[] {
  if (configured.length) return [...configured]
  const installed = path.join(home, ".local", "bin", "bobi")
  return existsSync(installed) ? [installed] : ["bobi"]
}

function collect(child: ChildProcess): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (d) => (stdout += d))
  child.stderr?.on("data", (d) => (stderr += d))
  return new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

export async function trust(command: readonly string[], directory: string, action: "status" | "yes" | "no"): Promise<TrustState> {
  const [bin, ...args] = command
  const result = await collect(spawn(bin!, [...args, "trust", `--${action}`, directory], { env: bobiEnv(), stdio: ["ignore", "pipe", "pipe"] }))
  if (result.code !== 0) throw new Error(`bobi trust failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as TrustState
}

export function startBobi(command: readonly string[], directory: string, timeoutMs = 60_000): Promise<RunningBobi> {
  const password = randomBytes(24).toString("base64url")
  const [bin, ...args] = command
  const child = spawn(bin!, [...args, "serve", "--port", "0"], {
    cwd: directory,
    env: { ...bobiEnv(), BOBI_SERVER_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  child.stderr?.on("data", (d) => (stderr += d))
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => fail(new Error(`Bobi server did not start within ${timeoutMs / 1000}s`)), timeoutMs)
    const fail = (error: Error) => {
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${error.message}${stderr ? `\n${stderr.trim()}` : ""}`))
    }
    child.on("error", fail)
    // "close" (not "exit") fires after stdout/stderr are drained, so the error output is complete.
    child.on("close", (code) => fail(new Error(`Bobi server exited with code ${code}`)))
    child.stdout?.on("data", (data) => {
      buffer += data
      const line = buffer.split("\n").find((l) => l.trim().startsWith("{"))
      if (!line) return
      clearTimeout(timer)
      child.removeAllListeners("close")
      const { url } = JSON.parse(line) as { url: string }
      resolve({
        url,
        password,
        stop: () =>
          new Promise((done) => {
            if (child.exitCode !== null || child.signalCode !== null) return done()
            child.once("exit", () => done())
            child.kill("SIGTERM")
            setTimeout(() => child.kill("SIGKILL"), 5000).unref()
          }),
      })
    })
  })
}
