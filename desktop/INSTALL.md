# QuotaDeck Desktop — install guide

A second-taskbar strip for Windows that shows your AI provider quotas live:
ZAI, DeepSeek and Qwen plan status, without opening a browser.

## Requirements

- Windows 10 or 11 (64-bit).
- WebView2 Runtime (preinstalled on Windows 11; the installer downloads it on
  Windows 10 if missing).
- No other dependencies. No Node, no Python.

## Install

1. Get `QuotaDeck_0.1.0_x64-setup.exe` (from the release folder / shared
   drive).
2. Double-click it. Windows SmartScreen will show a warning because the
   installer is unsigned: click **More info**, then **Run anyway**.
3. Follow the setup wizard (Next, Next, Install). The app starts hidden in
   the system tray (near the clock; Windows may keep it behind the `^`
   chevron — drag it onto the taskbar to pin it).

## First run

Right-click the tray icon for the menu:

- **Keys...** — opens the settings window. Enter your credentials (stored in
  the Windows Credential Manager of THIS machine, never synced):
  - **ZAI**: your monitor API token (pick platform Z.AI or ZHIPU first).
  - **Qwen**: AccessKeyId + AccessKeySecret pair, and optionally the
    `sk-sp-` plan key.
  - **DeepSeek**: your API key (bearer).
- **Qwen console...** — opens the Alibaba console in an embedded browser
  window (for manual inspection; the qwen % currently lives in the Chrome
  extension).
- **Start with Windows** — launch the strip automatically at login.
- **Always on top** — keep the strip pinned above other windows.
- **Quit** — close the app.

Left-click the tray icon to show/hide the quota strip. Use the PIN button in
Keys or the tray checkbox to keep it permanently visible.

## Strip settings

Open **Keys...** and use the **TRAY STRIP** section:

- Reorder providers with the arrow buttons.
- **Orientation**: horizontal (above the taskbar) or vertical (right screen
  edge, growing up from the taskbar).
- **Size**: Normal (taskbar height) or Extra large.

Only providers with a stored key render a segment.

## Uninstall

Windows Settings → Apps → QuotaDeck → Uninstall. Stored keys in the
Credential Manager entry `quotadeck-desktop` are removed automatically.
