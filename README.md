# @superduperui/context

**Give your AI agent a design system in one command.**

[![npm version](https://img.shields.io/npm/v/@superduperui/context)](https://www.npmjs.com/package/@superduperui/context)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-blue)](https://nodejs.org)

An MCP server and CLI that gives AI coding agents structured design system context — tokens, components, rules — so they produce on-brand UI instead of generic code.

---

## Quick Start

Get set up in 60 seconds.

```bash
# Initialise your project with a starter kit
npx @superduperui/context init --kit linear-lite
```

Then add the MCP server to your AI coding agent:

**Claude Code** (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "design-context": {
      "command": "npx",
      "args": ["@superduperui/context", "serve"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "design-context": {
      "command": "npx",
      "args": ["@superduperui/context", "serve"]
    }
  }
}
```

Your agent now has access to your full design system on every request.

---

## What It Does

AI coding agents don't know your design system. They produce UI that looks generic, uses hardcoded colours, ignores your spacing scale, and references components that don't exist.

`@superduperui/context` solves this by exposing your design system — tokens, components, rules — as MCP tools. Your agent calls `get_design_system` before writing UI, `get_tokens` when it needs exact values, and `check_compliance` before it finishes. The result is on-brand code from the first attempt.

---

## MCP Tools

Seven tools are registered with the MCP server automatically.

| Tool | Description |
|------|-------------|
| `get_design_system` | Returns the full DESIGN.md, or a filtered section (colours, typography, spacing, components). Use this before writing any UI. |
| `get_tokens` | Returns design tokens in CSS custom properties, W3C DTCG JSON, or Tailwind config format. |
| `get_component` | Returns the spec and code example for a named component. |
| `list_components` | Lists all components defined in the active kit. |
| `check_compliance` | Validates a code snippet against the design system — flags hardcoded colours, bad spacing, unknown tokens, and unrecognised components. |
| `preview` | Pushes a component to the local live preview canvas at `localhost:4321`. Requires the preview server to be running. |
| `push_to_figma` | Bridges to the Figma MCP server to create an editable Figma frame from component code. Requires Figma MCP to be configured separately. |

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialise `.superduper/` in the current directory, optionally with a starter kit. |
| `init --kit <name>` | Initialise with a specific kit (e.g. `linear-lite`). |
| `serve` | Start the MCP server. This is what your AI agent connects to. |
| `list` | List all available kits (free and pro). |
| `use <kit>` | Switch the active kit in an existing `.superduper/` directory. |
| `import <path>` | Import a design system bundle exported from SuperDuper AI Studio (`.zip`). |

**Examples:**

```bash
# Start with the Linear-inspired dark kit
npx @superduperui/context init --kit linear-lite

# Start with a blank template and write your own DESIGN.md
npx @superduperui/context init

# Switch to a different kit
npx @superduperui/context use stripe-lite

# See all available kits
npx @superduperui/context list

# Import a bundle from AI Studio
npx @superduperui/context import ./my-design-export.zip
```

---

## Available Kits

Three free starter kits are included. Premium kits are available at [superduperui.com/kits](https://superduperui.com/kits).

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

### Claude Code

Add to `.claude/settings.json` in your project root (or globally at `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "design-context": {
      "command": "npx",
      "args": ["@superduperui/context", "serve"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "design-context": {
      "command": "npx",
      "args": ["@superduperui/context", "serve"]
    }
  }
}
```

### Windsurf

Add to `.windsurf/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "design-context": {
      "command": "npx",
      "args": ["@superduperui/context", "serve"]
    }
  }
}
```

The MCP server reads from `.superduper/` in the current working directory. Run it from your project root.

---

## Live Preview

The `preview` MCP tool and the preview canvas work together to give you visual verification without leaving your agent session.

Start the preview server alongside the MCP server:

```bash
npx @superduperui/context serve
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

The `push_to_figma` tool closes the loop between code and design by bridging to the [Figma MCP server](https://www.figma.com/developers/mcp).

### Prerequisites

1. Install the Figma MCP server and add it to your MCP client config alongside `design-context`
2. Create a Figma personal access token at [figma.com/developers](https://www.figma.com/developers/api#access-tokens)
3. Configure the Figma MCP server with your token

### The Full Loop

```
Design system in .superduper/
        ↓
Agent calls get_design_system → writes on-brand component
        ↓
Agent calls preview → visual check at localhost:4321
        ↓
Agent calls push_to_figma → editable frame created in Figma
        ↓
Designer reviews in Figma → leaves comments / adjusts tokens
        ↓
Export updated design system from AI Studio → import to .superduper/
        ↓
Agent picks up updated tokens automatically
```

When `push_to_figma` is called, it returns a structured prompt ready to pass to the Figma MCP's `generate_figma_design` tool, including your component code and the relevant design tokens extracted from the active kit.

---

## Custom Design Systems

You don't need a pre-built kit. You can write your own `DESIGN.md` and the MCP server will use it.

**1. Create the `.superduper/` directory:**

```bash
npx @superduperui/context init
```

This creates a blank template at `.superduper/DESIGN.md` for you to fill in.

**2. Edit `DESIGN.md` with your design system:**

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
.superduper/
├── kit.json          # Metadata (name, version, description)
├── DESIGN.md         # Human-readable design system spec
├── tokens.css        # CSS custom properties
├── tokens.json       # W3C DTCG tokens (optional)
└── tailwind.config.js  # Tailwind theme extension (optional)
```

**4. Start the MCP server:**

```bash
npx @superduperui/context serve
```

The server reads whatever is in `.superduper/` — no configuration needed.

---

## On-Disk Structure

```
.superduper/
├── kit.json            # Kit metadata (name, version, tier, component count)
├── DESIGN.md           # Full design system spec — this is what agents read
├── tokens.css          # CSS custom properties for all tokens
├── tokens.json         # W3C DTCG tokens.json (for tooling integration)
└── tailwind.config.js  # Tailwind theme config matching the token set
```

All files are plain text and checked into version control. Your whole team gets the same design context.

---

## AI Studio Integration

[SuperDuper AI Studio](https://studio.superduperui.com) extracts design systems from Figma files and live websites, then exports them as a `.zip` bundle ready for import.

Use AI Studio to:

- Extract tokens and components from an existing Figma file
- Scrape a live website's design system (colours, typography, spacing, components)
- Generate a structured `DESIGN.md` using Claude
- Export a bundle containing `DESIGN.md`, `tokens.css`, `tokens.json`, and `tailwind.config.js`

### Importing an AI Studio Export

```bash
npx @superduperui/context import ./my-design-export.zip
```

This extracts the bundle into `.superduper/` and makes it immediately available to the MCP server.

---

## Compliance Checker

The `check_compliance` tool runs four rules against any code snippet:

| Rule | Severity | What It Catches |
|------|----------|-----------------|
| `hardcoded-colours` | Warning | Hex values (`#fff`, `#6366F1`) and `rgb()`/`rgba()` that should use tokens |
| `hardcoded-spacing` | Info | `margin: 12px` and similar pixel values that should use the spacing scale |
| `missing-token-reference` | Warning | `var(--unknown-token)` calls not present in `tokens.css` |
| `unknown-component` | Info | JSX components not listed in the kit's component inventory |

Example agent workflow:

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
git clone https://github.com/superduperui/context.git
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

Powered by [SuperDuper](https://superduperui.com).
