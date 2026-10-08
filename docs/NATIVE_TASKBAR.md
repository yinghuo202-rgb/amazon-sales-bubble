# 原生任务栏方案验证

验证环境：Windows 11，OS build 22631，主显示器 150% DPI，含多显示器。

## 当前实现结论

`electron/taskbar-mode.cjs` 始终返回 `nativeAvailable: false`、`Compatibility Overlay Mode`。当前工程没有实现或注册 COM DeskBand，没有将 React 窗口嵌入 Explorer，也没有修改系统任务栏配置。不得将此构建描述为 Native Taskbar Mode。

`electron/windows.cjs` 单独封装任务栏/通知区读取、Acrylic 材质及圆角区域。已实测读到 Shell_TrayWnd、TrayNotifyWnd，并按 Electron screen.screenToDipRect 转换 150% DPI 的物理坐标。测试覆盖右侧通知区避让、隐藏任务栏、竖向不支持布局。任务栏方向、重启 Explorer、自动隐藏、多屏切换仍需更完整实机回归。

## 候选技术路线

1. Windows 10：Microsoft 的 Band Objects/DeskBand COM 扩展是需要独立验证的原生候选，涉及 Shell 装载与位数匹配，不能用独立透明窗口替代其验证。
2. Windows 11：不能假定 Windows 10 DeskBand 注册后仍能提供同样宿主行为；需要在明确的目标系统构建中验证任务栏扩展能力。现工程没有可声明通过的原生实现。
3. Windows Acrylic：模糊背景属于窗口材质，和任务栏提供可分配槽位是两个独立问题。

## 兼容模式已知边界

- 窗口放在通知区左侧，但没有原生保留空间；任务栏应用图标过多时会发生覆盖。
- 原生定位 API 不可用时，尝试屏幕工作区底部定位；没有可用任务栏空间则隐藏，不伪装成原生槽位。
- 自动隐藏和竖向布局不会弹出一个替代性的固定桌面小卡片。
- 设置通过托盘始终可访问。用户可通过 Hide/Show 控制组件。
- 当前首帧已使用带不透明底色的 Acrylic 外壳并能读到金额；仍需在更多 DPI、多屏和 Explorer 重启组合下完成实机验收。

## 官方资料

- [Microsoft Band Objects](https://learn.microsoft.com/en-us/windows/win32/shell/band-objects)
- [Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents)

在原生宿主验证完成之前，UI、文档和发行说明都保留 Compatibility Overlay Mode 标签。
