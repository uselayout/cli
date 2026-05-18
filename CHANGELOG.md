# Changelog

All notable changes to `@layoutdesign/context` are documented here.

This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.10.1]

### Changed
- The Next.js plugin now emits a one-time warning when **Turbopack**
  (`next dev --turbo`, default in newer Next) is detected: the dev
  source-tagging runs via the webpack hook, which Turbopack ignores, so
  layout Live couldn't resolve elements — previously this failed
  silently. Run `next dev` without `--turbo` for the visual-edit loop.
  App Router client **and** server components are tagged under webpack
  dev (all `.tsx`/`.jsx`); native Turbopack/SWC tagging is tracked
  separately.

---

## [0.10.0]

### Added
- The build plugin now tags capitalised **component usage sites** that
  pass a static `className` (`<Pill className="p-4" />`), so layout Live
  can resolve and edit that class in place — previously every component
  usage was skipped and surfaced as an uneditable "library component".
  Dynamic classNames (`cn()`, `cva()`, expressions) and component usages
  without a `className` stay untagged by design. The component must
  forward unknown props for the attributes to reach the DOM; otherwise
  resolution falls back to component-name only.

---

## [0.9.0]

### Added
- `install --live` now augments `AGENTS.md` and `.cursorrules` with the
  layout-live managed block too (only when the project already has them),
  alongside the always-managed `CLAUDE.md` block. Idempotent.
- New `live-notify [file]` CLI subcommand: the optional Claude Code hook
  pings a running layout Live over its Unix socket after Claude edits a
  file. Silent no-op when Live isn't running.

---

## [Unreleased]

### Changed
- Renamed `DESIGN.md` to `layout.md` across the entire codebase — file names, constants, variables, function names, tool descriptions, documentation.
- `DESIGN_MD_FILE` constant renamed to `LAYOUT_MD_FILE` with value `"layout.md"`.
- `parseDesignMd()` renamed to `parseLayoutMd()`.
- Kit interface property `designMd` renamed to `layoutMd`.
- Kit loader auto-migrates existing `DESIGN.md` files to `layout.md` on load with a console notice.
- ZIP import (`import` command) accepts `DESIGN.md` from old bundles and writes it as `layout.md`.
- Bundled kits (`linear-lite`, `stripe-lite`, `notion-lite`) renamed to use `layout.md`.

---

## [0.8.0] - 2026-05-16

### Added
- **Build plugins (preview).** Two new sub-exports of `@layoutdesign/context` that inject `data-layout-source-*` attributes into JSX during dev so layout Live can resolve a clicked element to its exact source location:
  - `@layoutdesign/context/vite-plugin` — `import layout from "@layoutdesign/context/vite-plugin"` (place before `@vitejs/plugin-react`). `enforce: 'pre'`, `apply: 'serve'`.
  - `@layoutdesign/context/next-plugin` — `import withLayout from "@layoutdesign/context/next-plugin"`; a `NextConfig` HOC that adds a dev-only webpack rule (Babel via webpack) and composes with an existing user `webpack` override.
- Shared Babel transform used by both plugins. Injects `data-layout-source-file`, `data-layout-source-line`, `data-layout-source-col`, `data-layout-component`. Skips Fragments, capitalised/member-expression components, the raw-HTML escape-hatch prop, and pre-attributed elements. Idempotent, dev-only, source-map-preserving, and pass-through on malformed input.
- `install --live` flag (and an interactive "Set up layout Live?" prompt on a TTY): detects Vite/Next from `package.json`, adds the matching plugin to the config via `recast` (formatting + comments preserved; original backed up to `<config>.layout-backup`), scaffolds `.layout/live/` with `config.json` + a local `.gitignore`, and appends the delimited `layout-live` managed block to `CLAUDE.md`. Every step is idempotent.

### Notes
- Plugins are no-ops in production builds — debugging attrs never ship to end users.
- The existing 18 MCP tools and all prior exports are unchanged; `exports` only gains the two additive sub-exports.

---

## [0.7.0] - 2026-05-16

### Added
- **Live integration (preview).** Four new MCP tools that let AI coding agents query the layout Live desktop app:
  - `get-selected-element` — the element currently selected in Live (returns `{ running: false }` when Live isn't running).
  - `get-recent-visual-edits` — recent class/token/inline-style edits; reads Live's socket when running, falls back to the on-disk `.layout/live/recent-edits.json` log otherwise.
  - `lock-file` / `unlock-file` — coordinate file writes between Claude Code and Live via an atomic, `proper-lockfile`-backed `.layout/live/locks.json`. Stale (expired) locks are taken over automatically with a warning.
- `check-setup` now reports an additive `live` status field: `{ installed, running, version?, project? }`. No breaking change to existing output.
- Shared `_live-socket` helper: line-delimited JSON client for Live's Unix socket (named pipe on Windows). `ENOENT` / stale-socket / timeout all resolve cleanly to "not running" rather than throwing.
- Unit test suite (`npm test`) covering tool registration, Zod schema validation, socket-absent fallback paths, and lock acquire/release/conflict/expiry-takeover.

### Notes
- All four tools register unconditionally and return cleanly-typed "Live not running" responses when the desktop app is absent.
- The existing 14 tools are unchanged (now 18 total).

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
