import { execFileSync } from "node:child_process";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface McpServerEntry {
  name: string;
  scope: "user" | "project" | "unknown";
  transport: "http" | "stdio" | "unknown";
  raw: string;
}

export interface McpRegistrationState {
  /** Raw output from `claude mcp list` */
  rawOutput: string;
  /** All detected MCP servers */
  servers: McpServerEntry[];
  /** Figma-specific state */
  figma: {
    registered: boolean;
    entry?: McpServerEntry;
    /** True if a plugin-provided entry shadows the proper registration */
    pluginShadow: boolean;
    /** True if transport is http (required for OAuth) */
    correctTransport: boolean;
    /** True if registered at user scope */
    correctScope: boolean;
    /** True if using the old figma-developer-mcp npm package (stdio, only 2 tools) */
    isOldNpmPackage?: boolean;
  };
  /** Playwright state */
  playwright: {
    registered: boolean;
    entry?: McpServerEntry;
  };
  /** Layout state */
  layout: {
    registered: boolean;
    entry?: McpServerEntry;
  };
}

export interface FixResult {
  server: string;
  success: boolean;
  message: string;
}

/* ------------------------------------------------------------------ */
/*  Check MCP registration                                             */
/* ------------------------------------------------------------------ */

/**
 * Run `claude mcp list` and parse the output into structured state.
 * Returns null if the Claude CLI is unavailable.
 */
export function checkMcpRegistration(): McpRegistrationState | null {
  let rawOutput: string;
  try {
    rawOutput = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }

  const servers = parseMcpList(rawOutput);
  const lower = rawOutput.toLowerCase();

  // Figma analysis
  const figmaEntry = servers.find((s) => s.name === "figma");
  const hasPluginShadow =
    lower.includes("figma@claude-plugins") ||
    lower.includes("claude-plugins-official");

  // Playwright analysis
  const playwrightEntry = servers.find((s) => s.name === "playwright");

  // Layout analysis
  const layoutEntry = servers.find(
    (s) => s.name === "layout" || s.name === "layoutdesign"
  );

  // Detect old figma-developer-mcp npm package (only has 2 tools, uses stdio)
  const isOldNpmPackage = figmaEntry?.transport === "stdio" && !hasPluginShadow;

  return {
    rawOutput,
    servers,
    figma: {
      registered: !!figmaEntry,
      entry: figmaEntry,
      pluginShadow: hasPluginShadow,
      correctTransport: figmaEntry?.transport === "http",
      correctScope: figmaEntry?.scope === "user",
      isOldNpmPackage,
    },
    playwright: {
      registered: !!playwrightEntry,
      entry: playwrightEntry,
    },
    layout: {
      registered: !!layoutEntry,
      entry: layoutEntry,
    },
  };
}

/**
 * Parse `claude mcp list` output into individual server entries.
 *
 * The output format varies but typically looks like:
 *   name: figma (user, http)
 *   name: layout (project, stdio)
 *
 * We parse flexibly to handle format changes.
 */
