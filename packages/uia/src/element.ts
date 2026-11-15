// UiaElement：IUIAutomationElement 的封装。每个实例持有独立 COM 引用，用后 release()
// （幂等）；findAll/findAllWhere 返回的元素数组，每个都要 release（非匹配项已由
// findAllWhere 自动释放，匹配项归调用方）。
//
// vtable 槽位（IUnknown 3 槽后计，从 mingw uiautomationclient.h 核对）：
//   FindFirst=5  FindAll=6  GetCurrentPattern=16
//   get_CurrentProcessId=20  get_CurrentControlType=21
//   get_CurrentLocalizedControlType=22  get_CurrentName=23
//   get_CurrentHasKeyboardFocus=26  get_CurrentIsKeyboardFocusable=27
//   get_CurrentIsEnabled=28  get_CurrentAutomationId=29  get_CurrentClassName=30
//   get_CurrentIsOffscreen=38  get_CurrentBoundingRectangle=43
//   IUIAutomationElementArray: get_Length=3  GetElement=4
import * as ffi from 'ffi'
import { bindAt } from 'quickwin/lib/ffi/bind.js'
import { PtrArrayBuffer } from 'quickwin/lib/ffi/ctype.js'
import { RECT } from 'quickwin/lib/windows/structs.js'
import { FAILED } from 'quickwin/lib/com.js'
import { release, vtable, bstr, SZ } from './com.js'
import { patternAction, patternU32, withPattern } from './patterns.js'
import { PatternId, TreeScope } from './const.js'
import type { Condition, UiaClient } from './client.js'

const E_FIND_FIRST = 5
const E_FIND_ALL = 6
const E_PROCESS_ID = 20
const E_CONTROL_TYPE = 21
const E_LOCALIZED_CONTROL_TYPE = 22
const E_NAME = 23
const E_HAS_KEYBOARD_FOCUS = 26
const E_IS_KEYBOARD_FOCUSABLE = 27
const E_IS_ENABLED = 28
const E_AUTOMATION_ID = 29
const E_CLASS_NAME = 30
const E_IS_OFFSCREEN = 38
const E_BOUNDING_RECT = 43
const ARR_LENGTH = 3
const ARR_GET = 4

/** 屏幕物理像素矩形（left,top,right,bottom） */
export interface Rect {
    left: number
    top: number
    right: number
    bottom: number
}

/** UIA 元素封装。属性读失败返回默认值（'' / 0 / false / null），不抛。 */
export class UiaElement {
    private ptr: number
    private client: UiaClient
    constructor(ptr: number, client: UiaClient) {
        this.ptr = ptr
        this.client = client
    }

    // ── 属性 ──

    /** 元素名（tooltip / 复合文本） */
    name(): string {
        return this.readBstr(E_NAME)
    }
    /** UIA 自动化类名（如 SystemTray.NormalButton） */
    className(): string {
        return this.readBstr(E_CLASS_NAME)
    }
    /** 本地化控件类型名（如 "button"） */
    localizedControlType(): string {
        return this.readBstr(E_LOCALIZED_CONTROL_TYPE)
    }
    /** AutomationId（控件标识） */
    automationId(): string {
        return this.readBstr(E_AUTOMATION_ID)
    }
    /** UIA ControlType ID（见 ControlType 枚举） */
    controlType(): number {
        return this.readU32(E_CONTROL_TYPE)
    }
    /** 承载进程 PID */
    processId(): number {
        return this.readU32(E_PROCESS_ID)
    }
    /** 是否离屏（折叠/隐藏） */
    isOffscreen(): boolean {
        return this.readU32(E_IS_OFFSCREEN) !== 0
    }
    /** 是否启用 */
    isEnabled(): boolean {
        return this.readU32(E_IS_ENABLED) !== 0
    }
    /** 是否持有键盘焦点 */
    hasKeyboardFocus(): boolean {
        return this.readU32(E_HAS_KEYBOARD_FOCUS) !== 0
    }
    /** 是否可获键盘焦点 */
    isKeyboardFocusable(): boolean {
        return this.readU32(E_IS_KEYBOARD_FOCUSABLE) !== 0
    }
    /** 屏幕物理像素矩形；失败 → null */
    rect(): Rect | null {
        const buf = new PtrArrayBuffer<'RECT'>(16)
        if (!this.ptr) return null
        if (FAILED(bindAt(vtable(this.ptr, E_BOUNDING_RECT), '<>ptr <RECT>ptr -> i32')(this.ptr, buf.ptr))) return null
        return RECT.decode(buf)
    }

    // ── 树遍历 ──

    /** 在 scope 内找第一个匹配元素；无 → null */
    findFirst(scope: TreeScope, cond: Condition): UiaElement | null {
        const out = new PtrArrayBuffer<'<UiaElement>ptr'>(SZ)
        if (!this.ptr) return null
        if (FAILED(bindAt(vtable(this.ptr, E_FIND_FIRST), '<>ptr u32 <>ptr <<UiaElement>ptr>ptr -> i32')(
            this.ptr, scope, cond.pointer, out.ptr))) return null
        return this.wrap(ffi.readPtr(out.ptr))
    }

