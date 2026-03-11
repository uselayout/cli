import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";

const MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@superduperui/context", "serve"],
};

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

type Target = "claude" | "cursor" | "windsurf";

const TARGET_INFO: Record<Target, { label: string; configPath: string; serverKey: string }> = {
  claude: {
    label: "Claude Code",
    configPath: ".claude/settings.json",
    serverKey: "superduper",
  },
  cursor: {
    label: "Cursor",
    configPath: ".cursor/mcp.json",
    serverKey: "superduper",
  },
  windsurf: {
    label: "Windsurf",
    configPath: ".windsurf/mcp.json",
    serverKey: "superduper",
  },
};

function detectTargets(): Target[] {
  const cwd = process.cwd();
  const detected: Target[] = [];

  // Claude Code — check if `claude` CLI is available
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
    detected.push("claude");
  } catch {
    // Also detect by directory presence as fallback
    if (
      fs.existsSync(path.join(cwd, ".claude")) ||
      fs.existsSync(path.join(cwd, "CLAUDE.md"))
    ) {
      detected.push("claude");
    }
  }

  // Cursor — .cursor/ dir or .cursorrules
  if (
    fs.existsSync(path.join(cwd, ".cursor")) ||
    fs.existsSync(path.join(cwd, ".cursorrules"))
  ) {
    detected.push("cursor");
  }

  // Windsurf — .windsurf/ dir
  if (fs.existsSync(path.join(cwd, ".windsurf"))) {
    detected.push("windsurf");
  }

  return detected;
}

/**
 * Install for Claude Code using the `claude mcp add` CLI command.
 * This is the reliable way — writing settings.json directly doesn't always work.
 */
function addClaudeMcpServer(global: boolean): boolean {
  // Check if already installed via `claude mcp list`
  try {
    const list = execFileSync("claude", ["mcp", "list"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (list.includes("superduper")) {
      console.log(
        chalk.dim("  ↳"),
        "Claude Code: already configured"
      );
      return false;
    }
  } catch {
    // claude CLI not available or mcp list failed — try adding anyway
  }

  try {
    const args = ["mcp", "add"];
    if (global) {
      args.push("--scope", "user");
    }
    args.push("superduper", "--", "npx", "-y", "@superduperui/context", "serve");

    execFileSync("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

    const scopeLabel = global ? "globally" : "for this project";
    console.log(
      chalk.green("  ✓"),
      `Claude Code: registered ${scopeLabel} via claude mcp add`
    );
    return true;
  } catch {
    // Fallback to writing settings.json directly
    console.log(
      chalk.dim("  ↳"),
      "claude CLI not available, falling back to settings.json"
    );
    return addMcpServerViaFile("claude");
  }
}

/**
 * Install for Cursor/Windsurf by writing to their MCP config files.
 */
function addMcpServerViaFile(target: Target): boolean {
  const info = TARGET_INFO[target];
  const configFile = path.join(process.cwd(), info.configPath);
  const configDir = path.dirname(configFile);

  // Read existing config or start fresh
  let config: McpConfig = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as McpConfig;
    } catch {
      console.log(
        chalk.yellow("Warning:"),
        `Could not parse ${info.configPath}, creating new config.`
      );
    }
  }

  // Check if already configured
  if (config.mcpServers && info.serverKey in config.mcpServers) {
    console.log(
      chalk.dim("  ↳"),
      `${info.label}: already configured in ${info.configPath}`
    );
    return false;
  }

  // Add the server
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  config.mcpServers[info.serverKey] = MCP_CONFIG;

  // Write config
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  console.log(
    chalk.green("  ✓"),
    `${info.label}: added to ${info.configPath}`
  );
  return true;
}

export async function installCommand(options: {
  target?: string;
  global?: boolean;
}): Promise<void> {
  console.log();
  console.log(chalk.bold("SuperDuper — Installing MCP server"));
  if (options.global) {
    console.log(chalk.dim("  Scope: global (available in all projects)"));
  } else {
    console.log(chalk.dim("  Scope: project (this project only)"));
  }
  console.log();

  // Check .superduper/ exists
  const hasSuperduper = fs.existsSync(
    path.join(process.cwd(), ".superduper")
  );
  if (!hasSuperduper) {
    console.log(
      chalk.yellow("Note:"),
      "No .superduper/ directory found. Run",
      chalk.cyan("npx @superduperui/context init"),
      "first, or import a Studio export ZIP."
    );
    console.log();
  }

  let targets: Target[];

  if (options.target) {
    const t = options.target.toLowerCase() as Target;
    if (!(t in TARGET_INFO)) {
      console.log(
        chalk.red("Error:"),
        `Unknown target "${options.target}". Use: claude, cursor, or windsurf`
      );
      return;
    }
    targets = [t];
  } else {
    // Auto-detect
    targets = detectTargets();
    if (targets.length === 0) {
      console.log(
        chalk.dim("  No AI coding tools detected. Installing for Claude Code by default.")
      );
      targets = ["claude"];
    } else {
      console.log(
        chalk.dim(`  Detected: ${targets.map((t) => TARGET_INFO[t].label).join(", ")}`)
      );
    }
  }

  console.log();

  let installed = 0;
  for (const target of targets) {
    if (target === "claude") {
      if (addClaudeMcpServer(options.global ?? false)) installed++;
    } else {
      if (addMcpServerViaFile(target)) installed++;
    }
  }

  console.log();

  if (installed > 0) {
    console.log(chalk.green("Done!"), "Your AI agent now has access to your design system.");
    console.log();
    console.log(chalk.yellow("→"), "Restart your AI coding tool to activate the MCP server.");
    console.log();
    console.log(chalk.dim("  When building UI, your agent will automatically use your"));
    console.log(chalk.dim("  design tokens, components, and brand rules to stay on-brand."));
    console.log();
    console.log(chalk.bold("Optional: Enable Figma integration"));
    console.log();
    console.log(chalk.dim("  For push-to-Figma and URL-to-Figma features, connect these MCP servers:"));
    console.log();
    console.log(`  ${chalk.cyan("claude mcp add --transport http figma https://mcp.figma.com/mcp")}`);
    console.log(chalk.dim("    Push components and designs to Figma (OAuth — no API key needed)"));
    console.log();
    console.log(chalk.dim("  Playwright MCP is also needed for URL-to-Figma capture."));
  } else {
    console.log(chalk.dim("  Nothing to do — all targets already configured."));
  }

  console.log();
}
