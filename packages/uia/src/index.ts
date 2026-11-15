// UIA（UI Automation）托盘枚举——Win11 专用路径。
//
// Win11 任务栏的经典跨进程读（TB_GETBUTTON，见 quickwin 仓库 examples/execd/tray.ts）
// 失效：
//   * ElementFromHandle(Shell_TrayWnd) 的 UIA 子树恒 0 元素（任务栏 UIA 树由 shell 的
//     TaskbarFrameAutomationPeer 提供，不走 HWND 子窗口）；
//   * TaskbarFrame 的 FindAll(Descendants) 只覆盖左侧按钮区（Widgets/Start/搜索/任务
//     视图/固定应用），SystemTray.*（托盘）在其子树之外——须从**根元素**整树过滤。
// 故本模块：GetRootElement → FindAll(TreeScope_Subtree, TrueCondition) →
// 按 ClassName 前缀 SystemTray.* 过滤（实测 Win11 26200 取到 5 个托盘按钮）。
//
// vtable 槽位逐一从 mingw uiautomationclient.h 核对（IUnknown 3 槽之后计）：
//   IUIAutomation:     GetRootElement=5  ElementFromPoint=7  CreateTrueCondition=21
//   IUIAutomationElement: FindAll=6  get_CurrentControlType=21  get_CurrentName=23
//                      get_CurrentClassName=30  get_CurrentIsOffscreen=38
//                      get_CurrentBoundingRectangle=43
//   IUIAutomationElementArray: get_Length=3  GetElement=4
// 注意：CreateTrueCondition 是 21 **不是** 22（22 = CreateFalseCondition，探针曾踩坑：
// 拿"假条件"当"真条件"用，FindAll 恒返回 0——真条件的语义是匹配一切）。
//
// COM 语义面（SUCCEEDED/FAILED/GUID）与实例创建（CoCreateInstance）来自 quickwin
// 运行时包（quickwin/lib/com、quickwin/lib/windows/ole32）；ffi 是 QuickWin 运行时
// 内建模块（消费方 esbuild 须将其与 gui/os/std 等一并标 external）。
import * as ffi from 'ffi'
import { bindAt } from 'quickwin/lib/ffi/bind.js'
import { NULL, PTR_SIZE, PtrArrayBuffer } from 'quickwin/lib/ffi/ctype.js'
import { FAILED, SUCCEEDED, guidFields } from 'quickwin/lib/com.js'
import { CoCreateInstance, CoInitializeEx, CoUninitialize } from 'quickwin/lib/windows/ole32.js'
import { SysFreeString } from 'quickwin/lib/windows/oleaut32.js'

const CLSID_CUIAUTOMATION = '{FF48DBA4-60EF-4201-AA87-54103EEF594E}'
const IID_IUIAUTOMATION = '{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}'
const SZ = PTR_SIZE

const A_GET_ROOT_ELEMENT = 5
const A_CREATE_TRUE_CONDITION = 21
const E_FIND_ALL = 6
const E_CONTROL_TYPE = 21
const E_NAME = 23
const E_CLASS_NAME = 30
const E_IS_OFFSCREEN = 38
const E_BOUNDING_RECT = 43
const ARR_LENGTH = 3
const ARR_GET = 4
const SLOT_RELEASE = 2
const TREE_SUBTREE = 7

/** UIA 枚举到的托盘按钮（SystemTray.* 元素） */
export interface UiaTrayIcon {
    /** 元素名（按钮 tooltip / 复合文本，如 "Volume No audio device is installed"） */
    name: string
    /** UIA 自动化类名（SystemTray.NormalButton / AccentButton / OmniButton / …） */
    className: string
    /** UIA ControlType 枚举值（50000 = Button，50033 = Custom/Pane） */
    controlType: number
    /** 屏幕物理像素（left,top,right,bottom） */
    rect: { left: number; top: number; right: number; bottom: number }
    /** 是否离屏（折叠面板未展开时隐藏图标 offscreen=1） */
    offscreen: boolean
}

function vtable(obj: number, slot: number): number {
    return ffi.readPtr(ffi.readPtr(obj) + slot * SZ)
}

function release(obj: number): void {
    if (!obj) return
    bindAt(vtable(obj, SLOT_RELEASE), '<>ptr -> u32')(obj)
}

/** BSTR → JS 字符串（BSTR 的 4 字节长度前缀是字节数，内容 UTF-16LE；读完释放） */
function bstr(buf: PtrArrayBuffer): string {
    const p = ffi.readPtr(buf.ptr)
    if (!p) return ''
    try {
        const n = new DataView(ffi.readBytes(p - 4, 4)).getUint32(0, true)
        const dv = new DataView(ffi.readBytes(p, n))
        let s = ''
        for (let i = 0; i < n; i += 2) s += String.fromCharCode(dv.getUint16(i, true))
        return s
    } finally {
        SysFreeString(p)
    }
}

