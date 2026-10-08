# macOS 适配说明

macOS 版本沿用同一套悬浮胶囊和数据同步逻辑，窗口层做了平台分离：

- 透明无边框窗口由 Electron 创建，CSS Liquid Glass 只绘制胶囊本体。
- Windows 的 `user32.dll/gdi32.dll` 圆角裁剪只在 Windows 加载；macOS 不加载 `koffi` 原生 DLL。
- 悬浮拖动继续通过 Electron 屏幕坐标 IPC 完成，位置保存在本地 SQLite。
- 置顶层在 macOS 使用 `floating`，Windows 继续使用 `pop-up-menu`。
- 菜单栏图标、设置窗口、演示模式和 GerpGo/REST ERP 数据源共用主进程代码。

本地构建：

```bash
npm ci
npm test
npm run pack:mac
```

GitHub Release 当前构建 Intel (`x64`) 的 ZIP；解压后即可将 `Amazon Sales Bubble.app` 拖入“应用程序”。Apple Silicon 通过 Rosetta 运行该版本。需要原生 arm64 或 DMG 时，可在对应 macOS 本机执行 `npm run pack:mac -- --arm64` 或 `npx electron-builder --config electron-builder.config.cjs --mac dmg --arm64`。当前产物未签名、未公证；正式分发时需要配置 Apple Developer ID、签名证书和公证凭证。
