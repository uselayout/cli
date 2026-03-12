# End-to-End Test: Extract → Design → Preview → Figma → Edit → Build

This guide walks through the complete Layout design system loop:

1. **Extract** Linear's design system via Layout
2. **Generate** a marketing page using the design system context
3. **Preview** it live in the built-in viewer
4. **Push to Figma** as editable frames
5. **Designer edits** in Figma
6. **Read back** changes and update code
7. **Preview** the final result

---

## Prerequisites

- **Layout** running locally (`npm run dev` → `localhost:3000`)
- **@layoutdesign/context** built (`npm run build` in this repo)
- **Figma MCP** connected to your agent
- **A Figma file URL** to push designs into
- **Claude Code** (or Cursor) with both MCP servers configured

---

## Phase 1: Extract Linear's Design System

1. Open Layout at `http://localhost:3000`
2. Paste `https://linear.app` in the URL input
3. Wait for extraction (captures screenshots, tokens, components, CSS)
4. Review in the Studio:
   - **Tokens tab** — colours, typography, spacing, radius
   - **Screenshots tab** — full-page + viewport reference images
5. Let DESIGN.md generate (takes ~30 seconds)
6. Click **Export** → select all formats → download ZIP

> **Tip:** The screenshots are visible in the Studio for reference but aren't included in the
> export. The DESIGN.md contains all the design system context the agent needs.

---

## Phase 2: Set Up MCP Context

### Option A: Import Layout Export (Full Extraction)

```bash
# Create a test project
mkdir ~/test-linear-marketing && cd ~/test-linear-marketing
git init

# Import the Layout export
npx @layoutdesign/context import ~/Downloads/linear-export.zip
```

### Option B: Use Bundled Kit (Quick Testing)

```bash
mkdir ~/test-linear-marketing && cd ~/test-linear-marketing
git init

npx @layoutdesign/context init --kit linear-lite
```

### Configure Claude Code

Add to `.claude/settings.json` in the test project:

```json
{
  "mcpServers": {
    "design-context": {
      "command": "node",
      "args": ["/path/to/layout-context/dist/bin/cli.js", "serve"],
      "cwd": "/Users/you/test-linear-marketing"
    }
  }
}
```

### Connect Figma MCP

```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

Authenticate via OAuth when prompted.

---

## Phase 3: Generate a Marketing Page

Open Claude Code in the test project and send this prompt:

```
I have a design system loaded via the design-context MCP server.

1. Call get_design_system to load the full design system
2. Call get_tokens with format "css" to get all token values
3. Call list_components to see available components

Then build me a marketing landing page for a developer productivity tool called "FlowBoard".

Requirements:
- Hero section with headline, subheadline, and CTA button
- 3-column feature grid with icons
- Social proof section with company logos
- Pricing section with 3 tiers
- Dark footer with links

Use the design system tokens and component patterns exactly.
The page should feel like it belongs on linear.app.

After generating the code, call the preview tool to render it live.
```

**What happens:**
- Agent calls `get_design_system` → receives the full DESIGN.md
- Agent calls `get_tokens` → receives CSS custom properties
- Agent calls `list_components` → sees Button, Input, Card, Badge, Avatar
- Agent generates a full marketing page TSX using Linear's tokens
- Agent calls `preview` → code is transpiled and rendered at `localhost:4321`

---

## Phase 4: Preview in the Live Canvas

The preview canvas auto-opens at `http://localhost:4321`.

**Verify:**
- [ ] Dark background matching Linear's aesthetic
- [ ] Components use the correct tokens (colours, fonts, spacing)
- [ ] Viewport toggles work (desktop 1280px / tablet 768px / mobile 375px)
- [ ] Source code panel shows the generated TSX

**Iterate:**
```
Make the hero headline larger and add a subtle gradient behind the CTA.
Then preview it again.
```

The agent updates the code and calls `preview` again → the canvas updates instantly via WebSocket.

---

## Phase 5: Push to Figma

Once you're happy with the preview:

```
The preview looks great. Now push this to Figma so the designer can review it.

1. Call push_to_figma with the marketing page code
2. Then use Figma MCP's generate_figma_design tool to capture the live preview
   at http://localhost:4321 into this Figma file: [PASTE YOUR FIGMA FILE URL]
```

**What happens:**
1. Agent calls `push_to_figma` → receives token context + instructions
2. Agent calls Figma MCP's `generate_figma_design` → captures the live preview at `:4321`
3. The marketing page appears as editable frames in your Figma file

---

## Phase 6: Designer Edits in Figma

Open the Figma file. The marketing page is now editable design frames.

Make some changes:
- Change the hero background from `#0A0A0F` to `#0D1117`
- Increase the CTA button border radius from `6px` to `12px`
- Adjust section spacing from `24px` to `32px`
- Change a headline font weight from `600` to `700`

Save the file.

---

## Phase 7: Read Changes Back

```
The designer has updated the Figma file with these changes:
- Darker hero background
- Rounder CTA button
- More section spacing
- Bolder headlines

Use Figma MCP's get_design_context tool to read the updated design from:
[PASTE FIGMA FRAME URL]

Then:
1. Update the code to match the designer's changes
2. Call check_compliance to verify it still follows the design system
3. Call preview to render the updated version
```

**What happens:**
1. Agent calls Figma MCP's `get_design_context` → reads updated layout + styles
2. Agent updates the TSX code to match
3. Agent calls `check_compliance` → validates against design tokens
4. Agent calls `preview` → renders the updated version at `:4321`

---

## Phase 8: Final Verification

- [ ] Preview matches the Figma design
- [ ] Compliance check passes (or shows only minor warnings)
- [ ] Code uses design tokens, not hardcoded values
- [ ] The full loop completed without manual code editing

**The loop:**
```
Layout (extract) → DESIGN.md → Agent (generate) → Preview (:4321)
    → Figma (push) → Designer (edit) → Agent (read back) → Preview (:4321)
```

---

## Troubleshooting

### Preview server doesn't start
Check if port 4321 is already in use:
```bash
lsof -i :4321
```

### Figma MCP authentication fails
Re-run the auth flow:
```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

### Transpilation errors in preview
The preview transpiles TSX server-side. If you see errors:
- Check the component uses standard React 18 patterns
- Ensure imports are self-contained (the preview iframe has React + Tailwind CDN)

### check_compliance false positives
The compliance checker uses heuristic rules. If it flags legitimate values,
the agent can explain why they're correct and proceed.

---

*Generated by Layout — layout.design*
