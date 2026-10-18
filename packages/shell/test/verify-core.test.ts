import { afterEach, expect, test } from "bun:test"
import { LaunchError, verifyCore } from "../src/launcher.ts"

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  server?.stop(true)
  server = undefined
})

const plugin = (id: string, state: Record<string, unknown> = { status: "active" }) => ({
  id,
  source: { type: "local", path: "/x" },
  features: { server: true },
  state,
})

function fakeServer(pages: unknown[][]) {
  let call = 0
  const auth: string[] = []
  server = Bun.serve({
    port: 0,
    fetch(request) {
      auth.push(request.headers.get("authorization") ?? "")
      const data = pages[Math.min(call++, pages.length - 1)]
      return Response.json({ location: { directory: "/p" }, data })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, password: "pw", auth }
}

test("passes when bobi.core is active, waiting for plugins to load", async () => {
  const s = fakeServer([[], [], [plugin("opencode.agent"), plugin("bobi.core")]])
  await verifyCore(s, "/p")
  expect(s.auth[0]).toBe(`Basic ${btoa("opencode:pw")}`)
})

test("fails closed when bobi.core is missing", async () => {
  const s = fakeServer([[plugin("opencode.agent")]])
  await expect(verifyCore(s, "/p")).rejects.toThrow(/was not loaded/)
})

test("fails closed when bobi.core failed to start", async () => {
  const s = fakeServer([[plugin("bobi.core", { status: "failed", error: "boom" })]])
  const error = await verifyCore(s, "/p").catch((e) => e)
  expect(error).toBeInstanceOf(LaunchError)
  expect(error.message).toContain("boom")
})

test("fails closed when no plugin generation appears in time", async () => {
  const s = fakeServer([[]])
  await expect(verifyCore(s, "/p", 300)).rejects.toThrow(/was not loaded/)
})
