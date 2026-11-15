// 托盘通知区枚举（经典 TB_GETBUTTON 路）：可见区 + 折叠溢出区 + 单图标可见性探针。
// 从 quickwin 仓库 examples/execd/tray.ts 迁出（纯同步 FFI，无状态可复用），import
// 改走 quickwin 运行时包（quickwin/lib/...）。QuickWin 运行时内建 ffi/gui/os 由消费方
// esbuild 标 external（同 @quickwinlabs/uia）。
//
// 通知区 = 两个容器，各藏 ToolbarWindow32：Shell_TrayWnd（可见区）/
// NotifyIconOverflowWindow（折叠面板：平时隐藏窗口，点 ^ 才弹出；XP 无此窗）。
// toolbar 属 explorer，TB_GETBUTTON/TB_GETITEMRECT 的出参 buffer 须落 explorer 地址
// 空间——VirtualAllocEx → SendMessage → ReadProcessMemory（跨进程 SendMessage 不
// marshal 指针，理由见 quickwin/lib/windows/kernel32 远程内存段注释）。
// TBBUTTON 布局随 **explorer 位宽 = OS 位宽**（与本进程无关：x86 qwin 读 x64 explorer
// 也按 64 位解析；OS64 = IsWow64Process 探针），mingw commctrl.h 实锚：
//   x86 20B：dwData@12(u32)、iString@16(u32) ；x64 32B：dwData@16(u64)、iString@24(u64)
//   （int idCommand@4 + fsState/fsStyle + bReserved[2|6] + DWORD_PTR + INT_PTR）
// dwData → explorer 内 TRAYDATA{hwnd@0(ptr 宽), uID@(ptr 宽)(u32), …}——shell 把注册
// 图标的消息窗口塞在这（非文档，XP~Win10 十年稳定，AHK TrayIcon_GetInfo 同源）。
// chevron(^)/分隔符等非通知按钮：dwData 非指针或解出的 hWnd 过不了 IsWindow → 自然滤除。
// 折叠面板未展开时按钮 rect 未布局（全 0 → null）或陈旧——overflow 区 rect 仅在面板
// 展开后可靠（诚实返回，调用方先展开再取）。
import * as os from 'os'
import * as gui from 'gui'
import { BYTE, WCHAR } from 'quickwin/lib/ffi/bind.js'
import { NULL, type Ptr, PtrArrayBuffer } from 'quickwin/lib/ffi/ctype.js'
import { struct } from 'quickwin/lib/ffi/struct.js'
import {
    ClientToScreen, FindWindow, FindWindowEx, GetClassName, GetWindowRect, GetWindowThreadProcessId,
    IsWindow,
} from 'quickwin/lib/windows/user32.js'
import {
    CloseHandle, GetCurrentProcess, IsWow64Process, OpenProcess, ReadProcessMemory,
    VirtualAllocEx, VirtualFreeEx,
} from 'quickwin/lib/windows/kernel32.js'
import { Shell_NotifyIconGetRect } from 'quickwin/lib/windows/shell32.js'
import { NOTIFYICONIDENTIFIER, POINT, RECT } from 'quickwin/lib/windows/structs.js'

const TB_GETBUTTON = 0x0417, TB_BUTTONCOUNT = 0x0418, TB_GETITEMRECT = 0x041d   // commctrl.h WM_USER+23/24/29
const CLS_BUF = 512                     // GetClassName 缓冲（WCHAR 数）

// TBBUTTON.fsState / fsStyle 的枚举值域（@ 标注用，commctrl.h 实锚）。fsStyle 取**按钮级**
// TBSTYLE_*（0x00-0x3F，u8 适配）——窗口级 TBSTYLE_TOOLTIPS(0x100)+ 不存进 BYTE fsStyle。
// 扩展全局 EnumMap（声明合并，见 quickwin lib/ffi/ctype.ts）：struct 字段 'u8@TBState' 的
// 值域类型 = EnumMap[TBState]（纯类型层，运行时 normToken 剥掉，不影响布局）。
export const enum TBState {
    CHECKED = 0x01, PRESSED = 0x02, ENABLED = 0x04, HIDDEN = 0x08,
    INDETERMINATE = 0x10, WRAP = 0x20, ELLIPSIS = 0x40, MARKED = 0x80,
}
export const enum TBStyle {
    BUTTON = 0x00, SEP = 0x01, CHECK = 0x02, GROUP = 0x04, CHECKGROUP = 0x06,
    DROPDOWN = 0x08, AUTOSIZE = 0x10, NOPREFIX = 0x20,
}
declare global {
    interface EnumMap {
        TBState: TBState
        TBStyle: TBStyle
    }
}

