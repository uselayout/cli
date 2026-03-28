import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  checkMcpRegistration,
  addFigmaMcpServer,
  addPlaywrightMcpServer,
  testEndpointReachable,
} from "./setup-utils.js";

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
  fixCmd?: string[];
  requiredBy?: string;
  warning?: string;
}

/**
 * `layout-context doctor` — checks Node.js, Claude CLI, and MCP dependencies.
 * With --fix, automatically installs missing MCP servers.
 * With --verbose, shows raw MCP output and detailed transport/scope info.
 */
export async function doctorCommand(options?: {
  fix?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const autoFix = options?.fix ?? false;
  const verbose = options?.verbose ?? false;

  console.log();
  console.log(chalk.bold("Layout Context — Dependency Check"));
  if (autoFix) {
    console.log(chalk.dim("  Mode: auto-fix enabled"));
  }
  if (verbose) {
    console.log(chalk.dim("  Mode: verbose diagnostics"));
  }
  console.log();

  const results: CheckResult[] = [
    checkNodeVersion(),
    ...checkToolClis(),
  ];

  // MCP server checks (deep Figma diagnostics)
  const mcpResults = await checkMcpServersDeep(verbose);
  results.push(...mcpResults);

  let issues = 0;
  let fixed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(chalk.green("  ✅ ") + r.label + chalk.dim(` — ${r.detail}`));
      if (r.warning) {
        console.log(chalk.yellow(`     ⚠ ${r.warning}`));
      }
    } else {
      issues++;
      console.log(chalk.yellow("  ⚠️  ") + r.label);
      console.log(chalk.dim(`     ${r.detail}`));

      // Attempt auto-fix if --fix and we have a fixCmd
      if (autoFix && r.fixCmd) {
        const fixResult = attemptFix(r);
        if (fixResult) {
          fixed++;
          issues--;
        }
      } else if (r.fix) {
        console.log(chalk.cyan(`     Fix: ${r.fix}`));
      }

      if (r.requiredBy) {
        console.log(chalk.dim(`     Required for: ${r.requiredBy}`));
      }
    }
  }

  console.log();
  if (issues === 0 && fixed === 0) {
    console.log(chalk.green("All checks passed. Full functionality available."));
  } else if (issues === 0 && fixed > 0) {
    console.log(
      chalk.green(
        `All issues fixed (${fixed} auto-fixed). Restart your AI coding tool to activate.`
      )
    );
  } else if (autoFix) {
    console.log(
      chalk.yellow(
        `${issues} issue${issues > 1 ? "s" : ""} remaining (${fixed} auto-fixed). Fix warnings above manually.`
      )
    );
  } else {
    console.log(
      chalk.yellow(
        `${issues} issue${issues > 1 ? "s" : ""} found. Run with ${chalk.cyan("--fix")} to auto-install missing MCP servers.`
      )
    );
  }
  console.log();
}

