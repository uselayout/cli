import { z } from "zod";
import {
  checkMcpRegistration,
  addFigmaMcpServer,
  addPlaywrightMcpServer,
  testEndpointReachable,
} from "../../cli/setup-utils.js";

export const name = "check-setup";

export const description =
  "Diagnose and optionally fix MCP server setup issues. " +
  "Call this when Figma tools (push-to-figma, design-in-figma, url-to-figma) aren't working, " +
  "or when the user reports that Figma MCP appears listed but isn't connected. " +
  "Checks registration, transport type, OAuth status, and endpoint reachability. " +
  "With fix=true, attempts to re-register missing or misconfigured servers.";

export const inputSchema = {
  focus: z
    .enum(["all", "figma", "playwright", "layout"])
    .optional()
    .describe("What to check. Default: 'all'"),
  fix: z
    .boolean()
    .optional()
    .describe(
      "If true, attempt to auto-fix issues (re-register MCP servers). Default: false"
    ),
};

type Input = {
  focus?: "all" | "figma" | "playwright" | "layout";
  fix?: boolean;
};

export function handler() {
  return async (input: Input) => {
    const focus = input.focus ?? "all";
    const shouldFix = input.fix ?? false;

    const sections: string[] = [];
    sections.push("## Layout Setup Check\n");

    // Check MCP registration
    const state = checkMcpRegistration();

    if (!state) {
      sections.push(
        "### Claude CLI ❌\n" +
          "- Could not run `claude mcp list`\n" +
          "- The Claude CLI may not be installed or not in PATH\n" +
          "- Install: https://docs.anthropic.com/en/docs/claude-code\n"
      );
      return { content: [{ type: "text" as const, text: sections.join("\n") }] };
    }

    // --- Figma MCP ---
    if (focus === "all" || focus === "figma") {
      sections.push(await checkFigma(state, shouldFix));
    }

    // --- Playwright MCP ---
    if (focus === "all" || focus === "playwright") {
      sections.push(checkPlaywright(state, shouldFix));
    }

    // --- Layout MCP ---
    if (focus === "all" || focus === "layout") {
      sections.push(checkLayout(state));
    }

    // --- Next Steps ---
    sections.push(buildNextSteps(state, shouldFix));

    return { content: [{ type: "text" as const, text: sections.join("\n") }] };
  };
}

async function checkFigma(
  state: NonNullable<ReturnType<typeof checkMcpRegistration>>,
  shouldFix: boolean
): Promise<string> {
  const lines: string[] = [];

  if (state.figma.registered) {
    const entry = state.figma.entry;
    const issues: string[] = [];

    // Check for old npm package
    if (state.figma.isOldNpmPackage) {
      issues.push(
        "- **Outdated Figma MCP:** You have the old `figma-developer-mcp` npm package (only 2 tools: get_figma_data, download_figma_images). " +
          "Layout requires the official Figma MCP server at `mcp.figma.com` which has 16 tools including `use_figma`"
      );
    }

    // Check transport
    if (!state.figma.correctTransport && !state.figma.isOldNpmPackage) {
      issues.push(
        `- **Wrong transport:** Using \`${entry?.transport ?? "unknown"}\` but Figma MCP requires \`http\` transport for OAuth`
      );
    }

    // Check scope
    if (!state.figma.correctScope) {
      issues.push(
        `- **Scope warning:** Registered at \`${entry?.scope ?? "unknown"}\` scope — \`user\` scope is recommended for cross-project availability`
      );
    }

    // Check plugin shadow
    if (state.figma.pluginShadow) {
      issues.push(
        "- **Plugin shadow detected:** A Claude plugin is providing a duplicate Figma registration. " +
          "The plugin version uses OAuth that doesn't persist between sessions — " +
          "this is the most common cause of 'listed but not connected' issues"
      );
    }

    if (issues.length === 0) {
      lines.push(
        `### Figma MCP ✅\n` +
          `- Status: registered (${entry?.scope ?? "user"} scope, ${entry?.transport ?? "http"} transport)\n` +
          `- If tools still aren't working, you may need to re-authenticate with Figma OAuth\n` +
          `- Try restarting your Claude Code session — you'll be prompted to authenticate\n`
      );
    } else {
      const icon =
        !state.figma.correctTransport || state.figma.pluginShadow ? "⚠️" : "✅";
      lines.push(`### Figma MCP ${icon}\n`);
      lines.push(
        `- Status: registered (${entry?.scope ?? "unknown"} scope, ${entry?.transport ?? "unknown"} transport)\n`
      );
      lines.push(...issues);
      lines.push("");

      // Attempt fix
      if (
        shouldFix &&
        (!state.figma.correctTransport || state.figma.pluginShadow)
      ) {
        const result = addFigmaMcpServer();
        if (result.success) {
          lines.push(`- **Fix applied:** ${result.message}\n`);
        } else {
          lines.push(`- **Fix failed:** ${result.message}\n`);
        }
      } else if (!state.figma.correctTransport || state.figma.pluginShadow) {
        lines.push(
          "- **To fix:** Run `npx @layoutdesign/context install` to auto-configure, or call this tool again with `fix: true`\n"
        );
      }
    }
  } else {
    lines.push("### Figma MCP ❌\n");
    lines.push("- Status: not registered\n");
    lines.push(
      "- Required for: push-to-figma, design-in-figma, url-to-figma\n"
    );

    if (shouldFix) {
      const result = addFigmaMcpServer();
      if (result.success) {
        lines.push(`- **Fix applied:** ${result.message}\n`);
        lines.push(
          "- **Action needed:** Restart Claude Code to activate, then authenticate with Figma when prompted\n"
        );
      } else {
        lines.push(`- **Fix failed:** ${result.message}\n`);
      }
    } else {
      lines.push(
        "- **To fix:** Run `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp`\n" +
          "- Or call this tool again with `fix: true`\n"
      );
    }
  }

  // Endpoint reachability
  const reachability = await testEndpointReachable("https://mcp.figma.com/mcp");
  if (reachability.reachable) {
    lines.push(`- Endpoint: reachable (HTTP ${reachability.status})\n`);
  } else {
    lines.push(
      `- Endpoint: **unreachable** — ${reachability.error}\n` +
        "- Check internet connection or firewall settings\n"
    );
  }

  return lines.join("\n");
}

