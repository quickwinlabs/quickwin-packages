// UIA 模式（pattern）访问——内部模块。GetCurrentPattern 从元素 vtable 槽 16
// （IUnknown 3 槽后计）取 IUnknown*，按模式接口 vtable 转调；返回的模式对象是独立
// COM 引用，用完必须 release（withPattern 的 finally 保证）。
//
// 模式接口槽位（IUnknown 3 槽后计，从 mingw uiautomationclient.h 核对）：
//   IUIAutomationInvokePattern:         Invoke=3
//   IUIAutomationExpandCollapsePattern: Expand=3  Collapse=4  get_CurrentExpandCollapseState=5
//   IUIAutomationSelectionItemPattern:  Select=3
//   IUIAutomationValuePattern:          SetValue=3  get_CurrentValue=4
//   IUIAutomationTogglePattern:         Toggle=3  get_CurrentToggleState=4
import * as ffi from 'ffi'
import { bindAt } from 'quickwin/lib/ffi/bind.js'
import { PtrArrayBuffer } from 'quickwin/lib/ffi/ctype.js'
import { FAILED } from 'quickwin/lib/com.js'
import { SZ, release, vtable } from './com.js'
import { PatternId } from './const.js'

// IUIAutomationElement::GetCurrentPattern = 槽 16（IUnknown 3 + 方法索引 13）
const E_GET_CURRENT_PATTERN = 16

/** 取元素的 pattern 接口指针，调用 fn 后释放；元素无该模式 / 调用失败 → null */
export function withPattern<T>(el: number, patternId: PatternId, fn: (p: number) => T): T | null {
    const out = new PtrArrayBuffer<'<UiaPattern>ptr'>(SZ)
    if (FAILED(bindAt(vtable(el, E_GET_CURRENT_PATTERN), '<>ptr u32 <<UiaPattern>ptr>ptr -> i32')(el, patternId, out.ptr))) return null
    const p = ffi.readPtr(out.ptr)
    if (!p) return null
    try {
        return fn(p)
    } finally {
        release(p)
    }
}

/** 无参模式动作（Invoke / Expand / Collapse / Select / Toggle） */
export function patternAction(el: number, patternId: PatternId, slot: number): void {
    withPattern(el, patternId, (p) => {
        bindAt(vtable(p, slot), '<>ptr -> i32')(p)
        return true
    })
}

/** 读一个 u32 出参的模式属性（get_CurrentExpandCollapseState / get_CurrentToggleState） */
export function patternU32(el: number, patternId: PatternId, slot: number): number {
    return withPattern(el, patternId, (p) => {
        const out = new PtrArrayBuffer(4)
        if (FAILED(bindAt(vtable(p, slot), '<>ptr <>ptr -> i32')(p, out.ptr))) return 0
        return new Uint32Array(out)[0]!
    }) ?? 0
}
