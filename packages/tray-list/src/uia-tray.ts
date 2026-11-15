// 托盘枚举（UIA 路，Win11）——在 @quickwinlabs/uia 通用客户端之上实现。
// 与经典 TB_GETBUTTON 路（tray.ts）互补：Win11 任务栏的经典跨进程读失效（见下），
// 经典路 Win7/XP 可用；消费方可按 OS 版本选路或都试。
//
// Win11 任务栏的经典跨进程读（TB_GETBUTTON，见 tray.ts）失效：
//   * ElementFromHandle(Shell_TrayWnd) 的 UIA 子树恒 0 元素（任务栏 UIA 树由 shell 的
//     TaskbarFrameAutomationPeer 提供，不走 HWND 子窗口）；
//   * TaskbarFrame 的 FindAll(Descendants) 只覆盖左侧按钮区（Widgets/Start/搜索/任务
//     视图/固定应用），SystemTray.*（托盘）在其子树之外——须从**根元素**整树过滤。
// 故：GetRootElement → FindAll(TreeScope_Subtree, TrueCondition) → 按 ClassName 前缀
// SystemTray.* 过滤（实测 Win11 26200 取到 5 个托盘按钮）。
import { UiaClient, TreeScope } from '@quickwinlabs/uia'

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

/**
 * 枚举 Win11 任务栏托盘的可见按钮（SystemTray.* 元素）。
 * 失败/不支持（XP/Win7 无该 UIA 树、COM 初始化失败）→ 空数组，不抛。
 * 路径：GetRootElement → FindAll(Subtree) → 按 ClassName 前缀 SystemTray.* 过滤。
 * 当前只覆盖**可见区**；"Show Hidden Icons" 折叠面板里的隐藏图标需先展开面板
 * 再枚举，属交互路径（UiaElement.invoke / expand），后续版本再扩。
 */
export function listTrayIconsUia(): UiaTrayIcon[] {
    const client = UiaClient.create()
    if (!client) return []
    try {
        const root = client.root()
        if (!root) return []
        try {
            const els = root.findAllWhere(TreeScope.Subtree, (el) => el.className().startsWith('SystemTray'))
            const out: UiaTrayIcon[] = []
            for (const el of els) {
                try {
                    const r = el.rect()
                    if (!r) continue
                    out.push({
                        name: el.name(),
                        className: el.className(),
                        controlType: el.controlType(),
                        rect: r,
                        offscreen: el.isOffscreen(),
                    })
                } finally {
                    el.release()
                }
            }
            return out
        } finally {
            root.release()
        }
    } finally {
        client.close()
    }
}
