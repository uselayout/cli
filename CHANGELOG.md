# Changelog

All notable changes to `@layoutdesign/context` are documented here.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.14] - 2026-03-15

### Added
- `serve-local` CLI command — serves a local directory over HTTP using `python3 http.server`, auto-detecting a free port from 8765 (skipping ports used by VSCode, Next.js, Vite). Designed for use with the `url_to_figma` MCP tool, which cannot capture `file://` URLs.
- Port auto-detection polls until the server is ready before returning the URL.

### Fixed
- `install`: `addFigmaMcpServer()` now always attempts `claude mcp add --scope user` and catches "already exists" errors gracefully, fixing a bug where the `figma@claude-plugins-official` plugin short-circuited installation and OAuth state was lost between sessions.

---

## [0.1.13] - 2026-03-15

### Added
- `install` now automatically sets up Figma MCP and Playwright MCP alongside Layout MCP. Use `--skip-figma` to opt out.
- `doctor --fix` flag: auto-installs missing MCP servers (Figma MCP, Playwright MCP) instead of just reporting them.
- All auto-installed MCP servers are registered with `--scope user` for cross-project access.

---

## [0.1.12] - 2026-03-13

### Added
- `doctor` CLI command — checks Node.js version, Claude CLI availability, Figma MCP, and Playwright MCP. Reports missing dependencies with actionable fix instructions.
- Defensive "IGNORE Figma MCP capture instructions" warnings added to `url_to_figma` and `design_in_figma` tool responses, matching the pattern already in `push_to_figma`.
- MCP server version now synced from `package.json` at runtime (was hardcoded `0.1.0`).

---

## [0.1.11] - 2026-03-13

### Fixed
- Viewport capture: removed CSS `max-width` constraint from the `/capture` page — Tailwind media queries require actual viewport width, not container width, to render correctly.
- `push_to_figma`: switched to Playwright `browser_resize` for viewport sizing, matching `url_to_figma` behaviour.
- `push_to_figma`: rewrote agent instructions to be directive ("Execute Immediately") to prevent Claude from pausing to ask for confirmation.
- Overrode Figma MCP's default capture instructions in `push_to_figma` and `url_to_figma` to force Playwright (`browser_resize` + `browser_navigate` + `browser_evaluate`) for correct responsive rendering — Figma MCP's built-in `open` command bypasses `browser_resize`.

### Added
- `figmaUrl` input param on `push_to_figma` to push into an existing Figma file instead of always creating a new one.
- Playwright MCP listed as a prerequisite alongside Figma MCP in tool documentation.

---

## [0.1.10] - 2026-03-13

_Version bump. See 0.1.11 for associated changes._

---

## [0.1.9] - 2026-03-12

### Changed
- Full rebrand from `@superduperui/context` to `@layoutdesign/context`.
- CLI command renamed from `superduper-context` to `layout-context`.
- MCP server key changed from `superduper` to `layout`.
- Directory convention changed from `.superduper/` to `.layout/` (backward-compatible: falls back to `.superduper/` with a deprecation warning).
- All URLs updated to `layout.design`.
- Kit manifests and preview UI rebranded.

---

## [0.1.8] - 2026-03-11

### Added
- `update_tokens` MCP tool — updates token values in `tokens.css`, `tokens.json`, and `DESIGN.md` simultaneously, keeping the entire design system consistent without re-extracting from Figma or Layout Studio.

---

## [0.1.7] - 2026-03-11

### Added
- `push_to_figma` now pushes component code to the preview server via WebSocket before returning Figma capture instructions (no more temporary HTML files).
- `import` command auto-merges design system rules into the project root `CLAUDE.md` using HTML comment markers for idempotent updates. Re-importing replaces the previous section cleanly.
- `install --global` flag passes `--scope user` to `claude mcp add` for cross-project access.
- Warning printed on `import` when the current directory does not appear to be a project root.

### Fixed
- Preview server: added WSS error handler; `EADDRINUSE` is now non-fatal (MCP server continues without preview).
- Preview server: `openBrowser` option added so it does not open a tab when running as a background MCP process.

---

## [0.1.6] - 2026-03-11

### Added
- `design_in_figma` MCP tool — takes a natural language prompt and returns design tokens, component inventory, and step-by-step instructions for calling Figma MCP's `generate_figma_design`. Enables AI agents to design UI in Figma using `DESIGN.md` context before writing any code.
- README updated: tool count 7 → 9, Figma Integration section, compliance checker documentation, `install` command documented.

---

## [0.1.5] - 2026-03-10

### Added
- `url_to_figma` MCP tool — bridge tool that returns step-by-step instructions for capturing any public URL as editable Figma frames via Playwright + Figma MCP. Supports `desktop`, `tablet`, and `mobile` viewports; each gets its own `captureId` and Figma frame.
- Multi-viewport support added to `push_to_figma` and the `/capture` route.

---

## [0.1.4] - 2026-03-10

### Added
- `/capture` route on the preview server — serves the last-previewed component as a standalone page (no chrome) so Figma MCP's capture script can cleanly read the DOM. `push_to_figma` updated to reference the capture URL.

---

## [0.1.0] - 2026-03-10

### Added
- Initial release as `@superduperui/context`.
- MCP server with 7 tools: `get_design_system`, `get_tokens`, `get_component`, `list_components`, `check_compliance`, `preview`, `push_to_figma`.
- CLI with 5 commands: `init`, `serve`, `import`, `use`, `list`.
- Live preview server at `:4321` with WebSocket hot-reload and server-side TSX transpilation.
- Compliance checker with 4 rules: `hardcoded-colours`, `hardcoded-spacing`, `missing-token-reference`, `unknown-component`.
- 3 starter kits: `linear-lite`, `stripe-lite`, `notion-lite`.
- Figma capture integration via `/capture` route.

---

[Unreleased]: https://github.com/uselayout/layout-context/compare/v0.1.14...HEAD
[0.1.14]: https://github.com/uselayout/layout-context/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/uselayout/layout-context/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/uselayout/layout-context/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/uselayout/layout-context/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/uselayout/layout-context/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/uselayout/layout-context/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/uselayout/layout-context/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/uselayout/layout-context/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/uselayout/layout-context/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/uselayout/layout-context/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/uselayout/layout-context/compare/v0.1.0...v0.1.4
[0.1.0]: https://github.com/uselayout/layout-context/releases/tag/v0.1.0
