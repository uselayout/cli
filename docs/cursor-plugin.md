# Layout for Cursor

How Cursor users install Layout today, and the checklist for submitting Layout
to the Cursor marketplace (cursor.com/marketplace) when we file it.

## MCP configuration

Cursor reads MCP servers from `.cursor/mcp.json` (project scope) or
`~/.cursor/mcp.json` (global scope). The Layout entry:

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

The CLI writes this automatically:

```bash
npx @layoutdesign/context install --target cursor
```

That command also creates the static context files Cursor reads without MCP:

- `AGENTS.md` with the design-system managed block (created when absent)
- `.cursor/rules/layout.mdc`, a project rule carrying the kit's token quick
  reference and rules (created unless a legacy `.cursorrules` exists, in which
  case that file is augmented instead)

A standalone export of the Cursor rule is available too:

```bash
npx @layoutdesign/context export --format cursor
```

### One-click install deeplink

Cursor supports install deeplinks of the form:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=layout&config=<base64>
```

where `<base64>` encodes the server config object:

```json
{ "command": "npx", "args": ["-y", "@layoutdesign/context", "serve"] }
```

Generate the encoded value with:

```bash
echo -n '{"command":"npx","args":["-y","@layoutdesign/context","serve"]}' | base64
```

Use this deeplink on layout.design install pages and in the README badge.

## Marketplace submission checklist

Cursor's marketplace listing for MCP servers is submission-based rather than
manifest-based; there is no public manifest spec equivalent to Claude Code's
`.claude-plugin/plugin.json` at the time of writing. Submission happens via
[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

Before filing:

- [ ] Name: **Layout** (server key `layout`)
- [ ] One-line description: "Serve and enforce your design system in any
      agent: design tokens, component specs, and compliance checks over MCP."
- [ ] Install command: `npx -y @layoutdesign/context serve`
- [ ] Config JSON (above) verified against a clean Cursor profile
- [ ] Deeplink verified (opens Cursor, prompts to add the `layout` server)
- [ ] Logo assets: square mark on transparent background (512x512 PNG + SVG)
- [ ] Homepage: https://layout.design
- [ ] Repository: https://github.com/uselayout/layout-context (MIT)
- [ ] Docs page for Cursor at layout.design covering: install, the 20 MCP
      tools, `.cursor/rules/layout.mdc`, and troubleshooting
- [ ] Contact email and support channel confirmed
- [ ] Screenshot set: tokens answer, `check-compliance` catch, `add` command

Submission has NOT been filed yet. When it is, record the listing URL and any
submission ID in this file and in the repositioning plan.
