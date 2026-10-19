// The Bobi server on a real Node HTTP server (ADR-0013 follow-up): the engine's embedded router, @bobi/core as
// host plugin, Bobi's own authentication – and WebSocket upgrades, which a fetch handler cannot do (terminals).
import { appendFileSync, mkdirSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { NodeHttpServer } from "@effect/platform-node"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { hasPersistentPtyConnectTicketURL } from "@opencode/protocol/groups/persistent-pty"
import { hasPtyConnectTicketURL } from "@opencode/protocol/groups/pty"
import { ServerAuth } from "@opencode/server/auth"
import { authorizedRequest, unauthorizedResponse } from "@opencode/server/middleware/authorization"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Global } from "@opencode/util/global"
import { Context, Effect, Exit, Layer, Logger, ManagedRuntime, Option, References, Scope } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { Plugin } from "@opencode/plugin"
import type { BobiPaths } from "./paths.ts"

/** Bobi's own HTTP routes next to the engine API (autocomplete, A2A). */
export type BobiRoutes = {
  /** "public" routes need no password (e.g. a discovery document); "private" ones use the server password. */
  match(pathname: string): "public" | "private" | undefined
  handle(request: Request): Promise<Response>
}

export type NodeServerOptions = {
  readonly engine: Record<string, unknown>
  readonly routes?: BobiRoutes
  readonly paths: BobiPaths
  readonly plugin: Plugin.Plugin
  readonly password: string
  readonly hostname?: string
  readonly port?: number
}

export type NodeServer = { readonly url: string; stop(): Promise<void> }

/** Engine logs go to ~/.bobi/data/log/server.log, never to the terminal the UI draws on. */
function fileLogger(file: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const logger = Logger.make((options) => {
    try {
      appendFileSync(file, `${JSON.stringify(Logger.formatStructured.log(options))}\n`)
    } catch {
      // Logging must never break the server.
    }
  })
  return Layer.merge(Logger.layer([logger], { mergeWithExisting: false }), Layer.succeed(References.MinimumLogLevel, "Info"))
}

export async function startNodeServer(options: NodeServerOptions): Promise<NodeServer> {
  if (options.password.length < 16) throw new Error("server password must have at least 16 characters")
  const { paths } = options
  const overrides = [
    Global.node.replace(
      Global.layerWith({ data: paths.data, cache: paths.cache, config: paths.config, state: paths.state, log: paths.log, bin: paths.bin, repos: paths.repos }),
    ),
  ]
  const runtime = ManagedRuntime.make(
    createEmbeddedRoutes(options.engine as never, overrides).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(fileLogger(path.join(paths.log, "server.log"))),
    ),
  )
  const scope = await runtime.runPromise(Scope.make())
  try {
    const url = await runtime.runPromise(
      Effect.gen(function* () {
        const services = yield* runtime.contextEffect
        // A failing host plugin fails startup: there is no way to run without Bobi's safeguards.
        yield* Context.get(services, SdkPlugins.Service).register(PluginPromise.fromPromise(options.plugin))
        runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
        const router = Context.get(services, HttpRouter.HttpRouter).asHttpEffect()
        const auth = ServerAuth.Config.of({ password: Option.some(options.password), username: "opencode" })
        const app = Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          // Terminal WebSockets authenticate with one-time tickets issued to authenticated clients.
          const own = options.routes?.match(url.pathname)
          if (own) {
            if (own === "private" && !(yield* authorizedRequest(request, auth))) return unauthorizedResponse(request)
            const web = yield* HttpServerRequest.toWeb(request)
            return HttpServerResponse.fromWeb(yield* Effect.promise(() => options.routes!.handle(web)))
          }
          const ticket = hasPtyConnectTicketURL(url) || hasPersistentPtyConnectTicketURL(url)
          if (!ticket && !(yield* authorizedRequest(request, auth))) return unauthorizedResponse(request)
          return yield* router
        })
        const server = createServer()
        const http = yield* NodeHttpServer.make(() => server, { port: options.port ?? 0, host: options.hostname ?? "127.0.0.1" }).pipe(
          Effect.provideService(Scope.Scope, scope),
        )
        yield* http.serve(app).pipe(Effect.provide(NodeHttpServer.layerHttpServices), Effect.provideService(Scope.Scope, scope))
        yield* Scope.addFinalizer(scope, Effect.sync(() => server.closeAllConnections()))
        const address = http.address as { hostname?: string; port?: number }
        return `http://${options.hostname ?? "127.0.0.1"}:${address.port}`
      }),
    )
    return {
      url,
      async stop() {
        await runtime.runPromise(Scope.close(scope, Exit.void))
        await runtime.dispose()
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
