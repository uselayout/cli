import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadKit } from "../kit/loader.js";
import type { Kit } from "../kit/types.js";
import { startPreviewServer } from "../preview/server.js";

// Tool modules
import * as getDesignSystem from "./tools/get-design-system.js";
import * as getTokens from "./tools/get-tokens.js";
import * as getComponent from "./tools/get-component.js";
import * as listComponents from "./tools/list-components.js";
import * as checkCompliance from "./tools/check-compliance.js";
import * as preview from "./tools/preview.js";
import * as pushToFigma from "./tools/push-to-figma.js";

/**
 * Start the SuperDuper UI Context MCP server.
 * Loads the kit from the current working directory and registers all tools.
 */
export async function startServer(): Promise<void> {
  const kit: Kit | null = loadKit();

  const kitName = kit?.manifest.displayName ?? "none";
  const componentCount = kit?.components.length ?? 0;

  // Log to stderr so it doesn't interfere with stdio transport
  console.error(
    `[superduperui-context] Kit: ${kitName} (${componentCount} components)`
  );

  // Start the preview server (HTTP + WebSocket on :4321)
  try {
    const previewServer = await startPreviewServer();
    console.error(`[superduperui-context] Preview: ${previewServer.url}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[superduperui-context] Preview server skipped: ${msg}`);
  }

  const server = new McpServer({
    name: "superduperui-context",
    version: "0.1.0",
  });

  // Register all 7 tools
  server.tool(
    getDesignSystem.name,
    getDesignSystem.description,
    getDesignSystem.inputSchema,
    getDesignSystem.handler(kit)
  );

  server.tool(
    getTokens.name,
    getTokens.description,
    getTokens.inputSchema,
    getTokens.handler(kit)
  );

  server.tool(
    getComponent.name,
    getComponent.description,
    getComponent.inputSchema,
    getComponent.handler(kit)
  );

  server.tool(
    listComponents.name,
    listComponents.description,
    listComponents.inputSchema,
    listComponents.handler(kit)
  );

  server.tool(
    checkCompliance.name,
    checkCompliance.description,
    checkCompliance.inputSchema,
    checkCompliance.handler(kit)
  );

  server.tool(
    preview.name,
    preview.description,
    preview.inputSchema,
    preview.handler(kit)
  );

  server.tool(
    pushToFigma.name,
    pushToFigma.description,
    pushToFigma.inputSchema,
    pushToFigma.handler(kit)
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
