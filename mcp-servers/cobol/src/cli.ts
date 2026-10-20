#!/usr/bin/env bun
// bobi-mcp-cobol [project-dir] – MCP server over stdio. Default project: the current directory.
import path from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { createServer } from "./server.ts"

await createServer(path.resolve(process.argv[2] ?? process.cwd())).connect(new StdioServerTransport())
