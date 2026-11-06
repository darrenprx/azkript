/* Launch the real Electron shell, prove the packaged icon resolves, and capture
 * the window.
 *
 * This is the only check that exercises the actual desktop icon path
 * (desktop/assets/icon.png) rather than a browser <img>, so it is what catches an
 * icon that is present on disk but rejected by Electron.
 *
 * Usage: node_modules\.bin\electron.cmd scripts\smoke-icon.cjs [--out=<png>]
 */
"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const iconPath = path.join(ROOT, "desktop", "assets", "icon.png");
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(ROOT, "desktop", "preload.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  await win.loadFile(path.join(ROOT, "app", "index.html"));
  await new Promise((resolve) => setTimeout(resolve, 2600));

  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const out = outArg
    ? path.resolve(outArg.split("=").slice(1).join("="))
    : path.join(process.env.TEMP, "azkript-brand", "electron-shell.png");

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());

  const exists = fs.existsSync(iconPath);
  console.log("ICON_PATH:", iconPath);
  console.log("ICON_EXISTS:", exists, "bytes:", exists ? fs.statSync(iconPath).size : 0);
  console.log("WINDOW_TITLE:", win.getTitle());
  console.log("SHOT:", out);
  app.quit();
}).catch((error) => {
  console.error("ERR", error);
  app.quit();
});
