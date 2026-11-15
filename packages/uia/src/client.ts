// UiaClient：IUIAutomation 的门面（COM 生命周期 + 条件工厂 + 元素获取）。
// 同步 API（UIA 是同步 COM）；create() 失败返回 null（延续包内「不抛」哲学）。
// 线程模型：CoInitializeEx(COINIT_APARTMENTTHREADED)，close() 配对 CoUninitialize。
// 所有返回的 UiaElement / Condition 都是独立 COM 引用，调用方用后必须 release()。
//
// vtable 槽位（IUnknown 3 槽后计，从 mingw uiautomationclient.h 核对）：
//   GetRootElement=5  ElementFromHandle=6  ElementFromPoint=7  GetFocusedElement=8
//   CreateTrueCondition=21  CreateFalseCondition=22  CreatePropertyCondition=23
//   CreateAndCondition=25  CreateOrCondition=28
// 注意：CreateTrueCondition 是 21 **不是** 22（22 = CreateFalseCondition）。
// native 属性条件（CreatePropertyCondition，槽 23）经 `<VARIANT>` 按值传参实现：
// VARIANT 用 struct()/union() 定义（16B，union@offset8），QuickWin FFI 支持参数位
// 结构体按值（ia32 原样压栈 / x64 >8B 按引用传 16 对齐临时副本，test_ffi_abi 覆盖）。
import * as ffi from 'ffi'
import { bind, bindAt } from 'quickwin/lib/ffi/bind.js'
import { NULL, PtrArrayBuffer, type MaybePtr } from 'quickwin/lib/ffi/ctype.js'
import { struct } from 'quickwin/lib/ffi/struct.js'
import { FAILED, SUCCEEDED, guidFields } from 'quickwin/lib/com.js'
import { CoCreateInstance, CoInitializeEx, CoUninitialize } from 'quickwin/lib/windows/ole32.js'
import { SysFreeString } from 'quickwin/lib/windows/oleaut32.js'
import { release, vtable } from './com.js'
import { UiaElement } from './element.js'
import { PropertyId } from './const.js'

const CLSID_CUIAUTOMATION = '{FF48DBA4-60EF-4201-AA87-54103EEF594E}'
const IID_IUIAUTOMATION = '{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}'

const A_GET_ROOT_ELEMENT = 5
const A_ELEMENT_FROM_HANDLE = 6
const A_ELEMENT_FROM_POINT = 7
const A_GET_FOCUSED_ELEMENT = 8
const A_CREATE_TRUE_CONDITION = 21
const A_CREATE_FALSE_CONDITION = 22
const A_CREATE_PROPERTY_CONDITION = 23
const A_CREATE_AND_CONDITION = 25
const A_CREATE_OR_CONDITION = 28

// VARIANT（16B，双架构同布局：vt@0 + reserved@2..6 + union@8，union align 8 来自 i64）。
// 内联字面量直传 struct()（顶层 '#' 可省，kind 由函数名表明）；嵌套 union 必须带 '#'。
const VARIANT = /* @__PURE__ */ struct('VARIANT', {
    vt: 'u16', // VARTYPE：VT_BSTR=8 / VT_I4=3 / VT_BOOL=11
    wReserved1: 'u16',
    wReserved2: 'u16',
    wReserved3: 'u16',
    u: {
        '#': 'union',
        llVal: 'i64', // 对齐 8 → union 落 offset 8
        lVal: 'i32',
        boolVal: 'i16',
        bstrVal: '<>ptr', // 指针宽（x64 8 / x86 4）
    },
})

// POINT（8B，双架构同布局）：UIA ElementFromPoint 按值传参（x64 位置寄存器 / ia32 压
// 8 字节上栈，与 test_ffi_abi 的 WindowFromPoint(<POINT>) 同款）。
const POINT = /* @__PURE__ */ struct('POINT', { x: 'i32', y: 'i32' })

// SysAllocString 不在 quickwin 包的 oleaut32 导出面（只有 SysFreeString/SysStringLen/
// VariantClear），直接用 bind() 绑定：内建 <WCHAR>ptr 字符串编解码（类型层即 string，
// 传 JS 字符串自动转 UTF-16），bind 内置 _dllCache（LoadLibrary 一次）。BSTR 必须 COM
// 堆分配（SysFreeString 配对的唯一合法来源）。惰性绑定（bind 顶层即 LoadLibrary），
// 函数指针缓存（oleaut32 常驻）。
let sysAllocStringFn: ((s: string) => number) | null | undefined
function sysAllocString(s: string): number {
    if (sysAllocStringFn === undefined)
        sysAllocStringFn = bind('oleaut32.dll', 'SysAllocString', '<WCHAR>ptr -> <>ptr')
    return sysAllocStringFn ? sysAllocStringFn(s) : 0
}

