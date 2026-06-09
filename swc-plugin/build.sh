#!/usr/bin/env bash
#
# Build the source-tagging wasm for EVERY swc_core ABI we ship, from one source.
# Next bundles a different swc_core per minor, and a wasm is locked to its ABI,
# so we ship one wasm per supported Next range and pick at runtime (see
# src/plugins/next/swc.ts). End users need no Rust — the .wasm files are
# committed in ../assets and shipped in the npm tarball.
#
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

build_one() {
  local swc="$1" feat="$2" out="$3" td="$4"
  echo "==> swc_core ${swc} (features: ${feat:-none}) → ${out}"
  cp Cargo.toml Cargo.toml.bak
  # Pin swc_core to the target ABI for this build.
  sed -E -i '' 's/^swc_core = \{ version = "=[0-9.]+"/swc_core = { version = "='"${swc}"'.0.0"/' Cargo.toml
  rm -f Cargo.lock
  local feats=()
  [ -n "$feat" ] && feats=(--features "$feat")
  CARGO_TARGET_DIR="$td" cargo build --release --target "$TARGET" ${feats[@]+"${feats[@]}"}
  cp "${td}/${TARGET}/release/layout_swc_plugin.wasm" "${ASSETS}/${out}"
  restore
}

# Build the legacy (35) first, then default (57) LAST so the committed
# Cargo.toml + Cargo.lock end on the default pin.
build_one 35 legacy_jsx_attr layout-swc-plugin-35.wasm target-35
build_one 57 ""              layout-swc-plugin-57.wasm target-57
# Leave Cargo.lock resolved for the default (57) pin.
rm -f Cargo.lock
cargo build --release --target "$TARGET" >/dev/null 2>&1 || true

echo "==> done:"
ls -lh "${ASSETS}"/layout-swc-plugin-*.wasm
