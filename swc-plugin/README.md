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

- Current pin: `swc_core = "68"` (see [`Cargo.toml`](./Cargo.toml)), verified to
  load in `@swc/core` 1.15.40.
- When a new Next major bumps its internal SWC, the pin may need updating and
  the wasm rebuilding. The CI job (`.github/workflows/swc-plugin.yml`) rebuilds
  and re-runs parity on every change to guard against silent breakage.

Because of this, the native path is **opt-in** (`LAYOUT_LIVE_SWC=1`) until the
shipped wasm's ABI is verified across the Next versions we support. Default-off
preserves the safe behaviour (App Router tagging paused, app builds normally).

```bash
# App Router, with Turbopack, once opted-in:
LAYOUT_LIVE_SWC=1 next dev --turbopack
```

Wiring lives in [`src/plugins/next/swc.ts`](../src/plugins/next/swc.ts)
(`swcPluginEntry`) and [`src/plugins/next/index.ts`](../src/plugins/next/index.ts)
(`withLayout` injects `experimental.swcPlugins`).