function describe(el: number): UiaTrayIcon | null {
    try {
        const ctB = new PtrArrayBuffer(4)
        if (FAILED(bindAt(vtable(el, E_CONTROL_TYPE), '<>ptr <>ptr -> i32')(el, ctB.ptr))) return null
        const nameB = new PtrArrayBuffer(SZ)
        if (FAILED(bindAt(vtable(el, E_NAME), '<>ptr <>ptr -> i32')(el, nameB.ptr))) return null
        const clsB = new PtrArrayBuffer(SZ)
        if (FAILED(bindAt(vtable(el, E_CLASS_NAME), '<>ptr <>ptr -> i32')(el, clsB.ptr))) return null
        const offB = new PtrArrayBuffer(4)
        if (FAILED(bindAt(vtable(el, E_IS_OFFSCREEN), '<>ptr <>ptr -> i32')(el, offB.ptr))) return null
        const rcB = new PtrArrayBuffer(16)
        if (FAILED(bindAt(vtable(el, E_BOUNDING_RECT), '<>ptr <>ptr -> i32')(el, rcB.ptr))) return null
        const dv = new DataView(rcB)
        return {
            controlType: new Uint32Array(ctB)[0]!,
            name: bstr(nameB),
            className: bstr(clsB),
            offscreen: new Uint32Array(offB)[0]! !== 0,
            rect: {
                left: dv.getInt32(0, true), top: dv.getInt32(4, true),
                right: dv.getInt32(8, true), bottom: dv.getInt32(12, true),
            },
        }
    } catch {
        return null
    }
}

/**
 * 枚举 Win11 任务栏托盘的可见按钮（SystemTray.* 元素）。
 * 失败/不支持（XP/Win7 无该 UIA 树、COM 初始化失败）→ 空数组，不抛。
 * 路径：GetRootElement → FindAll(Subtree) → 按 ClassName 前缀 SystemTray.* 过滤。
 * 实测（Win11 26200）：TaskbarFrame 的 FindAll(Descendants) 只覆盖左侧按钮区
 * （Widgets/Start/Search/任务视图/固定应用），SystemTray.* 在其子树之外，须走根元素
 * 整树。当前只覆盖**可见区**；"Show Hidden Icons" 折叠面板里的隐藏图标需先展开面板
 * 再枚举，属交互路径，后续版本再扩。
 */
export function listTrayIconsUia(): UiaTrayIcon[] {
    // 线程已 MTA 时 CoInitializeEx(APARTMENTTHREADED) 返 RPC_E_CHANGED_MODE，UIA 仍可用
    const hrInit = CoInitializeEx(NULL, 2)
    if (FAILED(hrInit) && hrInit !== 0x80010106) return []
    let uninit = SUCCEEDED(hrInit)
    try {
        const auOut = new PtrArrayBuffer(SZ)
        if (FAILED(CoCreateInstance(guidFields(CLSID_CUIAUTOMATION), NULL, 1,
            guidFields(IID_IUIAUTOMATION), auOut.ptr))) return []
        const au = ffi.readPtr(auOut.ptr)
        try {
            // 1) 根元素（桌面）→ TrueCondition + FindAll(Subtree)
            const rootOut = new PtrArrayBuffer(SZ)
            if (FAILED(bindAt(vtable(au, A_GET_ROOT_ELEMENT), '<>ptr <>ptr -> i32')(au, rootOut.ptr))) return []
            const root = ffi.readPtr(rootOut.ptr)
            if (!root) return []
            const condOut = new PtrArrayBuffer(SZ)
            if (FAILED(bindAt(vtable(au, A_CREATE_TRUE_CONDITION), '<>ptr <>ptr -> i32')(au, condOut.ptr))) {
                release(root); return []
            }
            const cond = ffi.readPtr(condOut.ptr)
            try {
                const arrOut = new PtrArrayBuffer(SZ)
                if (FAILED(bindAt(vtable(root, E_FIND_ALL), '<>ptr u32 <>ptr <>ptr -> i32')(
                    root, TREE_SUBTREE, cond, arrOut.ptr))) return []
                const arr = ffi.readPtr(arrOut.ptr)
                if (!arr) return []
                try {
                    const lenB = new PtrArrayBuffer(4)
                    if (FAILED(bindAt(vtable(arr, ARR_LENGTH), '<>ptr <>ptr -> i32')(arr, lenB.ptr))) return []
                    const len = new Uint32Array(lenB)[0]!
                    const getEl = bindAt(vtable(arr, ARR_GET), '<>ptr i32 <>ptr -> i32')
                    const out: UiaTrayIcon[] = []
                    for (let i = 0; i < len; i++) {
                        const eo = new PtrArrayBuffer(SZ)
                        if (FAILED(getEl(arr, i, eo.ptr))) continue
                        const el = ffi.readPtr(eo.ptr)
                        if (!el) continue
                        try {
                            const d = describe(el)
                            if (d && d.className.startsWith('SystemTray')) out.push(d)
                        } finally {
                            release(el)
                        }
                    }
                    return out
                } finally {
                    release(arr)
                }
            } finally {
                release(cond)
            }
        } finally {
            release(au)
        }
    } finally {
        if (uninit) CoUninitialize()
    }
}
