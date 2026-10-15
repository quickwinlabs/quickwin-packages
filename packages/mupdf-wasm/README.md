# @quickwinlabs/mupdf-wasm

MuPDF compiled to WebAssembly, **tailored for QuickWin's WAMR runtime**. This is
not the stock upstream `mupdf` npm package (which targets browsers/Node): WAMR
cannot execute the wasm exception instructions that upstream's emscripten build
enables, so this build swaps them out for emscripten's JS-based longjmp and
keeps the module unminified for debuggability.

## Build provenance

| input | value |
| --- | --- |
| mupdf commit | `05c6564035d20e3ed1998ffa392c9d17b2cd6a45` (1.28 development line) |
| emsdk | 4.0.8 |
| patch | [`patches/wamr-compat.patch`](patches/wamr-compat.patch) |

The patch removes `-fwasm-exceptions` and switches `-sSUPPORT_LONGJMP=wasm`
to `=1`, and skips terser. See [`build.sh`](build.sh) to reproduce the
artifacts from source (auditors: run it and diff against the committed files).

## Runtime requirements (QuickWin side)

The wasm module expects the WAMR host to be built/configured with:

- `WAMR_BUILD_EXCE_HANDLING=1` (exception handling reconstruction)
- import-global linking support
- an app heap of ~40KB (`heap_size=40960` in `src/quickjs-wamr.c`)

These are already in place in QuickWin; consuming this package outside QuickWin
requires a comparable host setup.

## Files

- `mupdf.js` — ES module wrapper (JS API: `Document`, `Page`, `Pixmap`, …)
- `mupdf-wasm.js` / `mupdf-wasm.wasm` — emscripten glue + wasm binary
- `mupdf.d.ts` / `mupdf-wasm.d.ts` — TypeScript definitions

## Versioning & publishing

The version follows the upstream mupdf development line this build was taken
from (`1.28.0` = 1.28 line snapshot at the pinned commit). Publishing is
automatic: bump `version` in `package.json` and push to `main` — CI compares
against the registry and publishes when it is new.

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE)); MuPDF is dual-licensed by
Artifex — commercial licensing available from <https://mupdf.com>.
