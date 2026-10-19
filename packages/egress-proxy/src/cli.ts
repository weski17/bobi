#!/usr/bin/env bun
// bobi-egress-proxy: BOBI_EGRESS_ALLOW="host:port,*.domain:443" or BOBI_EGRESS_ALLOW_FILE=/path
import { readFileSync } from "node:fs"
import { parseAllowlist } from "./allowlist.ts"
import { startProxy } from "./proxy.ts"

const text = process.env.BOBI_EGRESS_ALLOW_FILE ? readFileSync(process.env.BOBI_EGRESS_ALLOW_FILE, "utf8") : (process.env.BOBI_EGRESS_ALLOW ?? "")
const rules = parseAllowlist(text)
const proxy = startProxy({ rules, hostname: process.env.BOBI_EGRESS_HOST ?? "0.0.0.0", port: Number(process.env.BOBI_EGRESS_PORT ?? 3128) })
console.log(JSON.stringify({ proxy: proxy.url, allow: rules.map((r) => `${r.wildcard ? "*." : ""}${r.host}:${r.port}`) }))
