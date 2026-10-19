// Bobi keeps its own data, config, cache and state under ~/.bobi (or $BOBI_HOME), separate from OpenCode.
import os from "node:os"
import path from "node:path"

export type BobiPaths = {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly log: string
  readonly bin: string
  readonly repos: string
  readonly database: string
}

export function bobiPaths(env: Record<string, string | undefined> = process.env): BobiPaths {
  const home = env.BOBI_HOME ?? path.join(os.homedir(), ".bobi")
  const data = path.join(home, "data")
  const cache = path.join(home, "cache")
  return {
    home,
    data,
    cache,
    config: path.join(home, "opencode"),
    state: path.join(home, "state"),
    log: path.join(data, "log"),
    bin: path.join(cache, "bin"),
    repos: path.join(data, "repos"),
    database: path.join(data, "bobi.db"),
  }
}