// OS 位宽探针（须先于 struct 定义）：决定按 explorer 位宽解析远程结构。
// `os.arch === 'x64'` 必要非充分——只覆盖 x64 进程；x86 进程跑在 x64 OS（WOW64）上
// 也是 OS64，须 IsWow64Process 探针补足（该探针对 x64 进程恒 0，故两条件 OR 互补）：
//   x64 进程(x64 OS) → arch=True → OS64；x86-on-x64 → wow=1 → OS64；x86-on-x86 → wow=0
// 不能只写 `os.arch === 'x64'`：execd 优先 x86，Win11 x64 上跨位宽是真实场景。
const OS64: boolean = os.arch === 'x64' || (() => {
    const wow = new PtrArrayBuffer(4)
    return IsWow64Process(GetCurrentProcess(), wow) !== 0 && new Uint32Array(wow)[0] !== 0
})()
// TBBUTTON/TRAYDATA 布局随 **explorer 位宽 = OS 位宽**（与本进程无关：x86 qwin 读 x64
// explorer 也按 64 位解析；OS64 = IsWow64Process 探针）。mingw commctrl.h 实锚：
//   x86 20B：dwData@12(u32)、iString@16(u32) ；x64 32B：dwData@16(u64)、iString@24(u64)
//   （int idCommand@4 + fsState/fsStyle + bReserved[2|6] + DWORD_PTR + INT_PTR）
// 指针宽字段用固定 u64/u32（非 `<>ptr`——那是**进程**位宽，execd 优先 x86，在 x64 OS
// 上读 x64 explorer 会截断指针；双布局按 OS64 运行期选，保跨位宽正确）。
// bReserved: 'u8[2]'——x86 落到 dwData@12；x64 经 8 对齐自动填到 dwData@16，无需 [6]。
// TS 对 struct 联合（X64|X86）的 decode 泛型实例化过深（TS2589）——须**逐个**标注窄接口
// 类型再三目（三目在窄接口上联合，不再实例化 StructOf 深泛型；显式标注避免 as cast）。
// 运行期 decode 只按 byteLength 读、不校验品牌（品牌仅类型层，见 struct.ts decode 签名）。
// u64→bigint / u32→number 的指针宽字段统一为 number|bigint，读侧 Number() 转。
type Decodable<T> = { size: number; decode(buf: ArrayBuffer): T }
type TbInfo = { dwData: number | bigint; iString: number | bigint }
type TrayInfo = { hwnd: number | bigint; uID: number }
const TBBUTTON_X64: Decodable<TbInfo> = struct('TBBUTTON_X64', {
    '#': 'struct', iBitmap: 'i32', idCommand: 'i32', fsState: 'u8@TBState', fsStyle: 'u8@TBStyle',
    bReserved: 'u8[2]', dwData: 'u64', iString: 'u64',
})
const TBBUTTON_X86: Decodable<TbInfo> = struct('TBBUTTON_X86', {
    '#': 'struct', iBitmap: 'i32', idCommand: 'i32', fsState: 'u8@TBState', fsStyle: 'u8@TBStyle',
    bReserved: 'u8[2]', dwData: 'u32', iString: 'u32',
})
// dwData → explorer 内 TRAYDATA{hwnd@0(ptr 宽), uID@(ptr 宽)(u32), …}——shell 把注册
// 图标的消息窗口塞在这（非文档，XP~Win10 十年稳定，AHK TrayIcon_GetInfo 同源）。
const TRAYDATA_X64: Decodable<TrayInfo> = struct('TRAYDATA_X64', { '#': 'struct', hwnd: 'u64', uID: 'u32' })
const TRAYDATA_X86: Decodable<TrayInfo> = struct('TRAYDATA_X86', { '#': 'struct', hwnd: 'u32', uID: 'u32' })
const TBBUTTON = OS64 ? TBBUTTON_X64 : TBBUTTON_X86
const TRAYDATA = OS64 ? TRAYDATA_X64 : TRAYDATA_X86
// TRAYDATA 只读 hwnd+uID 字段区（struct 自身尾部带对齐填充，x64 实际 16B；远程堆对象
// 不必读填充，按字段区读 12/8——decode 只需 buffer 覆盖最后字段）。
const TRAYDATA_BYTES = OS64 ? 12 : 8
const REMOTE_BUF = 256                     // TBBUTTON(≤32)/RECT(16)/tooltip(128 wchar) 分时复用一块

export interface TrayIconEntry {
    /** 'visible' = Shell_TrayWnd 可见区；'overflow' = NotifyIconOverflowWindow 折叠区 */
    area: 'visible' | 'overflow'
    /** toolbar 内按钮序号（= TB_GETITEMRECT 的 iButton） */
    index: number
    /** 注册图标的消息窗口（TRAYDATA.hwnd，IsWindow 校验后才输出；可喂 probeTrayIcon） */
    hWnd: number
    /** Shell_NotifyIcon 的 uID（与 hWnd 合起来定位单图标） */
    uID: number
    /** 按钮 tooltip（iString 远程字符串；IS_INTRESOURCE / 读失败 → null） */
    tooltip: string | null
    /** 屏幕物理像素；全 0 未布局 → null（overflow 区仅面板展开后可靠） */
    rect: { left: number; top: number; right: number; bottom: number } | null
}

