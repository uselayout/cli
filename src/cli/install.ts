import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import {
  addFigmaMcpServer as sharedAddFigma,
  addPlaywrightMcpServer as sharedAddPlaywright,
} from "./setup-utils.js";
import { installLive, detectFramework, isPluginWired } from "../install/live.js";
import { fetchKitFromGallery } from "./fetch-kit.js";

const MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@layoutdesign/context", "serve"],
};

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

type Target = "claude" | "cursor" | "windsurf" | "vscode" | "codex" | "gemini";

const TARGET_INFO: Record<Target, { label: string; configPath: string; serverKey: string }> = {
  claude: {
    label: "Claude Code",
    configPath: ".claude/settings.json",
    serverKey: "layout",
  },
  cursor: {
    label: "Cursor",
    configPath: ".cursor/mcp.json",
    serverKey: "layout",
  },
  windsurf: {
    label: "Windsurf",
    configPath: ".windsurf/mcp.json",
    serverKey: "layout",
  },
  vscode: {
    label: "VS Code / Copilot",
    configPath: ".vscode/mcp.json",
    serverKey: "layout",
  },
  codex: {
    label: "Codex CLI",
    configPath: ".codex/config.json",
    serverKey: "layout",
  },
  gemini: {
    label: "Gemini CLI",
    configPath: ".gemini/settings.json",
    serverKey: "layout",
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

  // Cursor — project-local .cursor/ or .cursorrules, OR the user-level ~/.cursor
  // (matches the Codex/Gemini global fallback below; Claude is detected globally
  // too). Without the home-dir fallback, a Cursor user running install in a
  // project that has no .cursor/ marker silently gets Claude only.
  if (
    fs.existsSync(path.join(cwd, ".cursor")) ||
    fs.existsSync(path.join(cwd, ".cursorrules")) ||
    fs.existsSync(path.join(os.homedir(), ".cursor"))
  ) {
    detected.push("cursor");
  }

  // Windsurf — .windsurf/ dir
  if (fs.existsSync(path.join(cwd, ".windsurf"))) {
    detected.push("windsurf");
  }

  // VS Code / GitHub Copilot — .vscode/ dir
  if (fs.existsSync(path.join(cwd, ".vscode"))) {
    detected.push("vscode");
  }

  // Codex CLI — check if `codex` CLI is available or ~/.codex/ exists
  try {
    execFileSync("which", ["codex"], { stdio: "ignore" });
    detected.push("codex");
  } catch {
    if (fs.existsSync(path.join(os.homedir(), ".codex"))) {
      detected.push("codex");
    }
  }

  // Gemini CLI — check if `gemini` CLI is available or ~/.gemini/ exists
  try {
    execFileSync("which", ["gemini"], { stdio: "ignore" });
    detected.push("gemini");
  } catch {
    if (fs.existsSync(path.join(os.homedir(), ".gemini"))) {
      detected.push("gemini");
    }
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
    if (list.includes("layout")) {
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
    args.push("layout", "--", "npx", "-y", "@layoutdesign/context", "serve");

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

interface VsCodeMcpConfig {
  inputs?: unknown[];
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

function addMcpServerViaVsCode(): boolean {
  const configFile = path.join(process.cwd(), ".vscode", "mcp.json");
  const configDir = path.dirname(configFile);

  let config: VsCodeMcpConfig = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as VsCodeMcpConfig;
    } catch {
      console.log(
        chalk.yellow("Warning:"),
        "Could not parse .vscode/mcp.json, creating new config."
      );
    }
  }

  if (config.servers && "layout" in config.servers) {
    console.log(chalk.dim("  ↳"), "VS Code / Copilot: already configured in .vscode/mcp.json");
    return false;
  }

  if (!config.servers) config.servers = {};
  config.servers.layout = {
    type: "stdio",
    command: "npx",
    args: ["-y", "@layoutdesign/context", "serve"],
  };

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  console.log(chalk.green("  ✓"), "VS Code / Copilot: added to .vscode/mcp.json");
  return true;
}

function addMcpServerGlobal(target: "codex" | "gemini"): boolean {
  const info = TARGET_INFO[target];
  const configFile = path.join(os.homedir(), info.configPath);
  const configDir = path.dirname(configFile);

  let config: McpConfig = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, "utf-8")) as McpConfig;
    } catch {
      console.log(
        chalk.yellow("Warning:"),
        `Could not parse ~/${info.configPath}, creating new config.`
      );
    }
  }

  if (config.mcpServers && info.serverKey in config.mcpServers) {
    console.log(
      chalk.dim("  ↳"),
      `${info.label}: already configured in ~/${info.configPath}`
    );
    return false;
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  config.mcpServers[info.serverKey] = MCP_CONFIG;

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");

  console.log(
    chalk.green("  ✓"),
    `${info.label}: added to ~/${info.configPath}`
  );
  return true;
}

/**
 * Add Figma MCP server — delegates to shared utility, logs result.
 */
function addFigmaMcpServer(): boolean {
  const result = sharedAddFigma();
  if (result.success) {
    console.log(chalk.green("  ✓"), `Figma MCP: ${result.message}`);
  } else {
    console.log(chalk.yellow("  ⚠"), `Figma MCP: ${result.message}`);
  }
  return result.success;
}

/**
 * Add Playwright MCP server — delegates to shared utility, logs result.
 */
function addPlaywrightMcpServer(): boolean {
  const result = sharedAddPlaywright();
  if (result.success) {
    console.log(chalk.green("  ✓"), `Playwright MCP: ${result.message}`);
  } else {
    console.log(chalk.yellow("  ⚠"), `Playwright MCP: ${result.message}`);
  }
  return result.success;
}