/** UIA 条件对象（IUIAutomationCondition）。由 UiaClient 工厂创建，调用方用后 release()。
 *  andCondition/orCondition 创建的结果持有子条件的引用，故先释放子条件也安全。
 *  propertyCondition 创建的属性条件可能引用调用方传入的 BSTR（VARIANT 按值传给 COM 后，
 *  provider 侧是否深拷贝无契约保证），故持有该 BSTR 直到条件释放，防悬挂。 */
export class Condition {
    private ptr: number
    private ownedBstr: number
    constructor(ptr: number, ownedBstr = 0) {
        this.ptr = ptr
        this.ownedBstr = ownedBstr
    }
    /** 原始 COM 指针（仅供 client/element 内部使用） */
    get pointer(): number {
        return this.ptr
    }
    /** 释放条件（幂等）；与子条件无关，子条件由各自调用方管理。
     *  属性条件先释放条件再释放持有的 BSTR（幂等）。 */
    release(): void {
        if (this.ptr) {
            release(this.ptr)
            this.ptr = 0
        }
        if (this.ownedBstr) {
            SysFreeString(this.ownedBstr)
            this.ownedBstr = 0
        }
    }
}

/** IUIAutomation 客户端门面。用完 close()（释放自动化实例 + 线程反初始化）。
 *  已 close 的客户端再调用方法返回 null/[]（元素自身 COM 引用不受影响）。 */
export class UiaClient {
    private au: number
    private uninit: boolean
    private constructor(au: number, uninit: boolean) {
        this.au = au
        this.uninit = uninit
    }

    /** 初始化当前线程 COM 并创建 CUIAutomation；失败（无 UIA / 线程初始化失败）→ null */
    static create(): UiaClient | null {
        const hrInit = CoInitializeEx(NULL, 2)
        if (FAILED(hrInit) && hrInit !== 0x80010106) return null
        const uninit = SUCCEEDED(hrInit)
        const auOut = new PtrArrayBuffer<'<UiaClient>ptr'>(8)
        if (FAILED(CoCreateInstance(guidFields(CLSID_CUIAUTOMATION), NULL, 1,
            guidFields(IID_IUIAUTOMATION), auOut.ptr))) {
            if (uninit) CoUninitialize()
            return null
        }
        return new UiaClient(ffi.readPtr(auOut.ptr), uninit)
    }

    /** 桌面根元素（整树起点）；失败 → null */
    root(): UiaElement | null {
        return this.wrap(this.callPtrOut(A_GET_ROOT_ELEMENT))
    }

    /** 屏幕物理像素 (x, y) 处的元素；无 → null */
    elementFromPoint(x: number, y: number): UiaElement | null {
        const out = new PtrArrayBuffer<'<UiaElement>ptr'>(8)
        if (!this.au) return null
        if (FAILED(bindAt(vtable(this.au, A_ELEMENT_FROM_POINT), '<>ptr <POINT> <<UiaElement>ptr>ptr -> i32', { POINT })(this.au, { x, y }, out.ptr))) return null
        return this.wrap(ffi.readPtr(out.ptr))
    }

    /** 顶层窗口句柄对应的 UIA 元素；无 → null。hwnd 须为主仓品牌 HWND（主仓
     *  FindWindow/GetForegroundWindow 等返回的就是；见 quickwin/lib/ffi/ctype 的 Ptr）。 */
    elementFromHandle(hwnd: MaybePtr<'HWND'>): UiaElement | null {
        const out = new PtrArrayBuffer<'<UiaElement>ptr'>(8)
        if (!this.au) return null
        if (FAILED(bindAt(vtable(this.au, A_ELEMENT_FROM_HANDLE), '<>ptr <HWND>ptr <<UiaElement>ptr>ptr -> i32')(this.au, hwnd, out.ptr))) return null
        // ownerHwnd 注入：该窗口下元素的后台点击（click()）用此 hwnd 定位
        return this.wrap(ffi.readPtr(out.ptr), hwnd)
    }

    /** 当前焦点元素；无焦点/失败 → null */
    focusedElement(): UiaElement | null {
        return this.wrap(this.callPtrOut(A_GET_FOCUSED_ELEMENT))
    }

    /** 匹配一切的条件（FindAll/FindFirst 最常用）；失败 → null */
    trueCondition(): Condition | null {
        return this.condition(A_CREATE_TRUE_CONDITION)
    }