/** 子树深搜 ToolbarWindow32：FindWindowEx 只看直接子级，而通知区工具栏埋在
 *  TrayNotifyWnd/SysPager 等中间层下——递归全收，chevron 也可能是独立 toolbar，
 *  交给按钮解析按 IsWindow 滤 */
function findToolbars(root: Ptr<'HWND'>): Ptr<'HWND'>[] {
    const out: Ptr<'HWND'>[] = []
    const cls = WCHAR.alloc(CLS_BUF)
    const walk = (parent: Ptr<'HWND'>): void => {
        let child = FindWindowEx(parent, NULL, NULL, NULL)
        while (child) {
            const n = GetClassName(child, cls, CLS_BUF)
            if (n > 0 && WCHAR.decode(cls) === 'ToolbarWindow32') out.push(child)
            walk(child)
            child = FindWindowEx(parent, child, NULL, NULL)
        }
    }
    walk(root)
    return out
}

/** 枚举一个 toolbar 的通知区按钮（远程读全程；按钮非法即跳过，不整栏失败） */
function readToolbar(tb: Ptr<'HWND'>, area: 'visible' | 'overflow', out: TrayIconEntry[]): void {
    // TB_* 是 commctrl 通用 toolbar 消息，不在 gui 模块生成的消息枚举（AnyMsg 白名单）里
    // ——走 gui.SendMessage（C 直绑收裸 msg:number，运行时同为 SendMessageW）
    const count = gui.SendMessage(tb, TB_BUTTONCOUNT, 0, 0)
    if (!Number.isInteger(count) || count <= 0 || count > 512) return
    const pidBuf = BYTE.alloc(4)
    if (GetWindowThreadProcessId(tb, pidBuf) === 0) return
    const pid = new Uint32Array(pidBuf)[0]!
    const proc = OpenProcess(0x38, 0, pid)                       // VM_OPERATION|VM_READ|VM_WRITE
    if (!proc) throw new Error('OpenProcess(explorer ' + pid + ') failed')
    const remote = VirtualAllocEx(proc, NULL, REMOTE_BUF, 0x3000, 0x04)   // MEM_COMMIT|RESERVE, RW
    if (!remote) { CloseHandle(proc); throw new Error('VirtualAllocEx failed') }
    try {
        const tbBuf = BYTE.alloc(REMOTE_BUF), trBuf = BYTE.alloc(REMOTE_BUF), tipBuf = BYTE.alloc(REMOTE_BUF)
        for (let i = 0; i < count; i++) {
            if (!gui.SendMessage(tb, TB_GETBUTTON, i, remote)) continue
            if (!ReadProcessMemory(proc, remote, tbBuf, TBBUTTON.size, NULL)) continue
            const tbInfo = TBBUTTON.decode(tbBuf)
            const dwData = Number(tbInfo.dwData)                // u64(bigint)/u32 → 统一 number
            if (dwData < 0x10000) continue                        // 分隔符/chevron：dwData 非指针
            if (!ReadProcessMemory(proc, dwData, trBuf, TRAYDATA_BYTES, NULL)) continue
            const td = TRAYDATA.decode(trBuf)
            const hWnd = Number(td.hwnd)
            const uID = td.uID
            if (!hWnd || !IsWindow(hWnd as Ptr<'HWND'>)) continue   // 非通知区按钮滤除
            // rect：TB_GETITEMRECT 写 remote → 读回 RECT 客户区 → ClientToScreen 屏幕化
            let rect: TrayIconEntry['rect'] = null
            if (gui.SendMessage(tb, TB_GETITEMRECT, i, remote) && ReadProcessMemory(proc, remote, trBuf, 16, NULL)) {
                const r = RECT.decode(trBuf)
                if (!(r.left === 0 && r.top === 0 && r.right === 0 && r.bottom === 0)) {
                    const tl = POINT.encode({ x: r.left, y: r.top }), br = POINT.encode({ x: r.right, y: r.bottom })
                    if (ClientToScreen(tb, tl.ptr) && ClientToScreen(tb, br.ptr)) {
                        const a = POINT.decode(tl), b = POINT.decode(br)
                        rect = { left: a.x, top: a.y, right: b.x, bottom: b.y }
                    }
                }
            }
            // tooltip：iString = 远程 UTF-16 字符串（INT_PTR；<0x10000 = IS_INTRESOURCE 无文本）
            const iStr = Number(tbInfo.iString)
            let tooltip: string | null = null
            if (iStr >= 0x10000 && ReadProcessMemory(proc, iStr, tipBuf, 256, NULL)) {
                const s = WCHAR.decode(tipBuf)                  // 读 UTF-16 到 NUL/末尾
                tooltip = s === '' ? null : s
            }
            out.push({ area, index: i, hWnd, uID, tooltip, rect })
        }
    } finally {
        VirtualFreeEx(proc, remote, 0, 0x8000)                   // MEM_RELEASE
        CloseHandle(proc)
    }
}

