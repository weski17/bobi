# Upstream proposal: expose the embedded request handler in `@opencode/sdk`

Status: **draft, not submitted** – to be submitted by the project owner if wanted.
Target: `anomalyco/opencode`, package `packages/sdk`.

## Problem

`OpenCode.create()` (Promise SDK) embeds the full server router in-process, but only returns a typed client.
Applications that want to serve that router over their own HTTP listener (own authentication, own process
model) have to import the internal module `packages/sdk/src/internal/host.ts`, which is not part of the
package's `exports` and may change without notice. Bobi does this today (`packages/server/src/host.ts`).

## Proposal

Return the embedded host's web `fetch` handler from the Promise and Effect SDK:

```diff
--- a/packages/sdk/src/promise.ts
+++ b/packages/sdk/src/promise.ts
@@ export type Interface = Omit<OpenCodeClient, "plugin"> & {
   readonly sessions: OpenCodeClient["session"]
   readonly events: OpenCodeClient["event"]
   readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
+  /** The embedded router as a web fetch handler, e.g. to serve it with Bun.serve or a Worker. */
+  readonly fetch: (request: Request) => Promise<Response>
   readonly close: () => Promise<void>
@@ export async function create(
   return {
     ...client,
     sessions: client.session,
     events: client.event,
     plugin: Object.assign(register, client.plugin),
+    fetch: host.fetch,
     close: host.close,
```

Also forward `EmbedOptions.overrides` documentation (already supported as the second argument) so embedders can
place data under their own directories.

## Why upstream benefits

- Lets any embedder put the router behind its own listener without a second HTTP hop.
- No behaviour change for existing users; additive API.