function attemptFix(r: CheckResult): boolean {
  if (!r.fixCmd) return false;

  // Use shared utilities for Figma and Playwright
  if (r.label.includes("Figma")) {
    const result = addFigmaMcpServer();
    if (result.success) {
      console.log(chalk.green(`     ✓ Fixed: ${result.message}`));
      return true;
    }
    console.log(chalk.red(`     ✗ Auto-fix failed: ${result.message}`));
    return false;
  }

  if (r.label.includes("Playwright")) {
    const result = addPlaywrightMcpServer();
    if (result.success) {
      console.log(chalk.green(`     ✓ Fixed: ${result.message}`));
      return true;
    }
    console.log(chalk.red(`     ✗ Auto-fix failed: ${result.message}`));
    return false;
  }

  // Generic fix via fixCmd
  try {
    execFileSync(r.fixCmd[0]!, r.fixCmd.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(chalk.green(`     ✓ Fixed!`));
    return true;
  } catch {
    console.log(chalk.red(`     ✗ Auto-fix failed`));
    if (r.fix) {
      console.log(chalk.cyan(`     Run manually: ${r.fix}`));
    }
    return false;
  }
}

function checkNodeVersion(): CheckResult {
  const [major] = process.versions.node.split(".").map(Number);
  if (major !== undefined && major >= 18) {
    return {
      label: `Node.js v${process.versions.node}`,
      ok: true,
      detail: "requires >=18",
    };
  }
  return {
    label: `Node.js v${process.versions.node}`,
    ok: false,
    detail: `Node.js 18+ is required, you have ${process.versions.node}`,
    fix: "Install Node.js 18+ from https://nodejs.org",
  };
}

function checkToolClis(): CheckResult[] {
  const results: CheckResult[] = [];
  const cwd = process.cwd();

  const tools: { name: string; cli: string; detect: () => boolean; installUrl?: string }[] = [
    {
      name: "Claude Code",
      cli: "claude",
      detect: () => {
        try {
          execFileSync("which", ["claude"], { stdio: "ignore" });
          return true;
        } catch {
          return (
            fs.existsSync(path.join(cwd, ".claude")) ||
            fs.existsSync(path.join(cwd, "CLAUDE.md"))
          );
        }
      },
      installUrl: "https://docs.anthropic.com/en/docs/claude-code",
    },
    {
      name: "Cursor",
      cli: "cursor",
      detect: () =>
        fs.existsSync(path.join(cwd, ".cursor")) ||
        fs.existsSync(path.join(cwd, ".cursorrules")),
    },
    {
      name: "Windsurf",
      cli: "windsurf",
      detect: () => fs.existsSync(path.join(cwd, ".windsurf")),
    },
    {
      name: "VS Code / Copilot",
      cli: "code",
      detect: () => fs.existsSync(path.join(cwd, ".vscode")),
    },
    {
      name: "Codex CLI",
      cli: "codex",
      detect: () => {
        try {
          execFileSync("which", ["codex"], { stdio: "ignore" });
          return true;
        } catch {
          return fs.existsSync(path.join(os.homedir(), ".codex"));
        }
      },
    },
    {
      name: "Gemini CLI",
      cli: "gemini",
      detect: () => {
        try {
          execFileSync("which", ["gemini"], { stdio: "ignore" });
          return true;
        } catch {
          return fs.existsSync(path.join(os.homedir(), ".gemini"));
        }
      },
    },
  ];

  const detected = tools.filter((t) => t.detect());

  if (detected.length === 0) {
    results.push({
      label: "AI coding tools",
      ok: false,
      detail: "no tools detected — install Claude Code, Cursor, Windsurf, VS Code, Codex, or Gemini CLI",
      fix: "Install at least one AI coding tool, then run: npx @layoutdesign/context install",
    });
  } else {
    results.push({
      label: "AI coding tools",
      ok: true,
      detail: detected.map((t) => t.name).join(", "),
    });
  }

  return results;
}

/**
 * Deep MCP server checks with Figma-specific diagnostics.
 */
async function checkMcpServersDeep(verbose: boolean): Promise<CheckResult[]> {
  const state = checkMcpRegistration();

  if (!state) {
    return [
      {
        label: "MCP server list",
        ok: false,
        detail: "Could not run `claude mcp list`",
        fix: "Ensure Claude CLI is installed and authenticated",
      },
    ];
  }

  if (verbose) {
    console.log();
    console.log(chalk.dim("  Raw MCP list output:"));
    for (const line of state.rawOutput.split("\n")) {
      if (line.trim()) {
        console.log(chalk.dim(`    ${line}`));
      }
    }
    console.log();
  }

  const results: CheckResult[] = [];

  // --- Figma MCP (deep check) ---
  if (state.figma.registered) {
    const entry = state.figma.entry;
    let detail = "configured";
    let warning: string | undefined;

    // Transport check
    if (!state.figma.correctTransport) {
      detail += ` (transport: ${entry?.transport ?? "unknown"})`;
      warning =
        "Figma MCP should use HTTP transport for OAuth. " +
        "Re-register with: npx @layoutdesign/context install --target claude, or manually configure for your tool";
    } else {
      detail += " (http transport)";
    }

    // Scope check
    if (!state.figma.correctScope) {
      const scopeNote = `scope: ${entry?.scope ?? "unknown"}`;
      detail += `, ${scopeNote}`;
      if (!warning) {
        warning =
          "Figma MCP is registered at project scope — consider user scope for cross-project availability. " +
          "Re-register with: npx @layoutdesign/context install --target claude, or manually configure for your tool";
      }
    } else {
      detail += ", user scope";
    }

    // Plugin shadow check
    if (state.figma.pluginShadow) {
      warning = warning
        ? warning +
          " Also: a Claude plugin is providing a duplicate Figma registration — " +
          "the plugin version uses OAuth that doesn't persist between sessions."
        : "A Claude plugin is providing a duplicate Figma registration. " +
          "The plugin version uses OAuth that doesn't persist between sessions. " +
          "Ensure you also have a proper user-scoped registration.";
    }

    results.push({
      label: "Figma MCP",
      ok: true,
      detail,
      warning,
    });
  } else {
    results.push({
      label: "Figma MCP",
      ok: false,
      detail: "not found in MCP server list",
      fix: "npx @layoutdesign/context install (auto-configures for your tool)",
      fixCmd: [
        "claude", "mcp", "add", "--scope", "user", "--transport", "http",
        "figma", "https://mcp.figma.com/mcp",
      ],
      requiredBy: "push-to-figma, design-in-figma, url-to-figma",
    });
  }

  // --- Figma endpoint reachability ---
  const reachability = await testEndpointReachable("https://mcp.figma.com/mcp");
  if (reachability.reachable) {
    results.push({
      label: "Figma endpoint",
      ok: true,
      detail: `reachable (HTTP ${reachability.status})`,
    });
  } else {
    results.push({
      label: "Figma endpoint",
      ok: false,
      detail: `unreachable — ${reachability.error}`,
      fix: "Check your internet connection or firewall settings. Figma MCP connects to https://mcp.figma.com/mcp",
    });
  }

  // --- Playwright MCP ---
  results.push(
    state.playwright.registered
      ? {
          label: "Playwright MCP",
          ok: true,
          detail: "configured",
        }
      : {
          label: "Playwright MCP",
          ok: false,
          detail: "not found in MCP server list",
          fix: "npx @layoutdesign/context install (auto-configures for your tool)",
          fixCmd: [
            "claude", "mcp", "add", "--scope", "user",
            "playwright", "--", "npx", "-y", "@anthropic-ai/mcp-playwright",
          ],
          requiredBy: "push-to-figma, url-to-figma",
        }
  );

  // --- Layout MCP ---
  results.push(
    state.layout.registered
      ? {
          label: "Layout MCP",
          ok: true,
          detail: "configured",
        }
      : {
          label: "Layout MCP",
          ok: false,
          detail: "not found in MCP server list",
          fix: "npx @layoutdesign/context install",
          requiredBy: "all design system tools",
        }
  );

  // --- Verbose: show parsed entries ---
  if (verbose && state.servers.length > 0) {
    console.log();
    console.log(chalk.dim("  Parsed MCP servers:"));
    for (const s of state.servers) {
      console.log(
        chalk.dim(
          `    ${s.name} — transport: ${s.transport}, scope: ${s.scope}`
        )
      );
    }
    console.log();
  }

  return results;
}
