/* Test-only transport for NSIS portable wrappers, which do not pipe the
 * extracted Electron child's inspector banners back to Playwright. The real
 * wrapper still extracts, launches, forwards arguments, waits and cleans up. */
"use strict";
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const { chromium } = require("../../node_modules/playwright-core");

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function endpoint(port, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(700) });
      const targets = await response.json();
      if (targets[0]?.webSocketDebuggerUrl) return targets[0].webSocketDebuggerUrl;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Portable debug endpoint did not appear on loopback port ${port}`);
}
async function inspector(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Portable inspector closed")); } pending.clear(); });
  return { socket, send(method, params) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Portable inspector timeout: ${method}`)); }, 15000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function launch(options) {
  if (options.env.AZKRIPT_TEST_BACKGROUND !== "1" || !options.env.AZKRIPT_USER_DATA) throw new Error("Portable tests require a private profile and hidden background mode");
  const nodePort = await unusedPort(), browserPort = await unusedPort();
  const child = spawn(options.executablePath, [`--inspect=127.0.0.1:${nodePort}`, `--remote-debugging-port=${browserPort}`, ...options.args], { cwd: options.cwd, env: options.env, windowsHide: true, stdio: "ignore" });
  const application = new EventEmitter();
  const closed = new Promise(resolve => child.once("close", code => { application.emit("close"); resolve(code); }));
  let browser, main;
  try {
    console.log("Portable wrapper: waiting for extracted app inspector");
    const mainURL = await endpoint(nodePort);
    main = await inspector(mainURL);
    await main.send("Runtime.enable", {});
    await main.send("Runtime.evaluate", { expression: "typeof __playwright_run === 'function' && __playwright_run()", includeCommandLineAPI: true });
    console.log("Portable wrapper: main inspector attached");
    await endpoint(browserPort);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${browserPort}`, { timeout: 20000 });
    console.log("Portable wrapper: renderer attached");
    application.evaluate = async (callback, argument) => {
      const result = await main.send("Runtime.evaluate", { expression: `(${callback.toString()})(require('electron'),${JSON.stringify(argument) || "undefined"})`, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    application.firstWindow = async () => {
      const context = browser.contexts()[0];
      return context.pages()[0] || context.waitForEvent("page", { timeout: 20000 });
    };
    application.process = () => child;
    application.close = async () => {
      await application.evaluate(({ BrowserWindow, app }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.quit(); }).catch(() => {});
      // V8 waits for its inspector to disconnect before the wrapper can exit.
      main.socket.close();
      await browser.close().catch(() => {});
      await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error("Portable wrapper failed to exit")), 10000))]);
    };
    // The normal save-on-close path also needs the debugger detached; otherwise
    // Node deliberately waits, leaving the portable extraction alive.
    main.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.consoleAPICalled" && message.params?.args?.some(arg => String(arg.value).includes("__AZKRIPT_TEST_WILL_QUIT__"))) { console.log("Portable wrapper: app quitting, detaching inspector"); main.socket.close(); }
    });
    await application.evaluate(({ app }) => app.on("will-quit", () => console.log("__AZKRIPT_TEST_WILL_QUIT__")));
    return application;
  } catch (error) {
    main?.socket.close();
    await browser?.close().catch(() => {});
    if (child.exitCode === null) {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await new Promise(resolve => killer.once("close", resolve));
    }
    throw error;
  }
}
module.exports = { launch };