    /** 在 scope 内找全部匹配元素；返回的每个元素都要 release() */
    findAll(scope: TreeScope, cond: Condition): UiaElement[] {
        const arrOut = new PtrArrayBuffer<'<UiaElementArray>ptr'>(SZ)
        if (!this.ptr) return []
        if (FAILED(bindAt(vtable(this.ptr, E_FIND_ALL), '<>ptr u32 <>ptr <<UiaElementArray>ptr>ptr -> i32')(
            this.ptr, scope, cond.pointer, arrOut.ptr))) return []
        const arr = ffi.readPtr(arrOut.ptr)
        if (!arr) return []
        try {
            const lenB = new PtrArrayBuffer(4)
            if (FAILED(bindAt(vtable(arr, ARR_LENGTH), '<>ptr <>ptr -> i32')(arr, lenB.ptr))) return []
            const len = new Uint32Array(lenB)[0]!
            const getEl = bindAt(vtable(arr, ARR_GET), '<>ptr i32 <<UiaElement>ptr>ptr -> i32')
            const out: UiaElement[] = []
            for (let i = 0; i < len; i++) {
                const eo = new PtrArrayBuffer<'<UiaElement>ptr'>(SZ)
                if (FAILED(getEl(arr, i, eo.ptr))) continue
                const el = ffi.readPtr(eo.ptr)
                if (el) out.push(this.wrap(el))
            }
            return out
        } finally {
            release(arr)
        }
    }

    /** JS 侧按谓词过滤（native 属性条件受 VARIANT 按值 ABI 限制，见 client.ts 注释）。
     *  匹配元素归调用方（release 由调用方），非匹配自动释放。谓词抛错视为不匹配。 */
    findAllWhere(scope: TreeScope, predicate: (el: UiaElement) => boolean): UiaElement[] {
        const tc = this.client.trueCondition()
        if (!tc) return []
        try {
            const all = this.findAll(scope, tc)
            const out: UiaElement[] = []
            for (const el of all) {
                let match = false
                try {
                    match = predicate(el)
                } catch {
                    match = false
                }
                if (match) out.push(el)
                else el.release()
            }
            return out
        } finally {
            tc.release()
        }
    }

    /** 直接子元素 */
    children(): UiaElement[] {
        return this.findAllScoped(TreeScope.Children)
    }
    /** 所有后代元素 */
    descendants(): UiaElement[] {
        return this.findAllScoped(TreeScope.Descendants)
    }

    // ── 模式（交互） ──

    /** InvokePattern.Invoke（点击/激活；按钮、菜单项等） */
    invoke(): void {
        if (this.ptr) patternAction(this.ptr, PatternId.Invoke, 3)
    }
    /** ExpandCollapsePattern.Expand */
    expand(): void {
        if (this.ptr) patternAction(this.ptr, PatternId.ExpandCollapse, 3)
    }
    /** ExpandCollapsePattern.Collapse */
    collapse(): void {
        if (this.ptr) patternAction(this.ptr, PatternId.ExpandCollapse, 4)
    }
    /** ExpandCollapseState（0=Collapsed 1=Expanded 2=PartiallyExpanded 3=LeafNode） */
    expandCollapseState(): number {
        return this.ptr ? patternU32(this.ptr, PatternId.ExpandCollapse, 5) : 0
    }
    /** SelectionItemPattern.Select */
    select(): void {
        if (this.ptr) patternAction(this.ptr, PatternId.SelectionItem, 3)
    }
    /** ValuePattern 当前值 */
    value(): string {
        if (!this.ptr) return ''
        return withPattern(this.ptr, PatternId.Value, (p) => {
            const out = new PtrArrayBuffer<'<Bstr>ptr'>(SZ)
            if (FAILED(bindAt(vtable(p, 4), '<>ptr <<Bstr>ptr>ptr -> i32')(p, out.ptr))) return ''
            return bstr(out)
        }) ?? ''
    }
    /** ValuePattern.SetValue */
    setValue(v: string): void {
        if (!this.ptr) return
        withPattern(this.ptr, PatternId.Value, (p) => {
            bindAt(vtable(p, 3), '<>ptr <WCHAR>ptr -> i32')(p, v)
            return true
        })
    }
    /** TogglePattern.Toggle */
    toggle(): void {
        if (this.ptr) patternAction(this.ptr, PatternId.Toggle, 3)
    }
    /** ToggleState（0=Off 1=On 2=Indeterminate） */
    toggleState(): number {
        return this.ptr ? patternU32(this.ptr, PatternId.Toggle, 4) : 0
    }

    /** 释放元素（幂等） */
    release(): void {
        if (this.ptr) {
            release(this.ptr)
            this.ptr = 0
        }
    }

    // ── 内部 ──

    private wrap(ptr: number): UiaElement {
        return new UiaElement(ptr, this.client)
    }

    private readBstr(slot: number): string {
        const buf = new PtrArrayBuffer<'<Bstr>ptr'>(SZ)
        if (!this.ptr) return ''
        if (FAILED(bindAt(vtable(this.ptr, slot), '<>ptr <<Bstr>ptr>ptr -> i32')(this.ptr, buf.ptr))) return ''
        return bstr(buf)
    }

    private readU32(slot: number): number {
        const buf = new PtrArrayBuffer(4)
        if (!this.ptr) return 0
        if (FAILED(bindAt(vtable(this.ptr, slot), '<>ptr <>ptr -> i32')(this.ptr, buf.ptr))) return 0
        return new Uint32Array(buf)[0]!
    }

    private findAllScoped(scope: TreeScope): UiaElement[] {
        const tc = this.client.trueCondition()
        if (!tc) return []
        try {
            return this.findAll(scope, tc)
        } finally {
            tc.release()
        }
    }
}
