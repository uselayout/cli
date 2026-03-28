# @layoutdesign/context

**Give your AI agent a design system in one command.**

[![npm version](https://img.shields.io/npm/v/@layoutdesign/context)](https://www.npmjs.com/package/@layoutdesign/context)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-blue)](https://nodejs.org)

An MCP server and CLI that gives AI coding agents structured design system context — tokens, components, rules — so they produce on-brand UI instead of generic code.

---

## Quick Start

Get set up in 60 seconds.

```bash
# Initialise your project with a starter kit
npx @layoutdesign/context init --kit linear-lite

# Auto-configure your AI coding agent
npx @layoutdesign/context install
```

That's it. The `install` command detects Claude Code, Cursor, Windsurf, VS Code / Copilot, Codex CLI, and Gemini CLI automatically and configures the MCP server.

Your agent now has access to your full design system on every request.

---

## What It Does

AI coding agents don't know your design system. They produce UI that looks generic, uses hardcoded colours, ignores your spacing scale, and references components that don't exist.

`@layoutdesign/context` solves this by exposing your design system — tokens, components, rules — as MCP tools. Your agent calls `get_design_system` before writing UI, `get_tokens` when it needs exact values, and `check_compliance` before it finishes. The result is on-brand code from the first attempt.

---

## MCP Tools

Eleven tools are registered with the MCP server automatically.

| Tool | Description |
|------|-------------|
| `get_design_system` | Returns the full layout.md, or a filtered section (colours, typography, spacing, components). Use this before writing any UI. |
| `get_tokens` | Returns design tokens in CSS custom properties, W3C DTCG JSON, or Tailwind config format. |
| `get_component` | Returns the spec and code example for a named component. |
| `list_components` | Lists all components defined in the active kit. |
| `check_compliance` | Validates a code snippet against the design system — flags hardcoded colours, bad spacing, unknown tokens, and unrecognised components. |
| `preview` | Pushes a component to the local live preview canvas at `localhost:4321`. Requires the preview server to be running. |
| `push_to_figma` | Bridges to the Figma MCP server to create an editable Figma frame from component code. Requires Figma MCP to be configured separately. |
| `design_in_figma` | Takes a natural language prompt (e.g. "A pricing card with 3 tiers") and returns design tokens, component specs, and step-by-step instructions for calling Figma MCP's `generate_figma_design`. Enables AI agents to design in Figma before writing code. Inputs: `prompt` (required), `fileKey` (optional), `viewports` (optional: desktop/tablet/mobile). |
| `url_to_figma` | Captures a live website URL as editable Figma frames with auto-layout. Inputs: `url`, `viewports`, `outputMode` (newFile/existingFile/clipboard), `fileKey`. Requires both Figma MCP and Playwright MCP servers. |
| `update_tokens` | Updates token values in `tokens.css`, `tokens.json`, and `layout.md` simultaneously. Use when tweaking colours, spacing, or other tokens without re-extracting. Keeps the entire design system consistent. |

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialise `.layout/` in the current directory, optionally with a starter kit. |
| `init --kit <name>` | Initialise with a specific kit (e.g. `linear-lite`). |
| `serve` | Start the MCP server. This is what your AI agent connects to. |
| `install` | Auto-configure MCP settings for Claude Code, Cursor, Windsurf, VS Code / Copilot, Codex CLI, and Gemini CLI. |
| `install --target <tool>` | Target a specific tool: `claude`, `cursor`, `windsurf`, `vscode`, `codex`, or `gemini`. |
| `install --global` | Install globally so the MCP server is available in all projects (Claude Code only). |
| `doctor` | Check Node.js version, AI tool CLIs, and MCP dependencies (Figma, Playwright). Use `--fix` to auto-install any missing tools. |
| `doctor --fix` | Auto-install missing dependencies (Figma MCP, Playwright MCP). |
| `serve-local <path>` | Serve a local directory over HTTP for use with the `url-to-figma` MCP tool. Requires Python 3. |
| `list` | List all available kits (free and pro). |
| `use <kit>` | Switch the active kit in an existing `.layout/` directory. |
| `import <path>` | Import a design system bundle exported from Layout (`.zip`). |

**Examples:**

```bash
# Start with the Linear-inspired dark kit
npx @layoutdesign/context init --kit linear-lite

# Start with a blank template and write your own layout.md
npx @layoutdesign/context init

# Auto-configure MCP settings for all supported editors
npx @layoutdesign/context install

# Auto-configure for Claude Code only
npx @layoutdesign/context install --target claude

# Install globally (available in all projects — each project uses its own .layout/)
npx @layoutdesign/context install --global

# Switch to a different kit
npx @layoutdesign/context use stripe-lite

# See all available kits
npx @layoutdesign/context list

# Import a bundle from Layout
npx @layoutdesign/context import ./my-design-export.zip

# Check setup and detect issues
npx @layoutdesign/context doctor

# Auto-install missing dependencies
npx @layoutdesign/context doctor --fix

# Serve a local directory for url-to-figma (requires Python 3)
npx @layoutdesign/context serve-local ./path/to/files
npx @layoutdesign/context serve-local ./path/to/files --port 8080
```

---

## Available Kits

Three free starter kits are included. Premium kits are available at [layout.design/kits](https://layout.design/kits).

### Free

| Kit | Aesthetic | Description |
|-----|-----------|-------------|
| `linear-lite` | Dark, minimal, developer-focused | Developer tool design system inspired by Linear |
| `stripe-lite` | Light, clean, high-trust | Payment UI design system inspired by Stripe |
| `notion-lite` | Light, content-first, block-based | Productivity design system inspired by Notion |

### Pro

| Kit | Aesthetic | Components |
|-----|-----------|------------|
| `linear` | Dark, minimal, developer-focused | 24 components, all tokens |
| `stripe` | Light, clean, high-trust | 20 components, all tokens |
| `notion` | Light, content-first, block-based | 22 components, all tokens |
| `revolut` | Dark fintech, data-rich | 30 components, all tokens |
| `airbnb` | Warm, rounded, photo-forward | 25 components, all tokens |
| `tiktok` | Dark, vibrant, video-first | 28 components, all tokens |
| `netflix` | Dark, cinematic, content-forward | 18 components, all tokens |

---

## Setup Guides

The easiest way to configure any supported editor is:

```bash
npx @layoutdesign/context install
```

This auto-detects Claude Code, Cursor, Windsurf, VS Code / Copilot, Codex CLI, and Gemini CLI and configures the MCP server. For Claude Code it uses `claude mcp add`; for other tools it writes the appropriate config file (`.cursor/mcp.json`, `.windsurf/mcp.json`, `.vscode/mcp.json`, `~/.codex/config.json`, or `~/.gemini/settings.json`).

### Per-Project vs Global

By default, the MCP server is registered **per-project**. Each project needs its own `install`.

For users working across multiple projects, install globally:

```bash
npx @layoutdesign/context install --global
```

The MCP server always reads `.layout/` from the current working directory, so each project uses its own design system — even with a global install.

### Updating

Layout Context uses `npx -y` which fetches the latest version automatically when a new agent session starts. To force an update mid-session:

```bash
# Clear the npx cache to force a fresh download
npx clear-npx-cache

# Verify dependencies after updating
npx @layoutdesign/context doctor
```

**Claude Code users:** The MCP server restarts automatically on new conversations. To force a restart mid-conversation, use `/mcp` and restart the `layout` server.

### Manual Setup

If you prefer to configure manually:

**Claude Code** (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "layout": {
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "layout": {
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

**Windsurf** (`.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "layout": {
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "layout": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

**Codex CLI** (`~/.codex/config.json` — global):

```json
{
  "mcpServers": {
    "layout": {
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json` — global):

```json
{
  "mcpServers": {
    "layout": {
      "command": "npx",
      "args": ["-y", "@layoutdesign/context", "serve"]
    }
  }
}
```

---

## Live Preview

The `preview` MCP tool and the preview canvas work together to give you visual verification without leaving your agent session.

Start the preview server alongside the MCP server:

```bash
npx @layoutdesign/context serve
```

The preview canvas opens at `http://localhost:4321`. It features:

- Dark UI with your active kit's design tokens applied
- WebSocket-powered live updates — components render as the agent pushes them
- Viewport toggles (mobile, tablet, desktop)
- Source code panel to inspect what was rendered
- TSX transpilation on the server — no browser-side build step

When your agent calls the `preview` tool with a component, it appears in the canvas within milliseconds. Open the canvas in a browser tab alongside your editor and you have a live design review loop without any manual copy-paste.

---

## Figma Integration

Three MCP tools bridge the gap between design and code using the [Figma MCP server](https://www.figma.com/developers/mcp): `push_to_figma`, `design_in_figma`, and `url_to_figma`.

### Setup

Add the Figma MCP server to your agent config alongside `design-context`. It uses OAuth — no API key required:

```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

Then authenticate when prompted. The Figma MCP server will open a browser tab for OAuth consent.

### Figma Tools

| Tool | What It Does |
|------|--------------|
| `push_to_figma` | Creates an editable Figma frame from component code. Returns a structured prompt for Figma MCP's `generate_figma_design`. |
| `design_in_figma` | Takes a natural language prompt and returns design tokens, component specs, and step-by-step instructions for `generate_figma_design`. Design in Figma before writing any code. |
| `url_to_figma` | Captures a live website URL as editable Figma frames with auto-layout. Requires Playwright MCP alongside Figma MCP. |

### The Closed Loop

```
Developer prompts AI → AI calls get_design_system → generates TSX
        ↓
AI calls preview → renders at localhost:4321
        ↓
AI calls push_to_figma → editable frame in Figma
        ↓
Designer reviews → AI reads changes via Figma MCP → updates code
```

When `push_to_figma` is called, it returns a structured prompt ready to pass to the Figma MCP's `generate_figma_design` tool, including your component code and the relevant design tokens extracted from the active kit.

---

## Custom Design Systems

You don't need a pre-built kit. You can write your own `layout.md` and the MCP server will use it.

**1. Create the `.layout/` directory:**

```bash
npx @layoutdesign/context init
```

This creates a blank template at `.layout/layout.md` for you to fill in.

**2. Edit `layout.md` with your design system:**

```markdown
# My Design System

## Colours

| Token | Value | Usage |
|-------|-------|-------|
| --color-primary | #0F172A | Primary actions |
| --color-background | #FFFFFF | Page background |

## Typography

- **Font family:** Inter, system-ui, sans-serif
- **Base size:** 16px

## Components

### Button

Primary action button. Uses --color-primary as background.
```

**3. Optionally add token files:**

```
.layout/
├── kit.json          # Metadata (name, version, description)
├── layout.md         # Human-readable design system spec
├── tokens.css        # CSS custom properties
├── tokens.json       # W3C DTCG tokens (optional)
└── tailwind.config.js  # Tailwind theme extension (optional)
```

**4. Start the MCP server:**

```bash
npx @layoutdesign/context serve
```

The server reads whatever is in `.layout/` — no configuration needed.

---

## On-Disk Structure

```
.layout/
├── kit.json            # Kit metadata (name, version, tier, component count)
├── layout.md           # Full design system spec — this is what agents read
├── tokens.css          # CSS custom properties for all tokens
├── tokens.json         # W3C DTCG tokens.json (for tooling integration)
└── tailwind.config.js  # Tailwind theme config matching the token set
```

All files are plain text and checked into version control. Your whole team gets the same design context.

---

## Layout Integration

[Layout](https://layout.design) extracts design systems from Figma files and live websites, then exports them as a `.zip` bundle ready for import.

Use Layout to:

- Extract tokens and components from an existing Figma file
- Scrape a live website's design system (colours, typography, spacing, components)
- Generate a structured `layout.md` using Claude
- Export a bundle containing `layout.md`, `tokens.css`, `tokens.json`, and `tailwind.config.js`

### Importing a Layout Export

```bash
npx @layoutdesign/context import ./my-design-export.zip
```

This extracts the bundle into `.layout/` and automatically merges design system rules into your project's root `CLAUDE.md` (using HTML comment markers for idempotent updates). Re-importing replaces the previous section cleanly.

Note: Bundles exported from Layout Studio are typically under 5 MB. Very large ZIPs may take a moment to extract.

After importing, run `npx @layoutdesign/context install` to connect the MCP server.

---

## Compliance Checker

The `check_compliance` tool validates a code snippet against your active kit and returns a structured result.

### Rules

| Rule | Severity | What It Catches |
|------|----------|-----------------|
| `hardcoded-colours` | Error | Hex values (`#fff`, `#6366F1`) and `rgb()`/`rgba()` that should reference tokens |
| `hardcoded-spacing` | Warning | `margin: 12px` and similar pixel values that should use the spacing scale |
| `missing-token-reference` | Warning | `var(--unknown-token)` calls not present in `tokens.css` |
| `unknown-component` | Info | JSX components not listed in the kit's component inventory |

### Response Shape

```json
{
  "passed": false,
  "issues": [
    {
      "rule": "hardcoded-colours",
      "severity": "error",
      "line": 4,
      "message": "Hardcoded colour '#6366F1' — use var(--color-accent) instead"
    },
    {
      "rule": "unknown-component",
      "severity": "info",
      "line": 12,
      "message": "Component 'Tooltip' is not in the active kit's component list"
    }
  ]
}
```

### Recommended Agent Workflow

```
1. get_design_system          — read the spec before writing
2. get_tokens(format: "css")  — get exact token values
3. [write component code]
4. check_compliance(code)     — verify before finishing
5. preview(code)              — visual check
```

---

## Contributing

PRs are welcome. The project is MIT licensed.

```bash
git clone https://github.com/uselayout/layout-context.git
cd context
npm install
npm run build
```

The source is in `src/`. Key directories:

- `src/mcp/tools/` — MCP tool handlers (one file per tool)
- `src/kit/` — Kit loading, parsing, and registry
- `src/compliance/` — Compliance rules
- `src/preview/` — Preview server and WebSocket handler
- `src/cli/` — CLI command implementations

---

## License

MIT — see [LICENSE](./LICENSE).

---

Powered by [Layout](https://layout.design).