    /** 匹配一切的反义（恒空）；失败 → null */
    falseCondition(): Condition | null {
        return this.condition(A_CREATE_FALSE_CONDITION)
    }

    /** 逻辑与（≥2 个条件）；返回新条件，调用方 release。中间结果自动释放，子条件不释放。 */
    andCondition(...conds: Condition[]): Condition | null {
        return this.combine(A_CREATE_AND_CONDITION, conds)
    }

    /** 逻辑或（≥2 个条件）；同上 */
    orCondition(...conds: Condition[]): Condition | null {
        return this.combine(A_CREATE_OR_CONDITION, conds)
    }

    /** 原生属性条件（CreatePropertyCondition，槽 23）：按属性值匹配，UIA 引擎侧过滤。
     *  value 支持字符串（VT_BSTR）、数值（VT_I4）、布尔（VT_BOOL）。失败 → null。
     *  属性条件引用传入的 BSTR（COM 不保证深拷贝），release() 时随条件一并释放。 */
    propertyCondition(prop: PropertyId, value: string | number | boolean): Condition | null {
        if (!this.au) return null
        let ownedBstr = 0
        let v: Record<string, unknown>
        if (typeof value === 'string') {
            ownedBstr = sysAllocString(value)
            if (!ownedBstr) return null
            v = { vt: 8, u: { bstrVal: ownedBstr } } // VT_BSTR
        } else if (typeof value === 'number') {
            v = { vt: 3, u: { lVal: value } } // VT_I4
        } else {
            v = { vt: 11, u: { boolVal: value ? -1 : 0 } } // VT_BOOL（VARIANT_BOOL = -1 真）
        }
        const out = new PtrArrayBuffer<'<UiaCondition>ptr'>(8)
        const hr = bindAt(vtable(this.au, A_CREATE_PROPERTY_CONDITION),
            '<>ptr i32 <VARIANT> <<UiaCondition>ptr>ptr -> i32', { VARIANT })(this.au, prop, v, out.ptr)
        const ptr = ffi.readPtr(out.ptr)
        if (FAILED(hr) || !ptr) {
            if (ownedBstr) SysFreeString(ownedBstr)
            return null
        }
        return new Condition(ptr, ownedBstr)
    }

    /** 关闭客户端：释放自动化实例 + 配对 CoUninitialize */
    close(): void {
        if (this.au) {
            release(this.au)
            this.au = 0
        }
        if (this.uninit) {
            this.uninit = false
            CoUninitialize()
        }
    }

    // ── 内部 ──

    private wrap(ptr: number, ownerHwnd: MaybePtr<'HWND'> = NULL): UiaElement | null {
        return ptr ? new UiaElement(ptr, this, ownerHwnd) : null
    }

    /** 调用一个「<>ptr <>ptr -> i32」取指针出参的方法 */
    private callPtrOut(slot: number): number {
        if (!this.au) return 0
        const out = new PtrArrayBuffer<'<UiaElement>ptr'>(8)
        if (FAILED(bindAt(vtable(this.au, slot), '<>ptr <<UiaElement>ptr>ptr -> i32')(this.au, out.ptr))) return 0
        return ffi.readPtr(out.ptr)
    }

    private condition(slot: number): Condition | null {
        const out = new PtrArrayBuffer<'<UiaCondition>ptr'>(8)
        if (!this.au) return null
        if (FAILED(bindAt(vtable(this.au, slot), '<>ptr <<UiaCondition>ptr>ptr -> i32')(this.au, out.ptr))) return null
        const ptr = ffi.readPtr(out.ptr)
        return ptr ? new Condition(ptr) : null
    }

    /** and/or：二元调用，>2 个条件迭代嵌套（中间结果自动释放，子条件不动） */
    private combine(slot: number, conds: Condition[]): Condition | null {
        if (conds.length < 2 || !this.au) return null
        let acc: Condition | null = null
        for (let i = 0; i < conds.length - 1; i++) {
            const left = acc ?? conds[i]!
            const right = conds[i + 1]!
            const out = new PtrArrayBuffer<'<UiaCondition>ptr'>(8)
            if (FAILED(bindAt(vtable(this.au, slot), '<>ptr <>ptr <>ptr <<UiaCondition>ptr>ptr -> i32')(this.au, left.pointer, right.pointer, out.ptr))) {
                if (acc) acc.release()
                return null
            }
            const next = new Condition(ffi.readPtr(out.ptr))
            if (acc) acc.release()
            acc = next
        }
        return acc
    }
}
