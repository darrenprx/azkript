/* Probe the SHIPPED Electron runtime for customizable-<select> support.
 *
 * The app ships as Electron 44, so a CSS feature that only exists in the installed
 * Chrome cannot be relied on. This prints the Chromium version bundled with Electron
 * and whether `appearance: base-select` plus the `::picker(select)` pseudo-element
 * are supported there — the two facts that decide whether native dropdown popups can
 * be replaced with app-drawn Fluent surfaces in the build users actually run.
 *
 * Usage: node_modules/electron/dist/electron.exe scripts/probe-select-support.js
 */
"use strict";

const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 400 });
  await win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        `<!doctype html><html><body><select id="s"><option>a</option><option>b</option></select></body></html>`
      )
  );
  const report = await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById("s");
    const cs = getComputedStyle(el);
    return {
      chrome: navigator.userAgent.match(/Chrome\\/([\\d.]+)/)?.[1] || "?",
      supportsBaseSelect: CSS.supports("appearance", "base-select"),
      supportsPickerPseudo: CSS.supports("selector(::picker(select))"),
      supportsPickerIcon: CSS.supports("selector(::picker-icon)"),
      supportsSelectedOption: CSS.supports("selector(option:checked)"),
      currentAppearance: cs.appearance,
      supportsAnchor: CSS.supports("anchor-name", "--x"),
    };
  })()`);
  console.log(JSON.stringify(report, null, 2));
  win.destroy();
  app.quit();
});
