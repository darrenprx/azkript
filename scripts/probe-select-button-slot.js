/* Verify, in the SHIPPED Electron runtime, that the customizable-select <button>
 * display slot works: a <button><selectedcontent></selectedcontent></button> child is
 * the only way to get ellipsis truncation AND a surviving ::picker-icon at once.
 *
 * Measured in Chrome 155 (see reports/button-slot-change.png), but the app ships
 * Electron 44 / Chromium 152, so the feature must be confirmed there before it is
 * relied on for the Table Read dock's narrator picker.
 *
 * Usage: node_modules/electron/dist/electron.exe scripts/probe-select-button-slot.js
 */
"use strict";

const { app, BrowserWindow } = require("electron");

const HTML = `<!doctype html><style>
 body{font:600 12px "Segoe UI",sans-serif;margin:0;padding:12px;background:#fff}
 select{appearance:base-select;box-sizing:border-box;width:150px;height:30px;border:1px solid #999;
   border-radius:8px;display:inline-flex;align-items:center;gap:6px;padding:0 8px 0 9px;white-space:nowrap}
 select::picker-icon{content:"";display:block;flex:0 0 auto;width:7px;height:7px;margin:-3px 0 0 0;
   border-right:1.5px solid #333;border-bottom:1.5px solid #333;transform:rotate(45deg)}
 select > button{all:unset;display:block;flex:1 1 auto;min-width:0;overflow:hidden;
   text-overflow:ellipsis;white-space:nowrap;text-align:left;cursor:pointer}
 select > button > selectedcontent{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
<select id="s">
  <button type="button"><selectedcontent></selectedcontent></button>
  <option value="a">Microsoft David - English (United States) en-US</option>
  <option value="b">Microsoft Zira en-US</option>
</select>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 700, height: 300 });
  await win.loadURL("data:text/html," + encodeURIComponent(HTML));
  const report = await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById("s");
    const btn = el.querySelector("button");
    const out = {
      chrome: navigator.userAgent.match(/Chrome\\/([\\d.]+)/)?.[1] || "?",
      hasButtonSlot: !!btn,
      supportsSelectedcontent: CSS.supports("selector(::selectedcontent)"),
      // The truncation only works if the button is a real flex item inside the select.
      buttonWidth: Math.round(btn.getBoundingClientRect().width),
      selectInnerWidth: el.clientWidth,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      buttonText: (btn.textContent || "").trim(),
      valueBefore: el.value,
    };
    el.value = "b";
    el.dispatchEvent(new Event("change", { bubbles: true }));
    out.buttonTextAfter = (btn.textContent || "").trim();
    out.valueAfter = el.value;
    return out;
  })()`);
  console.log(JSON.stringify(report, null, 2));
  win.destroy();
  app.quit();
});
