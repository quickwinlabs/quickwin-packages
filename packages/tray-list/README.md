# @quickwinlabs/tray-list

Windows 通知区（系统托盘）图标枚举，供 [QuickWin](https://www.npmjs.com/package/quickwin) 使用。

双机制互补（按 OS 版本选路或都试）：

- `listTrayIcons()` / `probeTrayIcon()` —— 经典 `TB_GETBUTTON` 跨进程读（Win7/XP 可靠）
- `listTrayIconsUia()` —— UIA 路（Win11；经典跨进程读在 Win11 任务栏失效，须走 UIA）

```ts
import { listTrayIcons, listTrayIconsUia } from '@quickwinlabs/tray-list'

// Win11 → UIA 路（5 个托盘按钮）
const uia = listTrayIconsUia()
for (const t of uia) console.log(t.className, t.rect)

// Win7/XP → 经典路
const classic = listTrayIcons()
for (const t of classic) console.log(t.hWnd, t.uID, t.tooltip)
```

## API

| 导出 | 说明 |
|---|---|
| `listTrayIcons()` | 经典路：可见区 + 折叠区全量图标（`TrayIconEntry[]`） |
| `probeTrayIcon(hwnd, uID)` | 经典路：单图标可见性探针（Win7+） |
| `listTrayIconsUia()` | UIA 路：Win11 托盘可见按钮（`UiaTrayIcon[]`） |

全部失败 → 空数组 / `null`（不抛）。

## 依赖

- `quickwin`（peer）—— QuickWin 运行时包
- `@quickwinlabs/uia`（peer）—— UIA 通用客户端（`listTrayIconsUia` 用）

消费方 esbuild 须把 `ffi`/`gui`/`os` 等 QuickWin 运行时内建标 `external`。
