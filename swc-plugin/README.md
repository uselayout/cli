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
mismatch is a **hard build failure**, not a graceful degrade. Next bumps its
bundled swc_core almost every minor, so we ship **one wasm per supported ABI**
and auto-pick by the installed Next version.

- **Shipped wasms** (`swc-plugin/build.sh` builds all from one source):
  - `assets/layout-swc-plugin-90.wasm` → **Next 14.2.x** (swc_core 0.90.31)
  - `assets/layout-swc-plugin-35.wasm` → **Next 15.5.x** (swc_core 35)
  - `assets/layout-swc-plugin-57.wasm` → **Next 16.2.x** (swc_core 57)
- The `-90` ABI key is the old `0.90.x` scheme — it is OLDER than 35/57, not
  newer, despite the larger number. `SHIPPED_SWC_CORES` keys are identifiers,
  not a newness rank; use `newestShippedSwcCore()` for "latest", never `Math.max`.
- Parity tests run against `@swc/core` 1.15.0 (the swc_core-57 ABI).
- **Validated end-to-end, no env var (default-on):**
  - Next **14.2.35**: `next build` on an App Router page tags the prerendered
    HTML (`data-layout-source-file` + component name) and the build passes. The
    90 build needs `legacy_jsx_attr` + `legacy_ident` + a pinned older serde.
  - Next **15.5.19**: tags serve under `next dev` (webpack) AND `--turbopack`;
    `next build` passes.
  - Next **16.2.7**: tags serve under default Turbopack dev AND `--webpack`;
    server component exporting `metadata` builds + renders; `next build` passes;
    `live` binding works (dev-info written under Turbopack).
- **Adding a new Next minor**: list its swc_core in `SHIPPED_SWC_CORES` +
  `NEXT_SWC_CORE` (`src/plugins/next/swc.ts`), add the ABI to `build.sh`
  (flipping `legacy_jsx_attr` if the JSXAttrValue shape differs), rebuild, and
  bump the `@swc/core` devDependency to a parity-test host on that ABI.
- The JSXAttrValue shape changed across swc_core (≤35 = `Lit(Lit::Str)`,
  ≥45 = `Str(Str)`); `lib.rs` selects it via the `legacy_jsx_attr` cargo feature.

> **Next 16 build note:** Next 16 builds with Turbopack by default and errors if
> a `webpack` config is present without a `turbopack` config. `withLayout`
> always carries a webpack hook, so it also emits a (merged) `turbopack` config
> to keep `next build` working. This applies to all Next 16 users, independent of
> SWC opt-in.

### Auto-detect + modes (default ON)

`withLayout` reads the installed Next version, looks up its swc_core ABI, and
**auto-picks the matching wasm** before Next loads anything. A Next we don't ship
an ABI for is skipped cleanly (never a broken build). So on a supported Next, the
user just wires the plugin once and it works — no env var.

`LAYOUT_LIVE_SWC` modes:

| Value | Behaviour |
|-------|-----------|
| unset / `1` | **guarded (default ON)** — auto-pick + inject the wasm matching the installed Next (15.5.x → `-35`, 16.2.x → `-57`). Unsupported Next versions skip safely. |
| `0` / `off` | **disabled** — App Router tagging paused. |
| `force` | **forced** — inject the newest shipped ABI regardless of the version check. Explicit risk; for users on an unsupported Next who accept a possible build failure. |

```bash
# App Router, supported Next (15.5.x or 16.2.x) — nothing extra needed:
next dev
```

To widen support, add a wasm for the new ABI (see above); the `NEXT_SWC_CORE`
table + `resolveSwcDecision` already centralise the selection. Validated
end-to-end on Next 15.5.19 and 16.2.7; the guard skips the minors we don't ship
an ABI for (15.4→34, 16.0→45, 16.1→49) until a matching wasm is added.

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
