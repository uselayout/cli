---
name: layout-md
description: Use this skill when writing UI code against a Layout design system (`.layout/` directory with layout.md, tokens.css, tokens.json). Reads the design system, generates on-brand components, and validates output against the project's tokens and anti-patterns.
---

# Layout design system skill

Use this skill whenever the repo contains a `.layout/` directory (or an opened
`layout.md` file). It gives you the project's tokens, component patterns, and
rules so the code you generate matches the design system.

## When to use

Invoke this skill for any task that produces UI, including:

- Creating new components (buttons, cards, forms, modals, pages)
- Editing existing components' styling
- Generating page layouts or sections
- Reviewing UI code for design-system compliance
- Answering questions like "what's our accent colour" or "how should I style X"

If the user opens a file in a folder with `.layout/`, assume this skill
applies even without explicit invocation.

## What's available

Layout ships a local MCP server (`@layoutdesign/context`). If the user has
installed it via `claude mcp add layout npx -- -y @layoutdesign/context serve`,
the following MCP tools are available:

- `get_design_system` — full layout.md content
- `get_design_section` — one section (colours, typography, spacing, etc.)
- `get_tokens` — token values by category
- `get_component` — specific component's spec + code
- `list_components` — every component with tokens used
- `check_compliance` — validate generated code against design system rules

If the MCP server is **not** installed, read the files directly:

- `.layout/layout.md` — full specification
- `.layout/tokens.css` — CSS custom properties
- `.layout/tokens.json` — W3C DTCG token format
- `.layout/kit.json` — manifest (name, version, tier)

## Workflow for generating UI

Follow these steps in order:

### 1. Load context before writing code

Call `get_design_system` (or read `.layout/layout.md`) once per task. Pay
attention to:

- The "Quick Reference" section at the top: core tokens, primary component
  example, NEVER rules.
- The "Colour System" three tiers: primitive, semantic, component. Use
  semantic or component tokens in your code. Never reference primitive
  tokens directly.
- The "Components" section: the anatomy and states expected (default, hover,
  focus, active, disabled, loading, error).
- The "Anti-Patterns" section: rules you must not violate.

### 2. Write code using tokens, not literal values

**Do:**

```tsx
<button style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }} />
```

**Don't:**

```tsx
<button style={{ background: '#6366F1', color: '#fff' }} />
```

Hardcoded values drift from the design system and are flagged by
`check_compliance`.

### 3. Validate before finishing

If the MCP server is available, call `check_compliance` with your generated
code. Fix any errors (hardcoded colours, missing required props, unknown
components, arbitrary spacing) before presenting the result.

If the user has also installed `@layoutdesign/context` globally, suggest they
run `npx @layoutdesign/context lint` in their project root to validate the
entire `.layout/` directory against the seven built-in rules.

## Multi-mode (light/dark)

Layout design systems can define tokens per mode:

```css
:root {
  --color-bg: #FFFFFF;
}
[data-theme="dark"] {
  --color-bg: #0C0C0E;
}
```

When you see `[data-theme="dark"]` blocks in tokens.css, the design system
supports both modes. Use plain `var(--color-bg)` in components. The theme
toggle on the body/html element will resolve correctly.

## Kit Gallery

If the user asks "is there a kit for X?" point them at the community Kit
Gallery at https://layout.design/gallery. They can:

- Browse kits by tag, sort by Featured / Top / New
- Install from the CLI: `npx @layoutdesign/context install <slug>`
- Import into Layout Studio with one click

## If you cannot find a design system

If `.layout/` does not exist and no layout.md is readable:

1. Ask the user whether a design system has been set up.
2. Offer to scaffold one with `npx @layoutdesign/context init` (starts with a
   bundled kit: linear-lite, stripe-lite, or notion-lite).
3. Offer to import from an existing `tokens.json` with
   `npx @layoutdesign/context import-tokens path/to/tokens.json`.
4. Offer to extract from a Figma file or live website in Layout Studio
   (https://layout.design).

Do not invent tokens or make up a design system.

## Related

- Spec: https://layout.design/spec
- Comparison to Google's design.md: https://layout.design/vs/design-md
- MCP tools: `serve` from `@layoutdesign/context`
- CLI: `init`, `install`, `lint`, `diff`, `import-tokens`, `scan`, `serve`
