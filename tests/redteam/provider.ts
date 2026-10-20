#!/usr/bin/env bun
// promptfoo `exec:` provider: runs one red-team case (context.vars.case) against Bobi and prints the result as JSON.
// promptfoo passes: <prompt> <options JSON> <context JSON>.
import { findCase, realModel, runCase } from "./run.ts"

const context = JSON.parse(process.argv[4] ?? "{}") as { vars?: { case?: string } }
const id = context.vars?.case
if (!id) throw new Error("vars.case is required")
// Engine logs go to stderr; promptfoo only reads stdout.
const result = await runCase(findCase(id), { ...(realModel() ? { model: realModel()! } : {}) })
process.stdout.write(JSON.stringify(result))
process.exit(0)