/** Ask a yes/no question on a TTY. Resolves false when non-interactive. */
function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} ${chalk.dim("(y/N)")} `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function installCommand(
  options: {
    target?: string;
    global?: boolean;
    skipFigma?: boolean;
    live?: boolean;
  },
  kitSlug?: string
): Promise<void> {
  console.log();
  console.log(chalk.bold("Layout — Installing MCP servers"));
  if (options.global) {
    console.log(chalk.dim("  Scope: global (available in all projects)"));
  } else {
    console.log(chalk.dim("  Scope: project (this project only)"));
  }
  console.log();

  // If a kit slug was supplied (e.g. `install acme-design`), pull it from the
  // public gallery into .layout/ before wiring up the MCP servers.
  if (kitSlug) {
    console.log(chalk.dim(`  Fetching the ${chalk.bold(kitSlug)} kit from the gallery…`));
    const result = await fetchKitFromGallery(kitSlug);
    if (result.status === "installed") {
      console.log(
        chalk.green("  ✓"),
        `Installed the ${chalk.bold(kitSlug)} kit into .layout/`
      );
    } else if (result.status === "not-found") {
      console.log(
        chalk.red("  Error:"),
        `Kit "${kitSlug}" not found in the gallery.`
      );
      console.log(chalk.dim(`  Browse kits at ${chalk.cyan("https://layout.design/gallery")}`));
      return;
    } else {
      console.log(chalk.red("  Error:"), result.message);
      return;
    }
    console.log();
  }

  // Check .layout/ exists
  const hasLayout = fs.existsSync(
    path.join(process.cwd(), ".layout")
  );
  if (!hasLayout) {
    console.log(
      chalk.yellow("Note:"),
      "No .layout/ directory found. Run",
      chalk.cyan("npx @layoutdesign/context init"),
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
        `Unknown target "${options.target}". Use: claude, cursor, windsurf, vscode, codex, or gemini`
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

  // --- 1. Install Layout MCP server ---
  console.log();
  console.log(chalk.bold("  Layout MCP"));

  let installed = 0;
  for (const target of targets) {
    if (target === "claude") {
      if (addClaudeMcpServer(options.global ?? false)) installed++;
    } else if (target === "vscode") {
      if (addMcpServerViaVsCode()) installed++;
    } else if (target === "codex" || target === "gemini") {
      if (addMcpServerGlobal(target)) installed++;
    } else {
      if (addMcpServerViaFile(target)) installed++;
    }
  }

  // --- 2. Install Figma + Playwright MCP (Claude Code only, unless --skip-figma) ---
  const hasClaude = targets.includes("claude");
  if (hasClaude && !options.skipFigma) {
    console.log();
    console.log(chalk.bold("  Figma integration"));
    addFigmaMcpServer();
    addPlaywrightMcpServer();
  }

  // --- 2b. layout Live (opt-in; only relevant for Vite/Next projects) ---
  // The MCP install above gives the agent design-system context, but Live
  // editing needs a SEPARATE step: the build plugin that emits source tags.
  // Conflating the two is the #1 "I installed it but can't edit anything" trap,
  // so only offer it for a frontend project and, if skipped, say how to do it.
  const liveFramework = detectFramework(process.cwd());
  let liveWired = false;
  if (liveFramework !== "unknown") {
    let wantLive = options.live ?? false;
    if (options.live === undefined) {
      wantLive = await confirm(
        `  Set up Layout Live editing for this ${liveFramework} project? (build plugin + .layout/live/)`
      );
    }
    if (wantLive) {
      await installLive(process.cwd());
      liveWired = true;
    }
  }

  // --- 3. Summary ---
  console.log();
  console.log(chalk.green("Done!"), "Your AI agent now has access to your design system.");
  console.log();
  console.log(
    chalk.dim("  Layout MCP configured for:"),
    targets.map((t) => TARGET_INFO[t].label).join(", ")
  );
  console.log(
    chalk.dim(
      "  Using a different editor? Add it: npx @layoutdesign/context install --target <cursor|claude|windsurf|vscode|codex|gemini>"
    )
  );
  console.log(
    chalk.dim(
      "  Add pre-built UI components: npx @layoutdesign/context add button (see ui.staging.layout.design)"
    )
  );
  console.log();
  console.log(chalk.yellow("→"), "Restart your AI coding tool to activate the MCP servers.");
  console.log();
  console.log(chalk.dim("  When building UI, your agent will automatically use your"));
  console.log(chalk.dim("  design tokens, components, and brand rules to stay on-brand."));

  if (hasClaude && options.skipFigma) {
    console.log();
    console.log(chalk.dim("  Figma integration skipped. To enable later:"));
    console.log(chalk.dim("    npx @layoutdesign/context install"));
  }

  // Frontend project but Live editing wasn't set up (declined, non-interactive,
  // or not requested) → make the missing step explicit. Without this, the user
  // sees "Done!", opens Layout Live, and nothing is editable.
  if (
    liveFramework !== "unknown" &&
    !liveWired &&
    !isPluginWired(process.cwd(), liveFramework)
  ) {
    console.log();
    console.log(
      chalk.yellow("→"),
      "To edit your UI visually in Layout Live, set up the build plugin:"
    );
    console.log(chalk.cyan("    npx @layoutdesign/context install --live"));
    console.log(
      chalk.dim(
        "  (The MCP install above is separate — it gives your agent context, not visual editing.)"
      )
    );
  }

  console.log();
}
