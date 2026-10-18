// The `browser` tool. Every page load needs approval (action "browser", resource = URL, ADR-0005).
import type { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import { HeadlessBrowser, type PageResult } from "./page.ts"

type Context = Parameters<Plugin.Plugin["setup"]>[0]

export const TOOL_NAME = "browser"

const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "http(s) URL of the page to open" }),
})

const Output = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  text: Schema.String,
  truncated: Schema.Boolean,
})

export function format(page: PageResult): string {
  return `# ${page.title || "(untitled)"}\nURL: ${page.url}\n\n${page.text}${page.truncated ? "\n\n[truncated]" : ""}`
}

export async function registerBrowserTool(ctx: Context, browser: HeadlessBrowser = new HeadlessBrowser()) {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: TOOL_NAME,
      description:
        "Open a web page in a headless browser and return its title and visible text. JavaScript runs, so this works for pages that fetch content dynamically. Only http(s) URLs. Each page load asks the user for approval.",
      input: Input,
      output: Output,
      options: { codemode: false },
      execute: async ({ url }, context) => {
        const origin = (() => {
          try {
            return new URL(url).origin
          } catch {
            return url
          }
        })()
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          action: "browser",
          resources: [url],
          save: [`${origin}/*`],
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        const page = await browser.open(url)
        return { output: page, content: format(page) }
      },
    })
  })
  return browser
}
