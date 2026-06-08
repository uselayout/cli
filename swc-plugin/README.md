# layout-swc-plugin

Native SWC source-tagging plugin for Layout Live. The Rust/Wasm twin of
[`src/plugins/transform.ts`](../src/plugins/transform.ts) (the parity oracle).

## Why it exists

The Babel-via-webpack loader can't tag **Next.js App Router** projects:
re-emitting a React Server Component through Babel makes Next misclassify it as
a client module, which breaks the build. A native SWC plugin runs inside Next's
own pipeline instead, so it tags source under both `next dev` and
`next dev --turbopack` without disturbing RSC.

It injects the same four attributes on the same set of JSX elements, with the
same skip rules and line/col semantics as `transform.ts`:

```
data-layout-source-file   — path relative to projectRoot (POSIX)
data-layout-source-line   — 1-indexed line
data-layout-source-col    — 1-indexed column (SWC 0-based col + 1)
data-layout-component     — nearest enclosing component name
```

Parity is asserted on **which elements are tagged and the four attribute
values** (not output formatting — Babel emits JSX, SWC lowers to
`React.createElement`). See [`test/swc-parity.test.ts`](../test/swc-parity.test.ts):
every fixture in `test/transform.test.ts` has a parity twin.

## Build

```bash
rustup target add wasm32-wasip1   # one-time
npm run build:wasm                # from repo root → assets/layout-swc-plugin.wasm
```

The prebuilt `.wasm` is committed in [`assets/`](../assets) and shipped in the
npm tarball (`package.json` `files`). **End users need no Rust toolchain.**

## ABI coupling (important)

A wasm SWC plugin is locked to the `swc_core` version it was built against,
which must be ABI-compatible with the SWC bundled in the user's Next.js. A
mismatch is a **hard build failure**, not a graceful degrade.

- Current pin: `swc_core = "=35.0.0"` (see [`Cargo.toml`](./Cargo.toml)) — the
  version **Next 15.5.x bundles** (from Next's own `Cargo.lock`). Parity tests
  run against `@swc/core` 1.13.5 (same ABI range).
- **Validated end-to-end on Next 15.5.19**: with `LAYOUT_LIVE_SWC=1`, source
  tags serve correctly under BOTH `next dev` and `next dev --turbopack`, a
  server component exporting `metadata` builds and renders, and `next build`
  (production) is unaffected (the plugin is dev-only).
- When a new Next major bumps its internal SWC, re-pin `swc_core`, rebuild the
  wasm, and bump the `@swc/core` devDependency to a matching ABI. The CI job
  (`.github/workflows/swc-plugin.yml`) rebuilds + re-runs parity to guard
  against silent breakage.

Because the ABI is Next-version-specific, the native path is **opt-in**
(`LAYOUT_LIVE_SWC=1`) and default-off until verified across the Next range we
support. Default-off preserves the safe behaviour (App Router tagging paused,
app builds normally).

```bash
# App Router, with Turbopack, once opted-in:
LAYOUT_LIVE_SWC=1 next dev --turbopack
```

## Plugin entry: a specifier, not a path

`experimental.swcPlugins` entries must be a **node-resolvable specifier**, not
an absolute filesystem path: Turbopack resolves them through its module
resolver and rejects absolute paths (`Module not found`). The wasm is therefore
exposed via package `exports` as `@layoutdesign/context/swc-plugin.wasm`, and
`swcPluginEntry` passes that specifier (webpack resolves it too).

The host also passes the filename in different shapes — webpack gives an
ABSOLUTE path, Turbopack a PROJECT-RELATIVE one — so the plugin normalises both
to the same `data-layout-source-file` value (see `make_relative` in
[`src/lib.rs`](./src/lib.rs)).

Wiring lives in [`src/plugins/next/swc.ts`](../src/plugins/next/swc.ts)
(`swcPluginEntry`, `SWC_PLUGIN_SPECIFIER`) and
[`src/plugins/next/index.ts`](../src/plugins/next/index.ts) (`withLayout` injects
`experimental.swcPlugins`).
