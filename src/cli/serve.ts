import chalk from "chalk";
import { startServer } from "../mcp/server.js";

export async function serveCommand(): Promise<void> {
  // Log to stderr — stdout is reserved for MCP stdio transport
  process.stderr.write(
    chalk.dim("[layout-context]") +
      " MCP server starting on stdio transport...\n"
  );

  await startServer();
}