/** 枚举容器内全部 toolbar 的图标——overflow 容器内实测仅一个 toolbar（xp 519-591 /
 *  win7 折叠态 winRect (1,1)-(1,1) 零尺寸但按钮照读），全读即所得 */
function collectArea(root: Ptr<'HWND'>, area: 'visible' | 'overflow', out: TrayIconEntry[]): void {
    for (const tb of findToolbars(root)) readToolbar(tb, area, out)
}

/** 可见区只读"主条"：TrayNotifyWnd 下可能多个 ToolbarWindow32——主通知区条 + explorer
 *  的"提升暂存"条（空时零尺寸 0 按钮；偶发≈1/4 全新启动把新注册的折叠图标暂存于此，
 *  TB_GETITEMRECT 返回压在折叠键(^)位的幽灵 rect，展开溢出面板后图标回 overflow 条、
 *  幽灵消失——幽灵 rect 点下去只会命中任务栏，须滤除）。通知区条右缘恒贴时钟左界、
 *  图标从右往左生长（实测 xp 591 / win7 1190），暂存条恒在其左侧（空 @1136 / 幽灵
 *  @1108）——取右缘最靠右者，幽灵自然落选；xp 单条无选择余地，无回归 */
function collectVisible(root: Ptr<'HWND'>, out: TrayIconEntry[]): void {
    let main: Ptr<'HWND'> | null = null
    let mainRight = -Infinity
    for (const tb of findToolbars(root)) {
        const rc = RECT.alloc()
        if (!GetWindowRect(tb, rc.ptr)) continue
        const right = RECT.decode(rc).right
        if (right > mainRight) { mainRight = right; main = tb }
    }
    if (main) readToolbar(main, 'visible', out)
}

/** 通知区全量图标：可见区 Shell_TrayWnd + 折叠区 NotifyIconOverflowWindow（后者
 *  XP 不存在 → 恒空）；空托盘/查无窗口 → 空数组（不抛）。
 *  可见区定位在 TrayNotifyWnd 容器内——Shell_TrayWnd 下还有快速启动/窗口按钮等
 *  ToolbarWindow32（XP 实测窗口按钮区被全树递归误收成假图标），通知区图标才有
 *  TRAYDATA 语义；查无 TrayNotifyWnd 再回退全树（罕见布局兜底） */
export function listTrayIcons(): TrayIconEntry[] {
    const icons: TrayIconEntry[] = []
    const tray = FindWindow('Shell_TrayWnd', NULL)
    if (tray) {
        const notifyArea = FindWindowEx(tray, NULL, 'TrayNotifyWnd', NULL)
        collectVisible(notifyArea ? notifyArea : tray, icons)   // NULL 为 0 → falsy 收窄
    }
    const overflow = FindWindow('NotifyIconOverflowWindow', NULL)
    if (overflow) collectArea(overflow, 'overflow', icons)
    return icons
}

/** 单图标探针（Shell_NotifyIconGetRect，**Win7+**；XP 无导出 → hrName 'unsupported'）
 *  实测语义（比 SO 结论细）：hr=0 found——图标在通知区内，rect = 其容器位置，溢出面板
 *  未展开时是残留布局非屏幕可点位；hr=1 hidden——按文档为不可见态（本机未复现，
 *  Win7 溢出图标实测亦返 0）；E_FAIL not_found——不存在，或该图标按 GUID 注册
 *  （网络/操作中心等系统图标实测 hWnd+uID 查不到，如实返回非 bug） */
export function probeTrayIcon(hWnd: Ptr<'HWND'>, uID: number): {
    hr: number
    hrName: string
    rect: TrayIconEntry['rect']
} {
    if (!Shell_NotifyIconGetRect) return { hr: -1, hrName: 'unsupported', rect: null }
    const rc = RECT.alloc()
    const hr = Shell_NotifyIconGetRect({ cbSize: NOTIFYICONIDENTIFIER.size, hWnd, uID }, rc.ptr)
    const hrName = hr === 0 ? 'found' : hr === 1 ? 'hidden'
        : hr === -2147467259 ? 'not_found' : 'hr=0x' + ((hr >>> 0).toString(16))
    if (hr !== 0) return { hr, hrName, rect: null }
    const r = RECT.decode(rc)
    return { hr, hrName, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
}
