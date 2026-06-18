#!/usr/bin/env bash
#
# Build the source-tagging wasm for EVERY swc_core ABI we ship, from one source.
# Next bundles a different swc_core per minor, and a wasm is locked to its ABI,
# so we ship one wasm per supported Next range and pick at runtime (see
# src/plugins/next/swc.ts). End users need no Rust — the .wasm files are
# committed in ../assets and shipped in the npm tarball.
#
#   assets/layout-swc-plugin-90.wasm  → Next 14.2.x (swc_core 0.90.31)
#   assets/layout-swc-plugin-35.wasm  → Next 15.5.x (swc_core 35)
#   assets/layout-swc-plugin-57.wasm  → Next 16.2.x (swc_core 57)
#
set -euo pipefail
cd "$(dirname "$0")"                 # swc-plugin/
ASSETS="../assets"
TARGET="wasm32-wasip1"
mkdir -p "$ASSETS"

restore() { [ -f Cargo.toml.bak ] && mv -f Cargo.toml.bak Cargo.toml || true; }
trap restore EXIT

# build_one <swc_core_version> <features> <out.wasm> <target_dir> [serde_pin]
# swc_core_version is the FULL crates version ("57.0.0", "0.90.31") because the
# old 0.x scheme (Next 14.2 = 0.90.31) isn't <major>.0.0. serde_pin is optional:
# swc_common 0.33.26 (pulled by swc_core 0.90.31) uses `serde::__private`, which
# serde >= 1.0.219 removed, so that build pins an older serde.
build_one() {
  local swc="$1" feat="$2" out="$3" td="$4" serde="${5:-}"
  echo "==> swc_core ${swc} (features: ${feat:-none}) → ${out}"
  cp Cargo.toml Cargo.toml.bak
  # Pin swc_core to the target ABI for this build.
  sed -E -i '' 's/^swc_core = \{ version = "=[0-9.]+"/swc_core = { version = "='"${swc}"'"/' Cargo.toml
  [ -n "$serde" ] && sed -i '' 's|serde = { version = "[^"]*"|serde = { version = "'"${serde}"'"|' Cargo.toml
  rm -f Cargo.lock
  local feats=()
  [ -n "$feat" ] && feats=(--features "$feat")
  CARGO_TARGET_DIR="$td" cargo build --release --target "$TARGET" ${feats[@]+"${feats[@]}"}
  cp "${td}/${TARGET}/release/layout_swc_plugin.wasm" "${ASSETS}/${out}"
  restore
}

# Build the legacy ABIs first, then default (57) LAST so the committed
# Cargo.toml + Cargo.lock end on the default pin.
build_one 35.0.0  legacy_jsx_attr             layout-swc-plugin-35.wasm target-35
build_one 0.90.31 legacy_jsx_attr,legacy_ident layout-swc-plugin-90.wasm target-90 "=1.0.197"
build_one 57.0.0  ""                          layout-swc-plugin-57.wasm target-57
# Leave Cargo.lock resolved for the default (57) pin.
rm -f Cargo.lock
cargo build --release --target "$TARGET" >/dev/null 2>&1 || true

echo "==> done:"
ls -lh "${ASSETS}"/layout-swc-plugin-*.wasm
