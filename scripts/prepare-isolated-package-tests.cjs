/* Prepare a minimal, read-only guest input. Does not launch virtualization. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const staging = path.join(root, "reports", "isolated-package-bundle");
const output = path.join(root, "reports", "isolated-package-results");
const version = require("../package.json").version;
const hash = filename => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, filename))).digest("hex");
const artifacts = [`dist/Azkript-${version}-portable.exe`, `dist/Azkript-Setup-${version}.exe`];
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(output, { recursive: true });
for (const relative of [...artifacts, "package.json", "examples/sample.fdx", "app/tests/fixtures/native-production.fdx", "desktop/tests/accessibility-electron.cjs", "desktop/tests/background-isolation-electron.cjs", "desktop/tests/electron-smoke.cjs", "desktop/tests/portable-launcher.cjs", "scripts/test-portable-launcher.cjs", "scripts/test-packages-in-guest.ps1"]) {
  const destination = path.join(staging, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, relative), destination);
}
fs.cpSync(path.join(root, "rea/node_modules/playwright-core"), path.join(staging, "rea/node_modules/playwright-core"), { recursive: true, dereference: true });
fs.mkdirSync(path.join(staging, "runtime"), { recursive: true });
fs.mkdirSync(path.join(staging, "reports"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(staging, "runtime/node.exe"));
fs.writeFileSync(path.join(staging, "package-test-manifest.json"), JSON.stringify({ preparedAt: new Date().toISOString(), artifacts: artifacts.map(file => ({ file, sha256: hash(file) })), installer: artifacts[1], installedExecutableSHA256: hash("dist/win-unpacked/Azkript.exe"), appAsarSHA256: hash("dist/win-unpacked/resources/app.asar") }, null, 2));
const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const configuration = `<Configuration>\n  <Networking>Disable</Networking>\n  <ClipboardRedirection>Disable</ClipboardRedirection>\n  <PrinterRedirection>Disable</PrinterRedirection>\n  <AudioInput>Disable</AudioInput>\n  <VideoInput>Disable</VideoInput>\n  <MappedFolders>\n    <MappedFolder><HostFolder>${xml(staging)}</HostFolder><SandboxFolder>C:\\AzkriptInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n    <MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\AzkriptOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>\n  </MappedFolders>\n  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\AzkriptInput\\scripts\\test-packages-in-guest.ps1 -OutputDirectory C:\\AzkriptOutput</Command></LogonCommand>\n</Configuration>\n`;
fs.writeFileSync(path.join(root, "reports", "azkript-isolated-packages.wsb"), configuration);
console.log(`Prepared guest input: ${staging}\nGuest output: ${output}\nWindows Sandbox configuration created; no virtual machine or installer launched.`);