function checkPlaywright(
  state: NonNullable<ReturnType<typeof checkMcpRegistration>>,
  shouldFix: boolean
): string {
  const lines: string[] = [];

  if (state.playwright.registered) {
    lines.push(
      "### Playwright MCP ✅\n" + "- Status: registered\n"
    );
  } else {
    lines.push("### Playwright MCP ❌\n");
    lines.push("- Status: not registered\n");
    lines.push("- Required for: push-to-figma, url-to-figma\n");

    if (shouldFix) {
      const result = addPlaywrightMcpServer();
      if (result.success) {
        lines.push(`- **Fix applied:** ${result.message}\n`);
        lines.push("- **Action needed:** Restart Claude Code to activate\n");
      } else {
        lines.push(`- **Fix failed:** ${result.message}\n`);
      }
    } else {
      lines.push(
        "- **To fix:** Run `npx @layoutdesign/context install` to auto-configure, or call this tool again with `fix: true`\n"
      );
    }
  }

  return lines.join("\n");
}

function checkLayout(
  state: NonNullable<ReturnType<typeof checkMcpRegistration>>
): string {
  if (state.layout.registered) {
    return (
      "### Layout MCP ✅\n" +
      "- Status: connected (you're using it right now!)\n"
    );
  }

  // If they're calling this tool, Layout IS connected even if not in the list
  // (the tool itself runs inside the Layout MCP server)
  return (
    "### Layout MCP ✅\n" +
    "- Status: connected (this tool is running inside it)\n" +
    "- Note: not found in `claude mcp list` — may be registered under a different name or at project scope\n"
  );
}

function buildNextSteps(
  state: NonNullable<ReturnType<typeof checkMcpRegistration>>,
  fixApplied: boolean
): string {
  const steps: string[] = [];
  steps.push("### Next Steps\n");

  if (fixApplied) {
    steps.push(
      "1. **Restart Claude Code** to activate the changes\n" +
        "2. When prompted, **authenticate with Figma** (OAuth)\n" +
        "3. Try your Figma command again\n"
    );
    return steps.join("");
  }

  const hasIssues =
    !state.figma.registered ||
    !state.figma.correctTransport ||
    state.figma.pluginShadow ||
    !state.playwright.registered;

  if (!hasIssues) {
    steps.push(
      "Everything looks correctly configured. If Figma tools still aren't working:\n\n" +
        "1. **Restart Claude Code** — this forces MCP servers to reconnect\n" +
        "2. **Re-authenticate with Figma** — OAuth tokens may have expired\n" +
        "3. **Check Figma permissions** — ensure your Figma account has edit access to the target file\n" +
        "4. Run this tool again with `fix: true` to re-register servers\n"
    );
  } else {
    steps.push(
      "Issues were found. To fix automatically:\n\n" +
        '1. Call `check-setup` with `fix: true` to re-register servers\n' +
        "2. **Restart Claude Code** after fixes are applied\n" +
        "3. **Authenticate with Figma** when prompted (OAuth)\n" +
        "4. Try your Figma command again\n"
    );
  }

  return steps.join("");
}