function parseMcpList(raw: string): McpServerEntry[] {
  const entries: McpServerEntry[] = [];
  const lines = raw.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    // Skip headers, separators, empty lines
    if (!lower || lower.startsWith("─") || lower.startsWith("=")) continue;

    // Try to extract server name — look for common patterns
    // Pattern: "name: serverName" or "serverName (scope, transport)" or just "serverName"
    let name: string | undefined;
    let scope: McpServerEntry["scope"] = "unknown";
    let transport: McpServerEntry["transport"] = "unknown";

    // Pattern: "  serverName    type: stdio    scope: user"
    const colonMatch = lower.match(
      /^\s*(\S+)\s+.*?type:\s*(http|stdio).*?scope:\s*(user|project)/
    );
    if (colonMatch) {
      name = colonMatch[1];
      transport = colonMatch[2] as McpServerEntry["transport"];
      scope = colonMatch[3] as McpServerEntry["scope"];
    }

    // Pattern: "serverName (user, http)" or "serverName  http  user"
    if (!name) {
      const parenMatch = lower.match(/^\s*(\S+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        name = parenMatch[1];
        const inner = parenMatch[2]!;
        if (inner.includes("http")) transport = "http";
        else if (inner.includes("stdio")) transport = "stdio";
        if (inner.includes("user")) scope = "user";
        else if (inner.includes("project")) scope = "project";
      }
    }

    // Fallback: just grab the first word if the line contains known server names
    if (!name) {
      const words = lower.split(/\s+/);
      const knownNames = ["figma", "layout", "layoutdesign", "playwright"];
      const found = words.find((w) => knownNames.includes(w));
      if (found) {
        name = found;
        // Try to infer transport and scope from rest of line
        if (lower.includes("http")) transport = "http";
        else if (lower.includes("stdio")) transport = "stdio";
        if (lower.includes("user")) scope = "user";
        else if (lower.includes("project")) scope = "project";
      }
    }

    if (name) {
      entries.push({ name, scope, transport, raw: line.trim() });
    }
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/*  Fix / register MCP servers                                         */
/* ------------------------------------------------------------------ */

/**
 * Register Figma MCP server via `claude mcp add --scope user --transport http`.
 *
 * Important: we always attempt registration and let `claude mcp add` handle
 * the "already registered" case. The plugin-provided registration
 * (`figma@claude-plugins-official`) uses OAuth that doesn't persist between
 * sessions, so we must ensure a proper user-scoped entry exists.
 */
export function addFigmaMcpServer(): FixResult {
  // First, remove any existing figma entry (may be the old npm package)
  try {
    execFileSync("claude", ["mcp", "remove", "figma"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Ignore — may not exist
  }

  try {
    execFileSync(
      "claude",
      [
        "mcp", "add", "--scope", "user", "--transport", "http",
        "figma", "https://mcp.figma.com/mcp",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    return {
      server: "figma",
      success: true,
      message: "Registered official Figma MCP (OAuth — authenticate once in Claude Code)",
    };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    if (stderr.includes("already") || stderr.includes("exists")) {
      return {
        server: "figma",
        success: true,
        message: "Already configured at user scope",
      };
    }
    return {
      server: "figma",
      success: false,
      message:
        "Could not register automatically. Run manually: claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp",
    };
  }
}

/**
 * Register Playwright MCP server via `claude mcp add --scope user`.
 */
export function addPlaywrightMcpServer(): FixResult {
  // Check if already registered
  try {
    const list = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (list.toLowerCase().includes("playwright")) {
      return {
        server: "playwright",
        success: true,
        message: "Already configured",
      };
    }
  } catch {
    return {
      server: "playwright",
      success: false,
      message: "Could not check MCP list",
    };
  }

  try {
    execFileSync(
      "claude",
      [
        "mcp", "add", "--scope", "user",
        "playwright", "--", "npx", "-y", "@anthropic-ai/mcp-playwright",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    return {
      server: "playwright",
      success: true,
      message: "Registered globally",
    };
  } catch {
    return {
      server: "playwright",
      success: false,
      message:
        "Could not register automatically. Run manually: claude mcp add --scope user playwright -- npx -y @anthropic-ai/mcp-playwright",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Check .claude.json for old Figma entries                           */
/* ------------------------------------------------------------------ */

/**
 * Check ~/.claude.json for an outdated figma-developer-mcp entry that
 * shadows the correct HTTP registration. Returns true if fixed.
 */
export function fixGlobalClaudeJson(): boolean {
  const { readFileSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { homedir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");

  const configPath = join(homedir(), ".claude.json");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, Record<string, unknown>> | undefined;
    if (!servers?.figma) return false;

    const figma = servers.figma;
    const isOldNpm =
      figma.type === "stdio" ||
      (figma.command === "npx" &&
        Array.isArray(figma.args) &&
        (figma.args as string[]).some((a: string) => a.includes("figma-developer-mcp")));

    if (!isOldNpm) return false;

    // Replace with official HTTP server
    servers.figma = {
      type: "http",
      url: "https://mcp.figma.com/mcp",
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Endpoint reachability                                              */
/* ------------------------------------------------------------------ */

/**
 * Test whether an HTTP endpoint is reachable (HEAD request with timeout).
 */
export async function testEndpointReachable(
  url: string,
  timeoutMs = 5_000
): Promise<{ reachable: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { reachable: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: msg };
  }
}
