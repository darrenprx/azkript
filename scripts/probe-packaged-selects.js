/* Assert the ASAR that ships draws its dropdowns in-app, not via the OS.
 *
 * Every visual check in this repo screenshots `app/index.html` — the source tree. A
 * previous session shipped a stale `dist/` whose source was right and whose artifact
 * was old, and no check could see it. This loads `dist/win-unpacked/resources/app.asar`
 * directly (not the source tree) and asserts the dropdown facts on the shipped files.
 *
 * Unlike an exe launch, this does not need desktop/main.js: `loadFile` on a path inside
 * the asar is enough, and `app.getAppPath()` proves which payload was loaded.
 *
 * Usage: node_modules/electron/dist/electron.exe scripts/probe-packaged-selects.js
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "azkript-selects-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("mute-audio");
app.on("will-quit", () => {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium can retain a temporary lock. */ }
});

const root = path.resolve(__dirname, "..");
const asarRoot = path.join(root, "dist", "win-unpacked", "resources", "app.asar");
const entry = path.join(asarRoot, "app", "index.html");

const MEASURE_SELECTS = () => {
  const rows = [];
  for (const el of document.querySelectorAll("select")) {
    if (!el.offsetWidth || !el.offsetHeight) continue;
    const cs = getComputedStyle(el);
    rows.push({
      id: el.id || "(anon)",
      appearance: cs.appearance,
      pickerSupported: CSS.supports("selector(::picker(select))"),
      radius: cs.borderTopLeftRadius,
    });
  }
  return rows;
};

const MEASURE_POPUP = () => {
  const el = document.getElementById("beatAlignSelect");
  if (!el) return { error: "beatAlignSelect missing" };
  const cs = getComputedStyle(el, "::picker(select)");
  return {
    radius: cs.borderTopLeftRadius,
    background: cs.backgroundColor,
    padding: cs.padding,
    boxShadow: cs.boxShadow === "none" ? "none" : "set",
  };
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900 });
  await win.loadFile(entry);
  await new Promise((resolve) => setTimeout(resolve, 1700));
  await win.webContents.executeJavaScript(
    `(() => { const sc = document.getElementById("startCenter"); if (sc && sc.tagName === "DIALOG") sc.close(); else if (sc) sc.hidden = true; return true; })()`
  );
  await win.webContents.executeJavaScript(
    `(() => { document.querySelector('[data-view="beatboard"]')?.click(); return true; })()`
  );
  await new Promise((resolve) => setTimeout(resolve, 700));

  const selects = await win.webContents.executeJavaScript(`(${MEASURE_SELECTS.toString()})()`);
  const popup = await win.webContents.executeJavaScript(`(${MEASURE_POPUP.toString()})()`);
  const ua = await win.webContents.executeJavaScript("navigator.userAgent");
  const scriptDir = await win.webContents.executeJavaScript(
    `Array.from(document.styleSheets).map((s) => (s.href || "").split("/").pop())`
  );

  const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || "?";
  const bad = selects.filter((row) => row.appearance !== "base-select");
  /* Which payload was actually rendered? Must be the asar, not the source tree:
   * `app.getAppPath()` is the script's directory when Electron is launched with a
   * script path, so it cannot answer this. The loaded URL can. */
  const loadedUrl = win.webContents.getURL();
  const loadedFromAsar = loadedUrl.includes("app.asar");
  const report = {
    loadedUrl,
    loadedFromAsar,
    stylesheets: scriptDir,
    chromium: chromeVersion,
    selectCount: selects.length,
    appearances: [...new Set(selects.map((r) => r.appearance))],
    pickerSupported: selects.every((r) => r.pickerSupported),
    offending: bad.map((r) => `${r.id}=${r.appearance}`),
    popup,
  };
  console.log(JSON.stringify(report, null, 2));

  const pass =
    loadedFromAsar &&
    selects.length > 0 &&
    bad.length === 0 &&
    report.pickerSupported &&
    popup.radius !== "0px" &&
    popup.background !== "rgba(0, 0, 0, 0)";
  console.log(
    pass
      ? "PASS: the SHIPPED asar draws its dropdown popups in-app"
      : "FAIL: the shipped asar still uses native dropdowns"
  );
  win.destroy();
  app.exit(pass ? 0 : 1);
});
