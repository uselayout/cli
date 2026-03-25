import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadKit } from "../kit/loader.js";
import type { Kit } from "../kit/types.js";
import { startPreviewServer } from "../preview/server.js";
import { setPreviewServer } from "../preview/ensure.js";

const require = createRequire(import.meta.url);
// Resolves from dist/src/mcp/server.js → ../../../package.json
const pkg = require("../../../package.json") as { version: string };

// Tool modules
import * as getDesignSystem from "./tools/get-design-system.js";
import * as getTokens from "./tools/get-tokens.js";
import * as getComponent from "./tools/get-component.js";
import * as listComponents from "./tools/list-components.js";
import * as checkCompliance from "./tools/check-compliance.js";
import * as preview from "./tools/preview.js";
import * as pushToFigma from "./tools/push-to-figma.js";
import * as urlToFigma from "./tools/url-to-figma.js";
import * as designInFigma from "./tools/design-in-figma.js";
import * as updateTokens from "./tools/update-tokens.js";
import * as getScreenshots from "./tools/get-screenshots.js";
import * as checkSetup from "./tools/check-setup.js";

/**
 * Start the Layout Context MCP server.
 * Loads the kit from the current working directory and registers all tools.
 */
export async function startServer(): Promise<void> {
  const kit: Kit | null = loadKit();

  const kitName = kit?.manifest.displayName ?? "none";
  const componentCount = kit?.components.length ?? 0;

  // Log to stderr so it doesn't interfere with stdio transport
  console.error(
    `[layout-context] Kit: ${kitName} (${componentCount} components)`
  );

  // Start the preview server (HTTP + WebSocket on :4321)
  // If this fails, tools will auto-start it on demand via ensurePreviewServer()
  try {
    const server = await startPreviewServer(undefined, { openBrowser: false });
    setPreviewServer(server);
    console.error(`[layout-context] Preview: ${server.url}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[layout-context] Preview server skipped (will auto-start on demand): ${msg}`);
  }

  const server = new McpServer({
    name: "layout-context",
    version: pkg.version,
  });

  // Register all 12 tools
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

  server.tool(
    urlToFigma.name,
    urlToFigma.description,
    urlToFigma.inputSchema,
    urlToFigma.handler()
  );

  server.tool(
    designInFigma.name,
    designInFigma.description,
    designInFigma.inputSchema,
    designInFigma.handler(kit)
  );

  server.tool(
    updateTokens.name,
    updateTokens.description,
    updateTokens.inputSchema,
    updateTokens.handler()
  );

  server.tool(
    getScreenshots.name,
    getScreenshots.description,
    getScreenshots.inputSchema,
    getScreenshots.handler()
  );

  server.tool(
    checkSetup.name,
    checkSetup.description,
    checkSetup.inputSchema,
    checkSetup.handler()
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
