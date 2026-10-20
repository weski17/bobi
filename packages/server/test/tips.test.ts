import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS, type BobiConfig } from "@bobi/config"
import { handleTips } from "../src/index.ts"

let dir: string
beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-tips-")))
  await mkdir(path.join(dir, ".git"))
  await writeFile(path.join(dir, ".bobiignore"), "secret/\n")
})
afterAll(() => rm(dir, { recursive: true, force: true }))

const config = (tips: BobiConfig["tips"] = {}) => ({ ...structuredClone(DEFAULTS), tips })
const call = (body: unknown, tips: BobiConfig["tips"] = {}, method = "POST") =>
  handleTips(new Request("http://x/bobi/tips", { method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }), () => config(tips))
const code = "export function f(a: any, b: number) { return a == b }"

test("returns tips with the project's limits; nothing for ignored files or when off", async () => {
  const tips = (await (await call({ file: path.join(dir, "a.ts"), text: code })).json()).tips
  expect(tips.map((t: { rule: string }) => t.rule)).toEqual(["explicit-any", "loose-equality"])
  const strict = (await (await call({ file: path.join(dir, "a.ts"), text: code }, { parameters: 1 })).json()).tips
  expect(strict.map((t: { rule: string }) => t.rule)).toContain("parameters")
  expect((await (await call({ file: path.join(dir, "secret", "a.ts"), text: code })).json()).tips).toEqual([])
  expect((await (await call({ file: path.join(dir, "a.ts"), text: code }, { enabled: false })).json()).tips).toEqual([])
  expect((await call({ file: "a.ts", text: code })).status).toBe(400)
  expect((await call({ file: path.join(dir, "a.ts") })).status).toBe(400)
  expect((await call(undefined, {}, "GET")).status).toBe(405)
  const broken = await handleTips(new Request("http://x", { method: "POST", body: "{" }), () => config())
  expect(broken.status).toBe(400)
})
