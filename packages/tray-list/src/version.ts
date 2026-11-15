// OS 版本判定——托盘选路依赖：Win11 任务栏经典 TB_GETBUTTON 跨进程读失效，须走 UIA；
// Win7/XP 经典路可靠。用 RtlGetVersion（ntdll，真实版本，绕过 GetVersionEx 兼容谎言）。
import { RtlGetVersion } from 'quickwin/lib/windows/ntdll.js'
import { OSVERSIONINFO_148 } from 'quickwin/lib/windows/structs.js'

/** 是否 Windows 11（NT 10.0 build >= 22000；Win10 build < 22000）。
 *  失败（RtlGetVersion 非 0）→ false（保守走经典路）。不抛。 */
export function isWin11(): boolean {
    // encode 新 buffer 全 0、缺省字段跳过；仅预填 dwOSVersionInfoSize=148（structs.ts
    // 注释：否则 RtlGetVersion 越界写坏调用方堆），其余字段由 RtlGetVersion 回填。
    const v = OSVERSIONINFO_148.encode({ dwOSVersionInfoSize: 148 })
    if (RtlGetVersion(v.ptr) !== 0) return false
    const info = OSVERSIONINFO_148.decode(v)
    return info.dwMajorVersion === 10 && info.dwBuildNumber >= 22000
}
