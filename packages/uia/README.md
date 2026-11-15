# @quickwinlabs/uia

UI Automation (UIA) **generic client** for QuickWin: a typed wrapper over
`IUIAutomation` (element property reads, tree walk, conditions, common
patterns). Tray (notification area) enumeration lives in the separate
`@quickwinlabs/tray-list` package.

## Usage

```ts
import { UiaClient, TreeScope, ControlType } from '@quickwinlabs/uia'

const uia = UiaClient.create()
if (!uia) throw new Error('no UIA')

const root = uia.root()
if (!root) { uia.close(); throw new Error('no root element') }
try {
    // find elements by predicate (JS-side filter; see traps below)
    const hits = root.findAllWhere(TreeScope.Subtree, (el) => el.className().startsWith('SystemTray'))
    for (const el of hits) {
        console.log(el.name(), el.controlType() === ControlType.Button)
        el.release()
    }

    // native conditions: match everything, then a logical and/or combination
    const everything = uia.trueCondition()
    const never = uia.falseCondition()
    if (everything && never) {
        const both = uia.andCondition(everything, never)
        both?.release()
        never.release()
    }
    everything?.release()

    // native property condition: UIA-side filtering (fast on large trees)
    const byClass = uia.propertyCondition(PropertyId.ClassName, 'SystemTray')
    if (byClass) {
        const found = root.findFirst(TreeScope.Subtree, byClass)
        found?.release()
        byClass.release()
    }
} finally {
    root.release()
    uia.close()
}
```

Every `UiaElement` / `Condition` is a COM reference the caller owns: `release()`
it when done (idempotent). `findAll`/`findAllWhere`/`children`/`descendants`
return arrays whose elements each need releasing; `findAllWhere` auto-releases
the non-matching ones.

### Patterns

```ts
const el = /* some element (e.g. a button) */ null as any
el.invoke()        // InvokePattern — e.g. opens a flyout (verified on Win11 26200)
el.expand()        // ExpandCollapsePattern.Expand
el.collapse()      // ExpandCollapsePattern.Collapse
el.expandCollapseState() // 0=Collapsed 1=Expanded 2=Partially 3=LeafNode
el.select()        // SelectionItemPattern.Select
el.value()         // ValuePattern current value
el.setValue('x')   // ValuePattern.SetValue
el.toggle()        // TogglePattern.Toggle
el.toggleState()   // 0=Off 1=On 2=Indeterminate

// 非 pattern 的输入注入兜底（仅 elementFromHandle 得到的元素）
el.click()         // 后台点击 rect 中心：PostMessage WM_LBUTTONDOWN/UP + ScreenToClient
                   // 不移动光标、不抢焦点（纯后台，不打断用户）
                   // 适用 Qt/自绘控件（如微信 mmui::*）：虽暴露为 Button/ListItem，
                   // 但不响应 UIA Invoke/SelectionItem pattern——须用 click() 触发。
                   // 标准控件仍应优先 invoke()/select()。
```

## API

- `UiaClient.create(): UiaClient | null` — init COM (APARTMENTTHREADED) +
  `CoCreateInstance(CUIAutomation)`; `close()` releases + `CoUninitialize`.
- `UiaClient.root() / elementFromPoint(x,y) / elementFromHandle(hwnd) /
  focusedElement()` → `UiaElement | null`.
- `UiaClient.trueCondition() / falseCondition() / andCondition(...) /
  orCondition(...)` → `Condition | null` (≥2 conditions for and/or; intermediates
  auto-released, inputs untouched).
- `UiaClient.propertyCondition(prop, value)` → `Condition | null` — native
  property condition (`CreatePropertyCondition`), value is `string` (VT_BSTR) /
  `number` (VT_I4) / `boolean` (VT_BOOL). The condition owns the BSTR for its
  lifetime (released on `release()`).
- `UiaElement`: `name/className/localizedControlType/automationId/controlType/
  processId/isOffscreen/isEnabled/hasKeyboardFocus/isKeyboardFocusable/rect()`,
  `findFirst/findAll(scope, cond)`, `findAllWhere(scope, predicate)`,
  `children()/descendants()`, pattern methods, `click()` (background click),
  `release()`.
- `TreeScope`, `ControlType`, `PropertyId` enums.

### Traps worth knowing (all verified on Win11 26200)

- `CreateTrueCondition` is vtable slot **21**, not 22. Slot 22 is
  `CreateFalseCondition` — using it makes `FindAll` return 0 elements.
- Native property conditions (`CreatePropertyCondition`) are exposed via
  `propertyCondition(prop, value)`: the `VARIANT` argument is passed **by value**
  (QuickWin FFI supports by-value struct args — ia32 pushes the bytes, x64 passes
  a 16-byte-aligned temp by reference, covered by `test_ffi_abi`). Only `VT_BSTR`
  / `VT_I4` / `VT_BOOL` values are implemented; other VARIANT types can be added
  by extending `propertyCondition`. `findAllWhere(scope, predicate)` remains the
  convenient JS-side filter.

## Runtime requirements

- Runs inside the QuickWin runtime (`quickwin` peer dependency). `ffi` is a
  QuickWin built-in module — when bundling with esbuild, mark the QuickWin
  built-ins (`ffi`, `gui`, `os`, `std`, `sock`, `brotli`, `wamr`, `tls`,
  `wolfssl`) as `external`, as QuickWin's own build does.
- COM primitives (`guidFields`, `CoCreateInstance`, `SysFreeString`, …) are
  imported from `quickwin/lib/*`, which ships with the `quickwin` npm package.
