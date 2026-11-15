# quickwin-packages

npm packages for the **[QuickWin](https://github.com/quickwinlabs/quickwin)** ecosystem:

- **official extension libraries** that need their own release cadence (UIA, …), and
- **third-party builds tailored for QuickWin** — same code as upstream, different
  build configuration (e.g. wasm exception handling for WAMR). Upstream's own
  npm packages cannot be substituted there.

## Packages

| package | what it is |
| --- | --- |
| [`@quickwinlabs/mupdf-wasm`](packages/mupdf-wasm) | MuPDF → WebAssembly, built for QuickWin's WAMR runtime |
| [`@quickwinlabs/uia`](packages/uia) | UI Automation helpers for QuickWin (Win11 taskbar tray icon enumeration) |

## Layout

Every package is self-contained — no workspaces, no changesets:

```
packages/<name>/
  package.json      # own name + version (the only release trigger)
  tsconfig.json     # tsc recipe (uia/TS packages) — produces dist/
  build.sh          # native recipe (mupdf-wasm) — produces the package artifacts
  patches/          # build inputs that pin the difference from upstream
  .gitignore        # artifacts are never committed
```

## Build & publish flow

- **Nothing is committed but the recipe.** Build outputs are gitignored and
  reproduced by each package's `npm run build` (the script is also shipped in
  the tarball so the artifacts stay auditable).
- **Publishing is version-driven, not tag-driven.** Push a `package.json`
  version bump to `main`; CI walks `packages/*/`, and for each package whose
  exact version is missing from the registry it runs `npm run build` →
  `npm publish`. Already-published versions are skipped without building, so
  bumping one package never rebuilds the others (npm rejects duplicate
  versions as a second line of defense).
- Requires repo secret `NPM_TOKEN` (granular token with publish rights for
  the `@quickwinlabs` scope). Without it the workflow only reports what it
  would publish.
