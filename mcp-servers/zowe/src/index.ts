export { MainframeClient, RestError } from "./client.ts"
export type { Dataset, Job, RestOptions, SpoolFile } from "./client.ts"
export { allowedDataset, checkDataset, checkMember, ConnectionError, datasetMatches, loadConnection, requireDataset, requireUssPath, zoweConfigFiles, zoweConfigured } from "./connection.ts"
export type { Connection } from "./connection.ts"
export { createServer, jclDatasets, jclProblems, runTool, SERVER_NAME, TOOLS, VERSION, WRITE_TOOLS } from "./server.ts"
import path from "node:path"
/** Command line that starts the server for a project (used by @bobi/server as a built-in MCP server). */
export const CLI = path.join(import.meta.dir, "cli.ts")
export { startMockMainframe } from "./mock.ts"
export type { MockMainframe } from "./mock.ts"
