// @quickwinlabs/tray-list 公共入口。
// 托盘（通知区）图标枚举，双机制：
//   * listTrayIcons / probeTrayIcon —— 经典 TB_GETBUTTON 跨进程读（Win7/XP）
//   * listTrayIconsUia —— UIA 路（Win11；详见 uia-tray.ts 注释）
//   * isWin11 —— OS 判定（托盘选路：Win11 经典失效，须走 UIA）
export { listTrayIcons, probeTrayIcon, type TrayIconEntry } from './tray.js'
export { listTrayIconsUia, type UiaTrayIcon } from './uia-tray.js'
export { isWin11 } from './version.js'
