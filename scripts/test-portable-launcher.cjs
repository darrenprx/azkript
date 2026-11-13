/* Executes the actual portable wrapper, never the unpacked substitute. */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
if (process.argv.includes("--child")) {
  const playwright = require("../node_modules/playwright-core");
  playwright._electron.launch = require("../desktop/tests/portable-launcher.cjs").launch;
  require("../desktop/tests/electron-smoke.cjs");
} else { (async () => {
  const version = require("../package.json").version;
  const executable = path.join(root, "dist", `Azkript-${version}-portable.exe`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "azkript-portable-wrapper-"));
  const report = { testedAt: new Date().toISOString(), executable, sha256: crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex"), actualPortableExecuted: true, operatingSystemIsolation: false, isolation: "Hidden muted app windows; private document/profile/TEMP/TMP/APPDATA/LOCALAPPDATA directories. No installer executed." };
  for (const name of ["temp", "appdata", "localappdata"]) fs.mkdirSync(path.join(temporary, name));
  try {
    const child = spawn(process.execPath, [__filename, "--child"], { cwd: root, env: { ...process.env, AZKRIPT_TEST_EXECUTABLE: executable, TEMP: path.join(temporary, "temp"), TMP: path.join(temporary, "temp"), APPDATA: path.join(temporary, "appdata"), LOCALAPPDATA: path.join(temporary, "localappdata") }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      // Kill the complete owned harness tree while its root PID is still live.
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    }, 180000);
    const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    clearTimeout(watchdog);
    report.passed = status === 0 && !timedOut;
    report.exitCode = status;
    if (timedOut) report.error = "Portable test exceeded 180 seconds; owned process tree terminated.";
    process.exitCode = report.passed ? 0 : 1;
  } finally {
    fs.mkdirSync(path.join(root, "reports"), { recursive: true });
    fs.writeFileSync(path.join(root, "reports/portable-launcher-verification.json"), JSON.stringify(report, null, 2));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; }); }
