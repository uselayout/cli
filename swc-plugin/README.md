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

- Current pin: `swc_core = "=57.0.0"` (see [`Cargo.toml`](./Cargo.toml)) — the
  version **Next 16.2.x bundles** (current stable; from Next's own `Cargo.lock`).
  Parity tests run against `@swc/core` 1.15.0 (same ABI range).
- **Validated end-to-end on Next 16.2.7**: with `LAYOUT_LIVE_SWC=1`, source tags
  serve correctly under default Turbopack dev AND `next dev --webpack`, a server
  component exporting `metadata` builds and renders, `next build` (production)
  succeeds, and `live` binding works (dev-info written under Turbopack).
- When Next bumps its internal SWC, re-pin `swc_core`, rebuild the wasm, bump the
  `@swc/core` devDependency to a matching ABI, and add the Next minor to the
  `NEXT_SWC_CORE` table in `src/plugins/next/swc.ts`. The CI job
  (`.github/workflows/swc-plugin.yml`) rebuilds + re-runs parity to guard against
  silent breakage.

> **Next 16 build note:** Next 16 builds with Turbopack by default and errors if
> a `webpack` config is present without a `turbopack` config. `withLayout`
> always carries a webpack hook, so it also emits a (merged) `turbopack` config
> to keep `next build` working. This applies to all Next 16 users, independent of
> SWC opt-in.

### Version guard + modes

Because the ABI is Next-version-specific AND a mismatch is a hard build failure,
`withLayout` PREDICTS compatibility from the installed Next version (a
`major.minor → swc_core` table read from Next's own `Cargo.lock`) BEFORE Next
tries to load the plugin. An incompatible Next is skipped with a clear warning,
never a broken build.

`LAYOUT_LIVE_SWC` modes:

| Value | Behaviour |
|-------|-----------|
| unset / `0` | **off** — App Router tagging paused (default; no behaviour change) |
| `1` | **guarded** — inject ONLY when the installed Next's swc_core matches the shipped wasm (today: Next 16.2.x). Other versions skip + warn. Safe: never breaks the build. |
| `force` | **forced** — inject regardless of the version guard. Explicit risk; for users who rebuilt the wasm for their own Next. |

```bash
# App Router, default Turbopack, on a supported Next (16.2.x):
LAYOUT_LIVE_SWC=1 next dev
```

Default stays off: even `=1` is safe (guarded), but leaving the native path
opt-in keeps the zero-surprise default. To widen support beyond the single
targeted Next minor, ship additional wasms per swc_core ABI and select by Next
version (the `NEXT_SWC_CORE` table + `resolveSwcDecision` already centralise the
logic). Validated end-to-end on Next 16.2.7; the guard skips other minors
(15.5→35, 16.0→45, 16.1→49) until a matching wasm ships.

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
