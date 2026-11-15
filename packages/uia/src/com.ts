// COM 低层助手（UIA 专用，叶子模块）：vtable 派发、IUnknown Release、BSTR 读取。
// 不依赖 client/element，可被三者共用。quickwin 提供 COM 语义面
// （SUCCEEDED/FAILED 在 quickwin/lib/com，SysFreeString 在 quickwin/lib/windows/oleaut32）。
import * as ffi from 'ffi'
import { bindAt } from 'quickwin/lib/ffi/bind.js'
import { PTR_SIZE, PtrArrayBuffer } from 'quickwin/lib/ffi/ctype.js'
import { SysFreeString } from 'quickwin/lib/windows/oleaut32.js'

export const SZ = PTR_SIZE
export const SLOT_RELEASE = 2

/** 取对象 vtable 的第 slot 个函数指针（slot 从 0 计，含 IUnknown 3 槽） */
export function vtable(obj: number, slot: number): number {
    return ffi.readPtr(ffi.readPtr(obj) + slot * SZ)
}

/** IUnknown::Release（槽 2）；obj 为 0 时 no-op */
export function release(obj: number): void {
    if (!obj) return
    bindAt(vtable(obj, SLOT_RELEASE), '<>ptr -> u32')(obj)
}

/** BSTR → JS 字符串（BSTR 的 4 字节长度前缀是字节数，内容 UTF-16LE；读完释放）。
 *  传入的是已含 BSTR 指针的输出缓冲（如 get_CurrentName 的出参），失败应返回 ''。 */
export function bstr(buf: PtrArrayBuffer<'<Bstr>ptr'>): string {
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
