# @quickwinlabs/uia

UI Automation (UIA) helpers for QuickWin. Currently provides Win11 taskbar tray
icon enumeration, which the classic cross-process read (`TB_GETBUTTON`) can no
longer do reliably on Win11.

## Why UIA?

On Win11 the taskbar's UIA tree is provided by the shell's
`TaskbarFrameAutomationPeer`, not by HWND child windows. The legacy
`TB_GETBUTTON` path (used by QuickWin's own `examples/execd`) reads empty, so
callers fall back to this package:

```
GetRootElement → FindAll(TreeScope_Subtree, TrueCondition) → filter ClassName: SystemTray.*
```

Two traps worth knowing (both verified on Win11 26200):

- `CreateTrueCondition` is vtable slot **21**, not 22. Slot 22 is
  `CreateFalseCondition` — using it makes `FindAll` return 0 elements.
- `TaskbarFrame`'s `FindAll(Descendants)` only covers the left button area
  (Widgets / Start / Search / task view / pinned apps). `SystemTray.*` lives
  **outside** that subtree, so you must walk the root element's whole tree.

## Usage

```ts
import { listTrayIconsUia } from '@quickwinlabs/uia'

const icons = listTrayIconsUia()
for (const i of icons) {
    console.log(i.className, i.name, i.rect) // SystemTray.NormalButton Show Hidden Icons {left:1102,...}
}
```

`listTrayIconsUia()` never throws: unsupported OS / COM failure returns `[]`.

## Runtime requirements

- Runs inside the QuickWin runtime (`quickwin` peer dependency). `ffi` is a
  QuickWin built-in module — when bundling with esbuild, mark the QuickWin
  built-ins (`ffi`, `gui`, `os`, `std`, `sock`, `brotli`, `wamr`, `tls`,
  `wolfssl`) as `external`, as QuickWin's own build does.
- COM primitives (`guidFields`, `CoCreateInstance`, `SysFreeString`, …) are
  imported from `quickwin/lib/*`, which ships with the `quickwin` npm package.

## API

### `listTrayIconsUia(): UiaTrayIcon[]`

Enumerates visible taskbar tray buttons (`SystemTray.*` elements). Returns an
empty array on failure or unsupported OS. Currently covers only the **visible**
area; hidden icons inside the "Show Hidden Icons" overflow flyout need the panel
expanded first (an interaction path, planned for a later version).

### `UiaTrayIcon`

| field | type | meaning |
| --- | --- | --- |
| `name` | `string` | element name (tooltip / composite text) |
| `className` | `string` | UIA automation class (`SystemTray.NormalButton`, `…AccentButton`, …) |
| `controlType` | `number` | UIA ControlType enum (50000 = Button) |
| `rect` | `{left,top,right,bottom}` | screen physical pixels |
| `offscreen` | `boolean` | true when hidden in the collapsed overflow panel |
