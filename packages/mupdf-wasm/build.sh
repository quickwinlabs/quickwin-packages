#!/usr/bin/env bash
# Rebuild the QuickWin/WAMR-tailored mupdf-wasm from source.
#
# The committed artifacts (mupdf.js / mupdf-wasm.js / mupdf-wasm.wasm / *.d.ts)
# in this directory are produced by this script; it exists so anyone can audit
# and reproduce them. CI publishes the committed artifacts as-is.
#
# Build inputs (must match README.md):
#   - mupdf commit:  05c6564035d20e3ed1998ffa392c9d17b2cd6a45
#   - emsdk:         4.0.8
#   - patch:         patches/wamr-compat.patch (WAMR compatibility)
#
# Output: ./dist/{mupdf.js,mupdf-wasm.js,mupdf-wasm.wasm,mupdf.d.ts,mupdf-wasm.d.ts}
set -euo pipefail

MUPDF_COMMIT=05c6564035d20e3ed1998ffa392c9d17b2cd6a45
EMSDK_VERSION=4.0.8
HERE="$(cd "$(dirname "$0")" && pwd)"
PATCH="$HERE/patches/wamr-compat.patch"
WORK="$(mktemp -d /tmp/mupdf-wasm-build.XXXXXX)"
echo "workdir: $WORK"

# --- emsdk (cached at /tmp/emsdk, same path the patch expects) ---
if [ ! -d /tmp/emsdk ]; then
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git /tmp/emsdk
fi
(cd /tmp/emsdk && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION")

# --- mupdf source at the pinned commit ---
git clone https://github.com/ArtifexSoftware/mupdf.git "$WORK/mupdf"
cd "$WORK/mupdf"
git checkout "$MUPDF_COMMIT"
# thirdparty is fully checked out (shallow clones of submodules cannot always
# reach the pinned commit on the server side); this is a one-off manual build,
# bandwidth matters less than reproducibility here.
git submodule update --init --recursive

# --- WAMR compatibility patch (see patches/wamr-compat.patch) ---
git apply "$PATCH"

# --- build ---
cd platform/wasm
EMSDK=/tmp/emsdk tools/build.sh

echo
echo "done. artifacts in: $PWD/dist"
echo "copy over the committed files in packages/mupdf-wasm/ and bump the version to publish."
