# quickwin-packages

npm packages of third-party builds **tailored for [QuickWin](https://github.com/quickwinlabs/quickwin)**
(same code as upstream, different build configuration — e.g. wasm exception
handling for WAMR). Upstream's own npm packages cannot be substituted.

## Packages

| package | what it is |
| --- | --- |
| [`@quickwinlabs/mupdf-wasm`](packages/mupdf-wasm) | MuPDF → WebAssembly, built for QuickWin's WAMR runtime |

## Rebuild & publish flow

- Each package directory carries its own prebuilt artifacts plus a `build.sh`
  and `patches/` describing exactly how they were produced (auditable rebuild;
  CI publishes the committed artifacts as-is).
- **Publishing is version-driven, not tag-driven**: push a `package.json`
  version bump to `main`, CI compares it against the npm registry and
  publishes when the version is new (npm rejects duplicate versions as a
  second line of defense).
- Requires repo secret `NPM_TOKEN` (granular token with publish rights for
  the `@quickwinlabs` scope).
