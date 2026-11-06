/* Azkript — Electron main process.
 *
 * The renderer is intentionally still a plain, dependency-free web app. This
 * process supplies the desktop contract: native file dialogs, atomic writes,
 * recent documents, crash recovery, menus, printing/PDF, spellcheck and
 * window lifecycle. It never executes or modifies any third-party application.
 */
"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  webContents,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { buildApplicationMenu } = require("./menu");
const { migrateProfile } = require("./profile-migration");
const { BackupStore, FileChangeWatcher, readFileVersion, checkExpectedIdentity, canonicalPath, sha256 } = require("./document-safety");

const APP_NAME = "Azkript";
/* Previous release's profile folder name. Electron derives userData from the
 * application name, so this literal is what the one-time migration looks for
 * under %APPDATA%; it is not a product name shown anywhere in the UI. */
const LEGACY_PROFILE_DIR_NAME = "Final Draft Studio";
const APP_ID = "com.azkript.desktop";
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const RECENT_LIMIT = 12;
const COMMAND = "desktop:command";
const FDX_FILTERS = [
  { name: "Azkript Screenplay", extensions: ["fdx"] },
  { name: "Azkript Template", extensions: ["fdxt"] },
  { name: "XML Document", extensions: ["xml"] },
  { name: "All Files", extensions: ["*"] },
];

// Test and portable-profile override. Set before app is ready so userData is
// stable for recovery, recent files, window state, and Chromium storage.
// AZKRIPT_USER_DATA is current; the pre-rename FDSTUDIO_USER_DATA still works
// so existing scripts and shortcuts keep pointing at their profile.
const profileOverride =
  process.env.AZKRIPT_USER_DATA || process.env.FDSTUDIO_USER_DATA || "";
// Background automation must opt in with its own profile. Normal launches,
// including packaged launches, retain their usual window behavior.
const backgroundTest = Boolean(profileOverride) &&
  process.env.AZKRIPT_TEST_BACKGROUND === "1";
if (profileOverride) {
  app.setPath("userData", path.resolve(profileOverride));
}
if (backgroundTest) {
  // Hidden windows alone do not prevent native pickers stealing desktop focus.
  // Tests may replace these methods with explicit private file destinations.
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => ({ canceled: true });
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1) || {};
    process.stderr.write(`[background-test] Suppressed native prompt: ${options.title || "message"}\n`);
    return { response: Number.isInteger(options.cancelId) ? options.cancelId : 0, checkboxChecked: false };
  };
  shell.showItemInFolder = () => {};
  shell.openPath = async () => "Disabled during isolated background testing.";
  shell.openExternal = async () => {};
}

let mainWindow = null;
let windowReady = false;
let pendingOpen = null;
let dirty = false;
let documentTitle = "Untitled Screenplay";
let documentPath = null;
let isQuitting = false;
let forceClose = false;
let closePromptOpen = false;
let pendingClose = false;
let stateSaveTimer = null;
let recent = [];
let userDataRoot = "";
let recoveryActive = false;
let recoveryWritesAllowed = true;
let recoveryQueue = Promise.resolve();
let backupStore = null;
const fileWrites = new Map();
const fileWatcher = new FileChangeWatcher((payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:file-changed", payload);
});

function historyStore() {
  if (!backupStore) backupStore = new BackupStore(path.join(userDataRoot || app.getPath("userData"), "backups"));
  return backupStore;
}

function queueFileWrite(filePath, operation) {
  const key = canonicalPath(filePath);
  const previous = fileWrites.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  fileWrites.set(key, pending);
  pending.finally(() => { if (fileWrites.get(key) === pending) fileWrites.delete(key); }).catch(() => {});
  return pending;
}

function queueRecovery(operation) {
  const pending = recoveryQueue.then(operation);
  recoveryQueue = pending.catch(() => {});
  return pending;
}

const windowDefaults = { width: 1500, height: 980, x: undefined, y: undefined, maximized: false };

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const data = JSON.stringify(value, null, 2);
  await writeAtomic(file, data);
}

function ensureDir(dir) {
  return fsp.mkdir(dir, { recursive: true });
}

async function writeAtomic(file, contents, beforeCommit) {
  const dir = path.dirname(file);
  await ensureDir(dir);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    const handle = await fsp.open(tmp, "wx", 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      // Recheck after staging/flushing large writes, not only before that I/O.
      // This remains optimistic concurrency: filesystems do not offer an
      // atomic compare-content-and-replace operation across other editors.
      if (beforeCommit) {
        const conflict = await beforeCommit();
        if (conflict) { await fsp.rm(tmp, { force: true }); return conflict; }
      }
      try { await fsp.rename(tmp, file); break; }
      catch (error) {
        if (attempt >= 2 || !["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } catch (error) {
    // Never fall back to truncating/copying over the destination: a failed
    // atomic replacement leaves the original file and history intact.
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function safeName(value, fallback = "screenplay") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function findOpenPath(argv) {
  const candidates = (argv || []).slice(1);
  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith("-")) continue;
    const resolved = path.resolve(candidate);
    if (/\.(fdx|fdxt)$/i.test(resolved)) return resolved;
  }
  return null;
}

function setTitlebarColors() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = nativeTheme.shouldUseDarkColors;
  try {
    mainWindow.setTitleBarOverlay({
      color: dark ? "#171614" : "#f7f5f1",
      symbolColor: dark ? "#f7f6f4" : "#1b1a19",
      height: 48,
    });
  } catch {
    /* Linux or custom frame */
  }
  mainWindow.setBackgroundColor(dark ? "#171614" : "#efece8");
}

function setRendererState(payload) {
  if (!payload || !mainWindow || mainWindow.isDestroyed()) return;
  if (typeof payload.dirty === "boolean") dirty = payload.dirty;
  if (typeof payload.title === "string") documentTitle = payload.title;
  if (typeof payload.filePath === "string" || payload.filePath === null) {
    documentPath = payload.filePath || null;
  }
  if (typeof payload.theme === "string") {
    /* Electron's nativeTheme.themeSource understands only light / dark / system.
     * The renderer offers a fourth option, "midnight", which is a dark-appearance
     * theme; the allow-list here did not include it, so picking midnight fell
     * through to "system" and the native titlebar overlay stayed light on a
     * light-OS machine while the app itself was nearly black. Map the renderer's
     * dark-like themes onto Electron's vocabulary instead of discarding them. */
    const ALLOWED = ["light", "dark", "system"];
    const DARK_LIKE = ["midnight"];
    const requested = payload.theme;
    nativeTheme.themeSource = ALLOWED.includes(requested)
      ? requested
      : DARK_LIKE.includes(requested)
        ? "dark"
        : "system";
  }
  const dot = dirty ? "● " : "";
  mainWindow.setTitle(`${dot}${documentTitle || "Untitled Screenplay"} — ${APP_NAME}`);
  if (documentPath) {
    mainWindow.setRepresentedFilename(documentPath);
    if (!backgroundTest) app.addRecentDocument(documentPath);
  } else {
    mainWindow.setRepresentedFilename("");
  }
  if (process.platform === "darwin") mainWindow.setDocumentEdited(dirty);
  setTitlebarColors();
}

function sendCommand(command, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!windowReady) {
    pendingOpen = { command, payload };
    return;
  }
  mainWindow.webContents.send(COMMAND, { command, payload });
}

function showWindow() {
  if (!mainWindow) return;
  if (backgroundTest) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ------------------------------------------------------------------ */
/* persistent state                                                    */
/* ------------------------------------------------------------------ */

function loadRecent() {
  const data = readJsonSync(path.join(userDataRoot, "recent.json"), { items: [] });
  recent = Array.isArray(data.items)
    ? data.items
        .filter((item) => item && typeof item.path === "string")
        .filter((item) => fs.existsSync(item.path))
        .slice(0, RECENT_LIMIT)
    : [];
}

async function saveRecent() {
  await writeJsonAtomic(path.join(userDataRoot, "recent.json"), {
    version: 1,
    items: recent,
  });
}

async function rememberRecent(filePath, title) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const item = {
    path: resolved,
    name: path.basename(resolved),
    title: title || "",
    openedAt: new Date().toISOString(),
  };
  recent = [item, ...recent.filter((entry) => entry.path !== resolved)].slice(0, RECENT_LIMIT);
  await saveRecent();
  rebuildMenu();
}

function clearRecent() {
  recent = [];
  saveRecent().catch(() => {});
  rebuildMenu();
}

function rebuildMenu() {
  if (!userDataRoot) return;
  const menu = buildApplicationMenu({
    send: sendCommand,
    recent,
    clearRecent,
    openRecent: (filePath) => openFilePath(filePath, true),
    openDocs: () => {
      const docs = app.isPackaged
        ? path.join(process.resourcesPath, "docs", "fdx-format.md")
        : path.join(__dirname, "..", "docs", "fdx-format.md");
      shell.openPath(docs).catch(() => {});
    },
    showStartCenter: () => sendCommand("start-center"),
    isDev: !app.isPackaged,
  });
  Menu.setApplicationMenu(menu);
}

function loadWindowState() {
  const saved = readJsonSync(path.join(userDataRoot, "window-state.json"), {});
  const state = { ...windowDefaults, ...saved };
  if (!Number.isFinite(state.width) || state.width < 900) state.width = windowDefaults.width;
  if (!Number.isFinite(state.height) || state.height < 600) state.height = windowDefaults.height;
  return state;
}

function statePath() {
  return path.join(userDataRoot, "window-state.json");
}

function saveWindowStateSoon() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(saveWindowState, 220);
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  writeJsonAtomic(statePath(), {
    ...bounds,
    maximized: mainWindow.isMaximized(),
  }).catch(() => {});
}

function recoveryPath() {
  return path.join(userDataRoot, "recovery", "session.json");
}

 /* ------------------------------------------------------------------ */
/* profile migration                                                   */
/* ------------------------------------------------------------------ */

/* One-time carry-over from the pre-rename profile folder. The app is called
 * Azkript now, so Electron resolves a fresh %APPDATA%\Azkript; without this a
 * returning user would silently lose recent documents, window placement,
 * crash recovery and Chromium-held document/prefs storage. */
async function migrateLegacyProfile() {
  /* A explicit profile override means the caller owns the folder; never mix a
   * migrated profile into a test or portable one. */
  if (profileOverride) return false;
  const result = await migrateProfile({
    userDataDir: app.getPath("userData"),
    legacyDir: path.join(app.getPath("appData"), LEGACY_PROFILE_DIR_NAME),
  }).catch(() => ({ migrated: false }));
  return Boolean(result.migrated);
}

async function readRecovery() {
  const file = recoveryPath();
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) return null;
    const data = JSON.parse(await fsp.readFile(file, "utf8"));
    if (!data || typeof data !== "object" || !data.document) return null;
    return {
      ...data,
      ageMs: Date.now() - stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

async function clearRecovery() {
  return queueRecovery(async () => {
    recoveryActive = false;
    await fsp.rm(recoveryPath(), { force: true }).catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* file IO                                                             */
/* ------------------------------------------------------------------ */

async function readDocumentFile(filePath) {
  const result = await readFileVersion(filePath, { includeContents: true });
  if (result.missing) throw new Error("That screenplay file no longer exists.");
  const { buffer, ...payload } = result;
  return payload;
}

async function openDocumentDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Screenplay",
    properties: ["openFile"],
    filters: FDX_FILTERS,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const file = await readDocumentFile(result.filePaths[0]);
  await rememberRecent(file.path, "");
  return file;
}

async function openFilePath(filePath, fromMenu = false) {
  try {
    const file = await readDocumentFile(filePath);
    await rememberRecent(file.path, documentTitle);
    if (!mainWindow || mainWindow.isDestroyed()) return file;
    if (!windowReady) {
      pendingOpen = { command: "open-document", payload: file };
    } else {
      if (fromMenu) showWindow();
      mainWindow.webContents.send(COMMAND, { command: "open-document", payload: file });
    }
    return file;
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Could not open screenplay",
        message: "Azkript could not open that file.",
        detail: String(error && error.message ? error.message : error),
        buttons: ["OK"],
      });
    }
    return null;
  }
}

async function saveDocument(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No window is available.");
  let target = typeof payload.path === "string" && payload.path ? path.resolve(payload.path) : null;
  const expectedPath = typeof payload.expectedPath === "string" && payload.expectedPath
    ? path.resolve(payload.expectedPath) : target;
  const wantsDialog = payload.saveAs === true || !target;
  let expectedIdentity = payload.expectedIdentity;
  if (wantsDialog) {
    const fallback = path.join(
      app.getPath("documents"),
      `${safeName(payload.defaultName || documentTitle)}.fdx`,
    );
    const result = await dialog.showSaveDialog(mainWindow, {
      title: payload.saveAs ? "Save Screenplay As" : "Save Screenplay",
      defaultPath: target || fallback,
      filters: [
        { name: "Azkript Screenplay", extensions: ["fdx"] },
        { name: "Azkript Template", extensions: ["fdxt"] },
      ],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  if (!path.extname(target)) target += ".fdx";
  target = path.resolve(target);
  if (typeof payload.protectedSourcePath === "string" && payload.protectedSourcePath &&
      canonicalPath(target) === canonicalPath(payload.protectedSourcePath)) {
    return { copyRequired: true, canceled: false, path: target, name: path.basename(target) };
  }
  // Save As may choose the active file again. Preserve its identity guard in
  // that case; selecting a different copy destination does not inherit it.
  if (!expectedPath || canonicalPath(target) !== canonicalPath(expectedPath)) expectedIdentity = undefined;
  const contents = String(payload.contents || "");
  if (Buffer.byteLength(contents, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("The screenplay is larger than the 64 MB safety limit.");
  }
  return queueFileWrite(target, async () => {
    const conflict = await checkExpectedIdentity(target, expectedIdentity);
    if (conflict) return conflict;
    const prior = await readFileVersion(target, { includeContents: true });
    if (!prior.missing && prior.identity !== sha256(Buffer.from(contents, "utf8"))) {
      await historyStore().create({ filePath: target, documentId: payload.documentId,
        title: payload.defaultName || documentTitle, buffer: prior.buffer });
    }
    // Backup I/O may take time. Recheck before replacing the original.
    const changed = await checkExpectedIdentity(target, expectedIdentity);
    if (changed) return changed;
    const stagedConflict = await writeAtomic(target, contents, () => checkExpectedIdentity(target, expectedIdentity));
    if (stagedConflict) return stagedConflict;
    const stat = await fsp.stat(target);
    const identity = sha256(Buffer.from(contents, "utf8"));
    fileWatcher.accept(target, identity);
    await rememberRecent(target, payload.defaultName || documentTitle);
    // Exports share this writer; renderer owns active-document state.
    return { canceled: false, path: target, name: path.basename(target),
      size: stat.size, mtimeMs: stat.mtimeMs, identity };
  });
}

async function exportPdf(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No window is available.");
  const fallback = path.join(
    app.getPath("documents"),
    `${safeName(payload.defaultName || documentTitle)}.pdf`,
  );
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export PDF",
    defaultPath: fallback,
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const target = result.filePath.endsWith(".pdf") ? result.filePath : `${result.filePath}.pdf`;
  const pdf = await mainWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { marginType: "none" },
    displayHeaderFooter: false,
  });
  if (!pdf || pdf.length < 5 || pdf.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("The PDF renderer did not return a valid document.");
  }
  await writeAtomic(target, pdf);
  const stat = await fsp.stat(target);
  return {
    canceled: false,
    path: target,
    name: path.basename(target),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function printDocument() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ ok: false, reason: "no-window" });
  }
  const page = mainWindow.__pageSize || { width: 8.5, height: 11 };
  return new Promise((resolve) => {
    mainWindow.webContents.print(
      {
        silent: false,
        printBackground: true,
        pageSize: {
          width: Math.round(page.width * 25400),
          height: Math.round(page.height * 25400),
        },
        margins: { marginType: "none" },
      },
      (success, failureReason) => resolve({ ok: success, reason: failureReason || null }),
    );
  });
}

/* ------------------------------------------------------------------ */
/* window lifecycle                                                    */
/* ------------------------------------------------------------------ */

async function handleClose(event) {
  if (forceClose) return;
  if (!dirty) {
    recoveryWritesAllowed = false;
    await clearRecovery();
    saveWindowState();
    return;
  }
  event.preventDefault();
  if (closePromptOpen || pendingClose) return;
  closePromptOpen = true;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Unsaved changes",
    message: `Save changes to “${documentTitle || "Untitled Screenplay"}”?`,
    detail: "Your changes will be lost if you close without saving.",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  closePromptOpen = false;
  if (response === 2) return;
  if (response === 1) {
    forceClose = true;
    recoveryWritesAllowed = false;
    await clearRecovery();
    mainWindow.close();
    return;
  }
  pendingClose = true;
  mainWindow.webContents.send("desktop:request-save", { forClose: true });
}

function installContextMenu(win) {
  win.webContents.on("context-menu", (event, params) => {
    const menu = [];
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 6);
      if (suggestions.length) {
        for (const suggestion of suggestions) {
          menu.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          });
        }
      } else {
        menu.push({ label: "No spelling suggestions", enabled: false });
      }
      menu.push({ type: "separator" });
      menu.push({
        label: `Add “${params.misspelledWord}” to Dictionary`,
        click: () =>
          win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      menu.push({ type: "separator" });
    }
    if (params.isEditable) {
      menu.push(
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "selectAll", label: "Select All" },
      );
    } else if (params.selectionText) {
      menu.push({ role: "copy", label: "Copy" });
    }
    if (params.linkURL) {
      if (menu.length) menu.push({ type: "separator" });
      menu.push({
        label: "Open Link in Browser",
        click: () => {
          try {
            const url = new URL(params.linkURL);
            if (["https:", "http:"].includes(url.protocol)) shell.openExternal(url.href);
          } catch {
            /* ignore malformed link */
          }
        },
      });
      menu.push({
        label: "Copy Link Address",
        click: () => require("electron").clipboard.writeText(params.linkURL),
      });
    }
    if (menu.length) Menu.buildFromTemplate(menu).popup({ window: win });
  });
}

async function createWindow(startFile) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow();
    return mainWindow;
  }
  const saved = loadWindowState();
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    if (saved.x === undefined || saved.y === undefined) return false;
    const area = display.workArea;
    return (
      saved.x + saved.width > area.x + 60 &&
      saved.x < area.x + area.width - 60 &&
      saved.y + saved.height > area.y + 40 &&
      saved.y < area.y + area.height - 40
    );
  });
  const options = {
    width: saved.width,
    height: saved.height,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171614" : "#efece8",
    title: `${APP_NAME} — Untitled Screenplay`,
    icon: path.join(__dirname, "assets", "icon.png"),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 17 },
    titleBarOverlay:
      process.platform === "darwin"
        ? undefined
        : {
            color: nativeTheme.shouldUseDarkColors ? "#171614" : "#f7f5f1",
            symbolColor: nativeTheme.shouldUseDarkColors ? "#f7f6f4" : "#1b1a19",
            height: 48,
          },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: !backgroundTest,
      webSecurity: true,
    },
  };
  if (visible) {
    options.x = saved.x;
    options.y = saved.y;
  }
  mainWindow = new BrowserWindow(options);
  if (backgroundTest) {
    mainWindow.webContents.print = (options, callback) => callback?.(false, "Printing disabled during background testing.");
  }
  if (saved.maximized && !backgroundTest) mainWindow.maximize();
  if (process.platform !== "darwin") mainWindow.setMenuBarVisibility(false);
  installContextMenu(mainWindow);
  setTitlebarColors();

  mainWindow.once("ready-to-show", () => {
    if (backgroundTest) return;
    mainWindow.show();
    if (saved.maximized) mainWindow.maximize();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (["https:", "http:"].includes(parsed.protocol)) shell.openExternal(url);
    } catch {
      /* ignore */
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (["https:", "http:"].includes(parsed.protocol)) shell.openExternal(url);
      } catch {
        /* ignore */
      }
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    windowReady = true;
    setTitlebarColors();
    if (startFile && !pendingOpen) {
      openFilePath(startFile).catch(() => {});
    } else if (pendingOpen) {
      mainWindow.webContents.send(COMMAND, pendingOpen);
      pendingOpen = null;
    }
  });

  mainWindow.webContents.on("render-process-gone", async (event, details) => {
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    if (backgroundTest) {
      process.stderr.write(`[background-test] Renderer ended: ${details.reason || "unknown"}; keeping recovery and failing the run.\n`);
      app.exit(1);
      return;
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "The editor stopped responding",
      message: "Azkript's renderer process ended unexpectedly.",
      detail: `Reason: ${details.reason || "unknown"}. A recovery copy is kept in your app data folder.`,
      buttons: ["Reload Editor", "Close"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  mainWindow.on("resize", saveWindowStateSoon);
  mainWindow.on("move", saveWindowStateSoon);
  mainWindow.on("maximize", saveWindowStateSoon);
  mainWindow.on("unmaximize", saveWindowStateSoon);
  mainWindow.on("close", handleClose);
  mainWindow.on("closed", () => {
    fileWatcher.stop();
    mainWindow = null;
    windowReady = false;
  });

  const query = {};
  await mainWindow.loadFile(path.join(__dirname, "..", "app", "index.html"), { query });
  return mainWindow;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle("app:get-info", () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    packaged: app.isPackaged,
    userData: userDataRoot,
    interfaceScale: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getZoomFactor() : 1,
  }));

  ipcMain.handle("app:set-interface-scale", (event, scale) => {
    if (![1, 1.25, 1.5, 2].includes(scale)) throw new Error("Choose a supported interface scale.");
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No window is available.");
    const contents = mainWindow.webContents;
    if (contents.getZoomFactor() !== scale) contents.setZoomFactor(scale);
    return contents.getZoomFactor();
  });

  ipcMain.handle("dialog:open-file", () => openDocumentDialog());

  ipcMain.handle("file:read", async (event, filePath) => {
    if (typeof filePath !== "string" || !filePath) throw new Error("A file path is required.");
    return readDocumentFile(filePath);
  });

  ipcMain.handle("file:save", (event, payload) => saveDocument(payload || {}));

  ipcMain.handle("file:identity", async (event, filePath) => {
    if (typeof filePath !== "string" || !filePath) throw new Error("A file path is required.");
    return readFileVersion(filePath);
  });

  ipcMain.handle("file:watch", async (event, payload = {}) => {
    if (typeof payload.path !== "string" || !payload.path) throw new Error("A file path is required.");
    return fileWatcher.start(payload.path, payload.identity);
  });

  ipcMain.handle("file:unwatch", () => { fileWatcher.stop(); return true; });

  ipcMain.handle("backups:list", (event, query = {}) => historyStore().list(query));
  ipcMain.handle("backups:read", (event, id) => historyStore().read(id));
  ipcMain.handle("backups:create", (event, payload = {}) => historyStore().create({
    documentId: payload.documentId, filePath: payload.filePath,
    title: payload.title, document: payload.document, label: payload.label,
  }));

  ipcMain.handle("document:export-pdf", (event, payload) => exportPdf(payload || {}));

  ipcMain.handle("document:print", async (event, payload = {}) => {
    mainWindow.__pageSize = payload.pageSize || { width: 8.5, height: 11 };
    return printDocument();
  });

  ipcMain.handle("file:reveal", (event, filePath) => {
    if (typeof filePath === "string" && filePath) {
      shell.showItemInFolder(path.resolve(filePath));
      return true;
    }
    return false;
  });

  ipcMain.handle("external:open", (event, url) => {
    try {
      const parsed = new URL(String(url));
      if (["https:", "http:", "mailto:"].includes(parsed.protocol)) {
        shell.openExternal(parsed.href);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });

  ipcMain.handle("recent:list", () => {
    recent = recent.filter((item) => fs.existsSync(item.path));
    return recent.slice();
  });

  ipcMain.handle("recent:clear", () => {
    clearRecent();
    return [];
  });

  ipcMain.handle("recent:touch", async (event, payload = {}) => {
    if (!payload || typeof payload.filePath !== "string" || !payload.filePath) return false;
    await rememberRecent(payload.filePath, payload.title || "");
    return true;
  });

  ipcMain.handle("recovery:read", () => readRecovery());

  ipcMain.handle("recovery:write", (event, payload) => queueRecovery(async () => {
    if (!recoveryWritesAllowed) return false;
    if (!payload || !payload.document) return false;
    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      title: payload.title || "Untitled Screenplay",
      filePath: payload.filePath || null,
      identity: typeof payload.identity === "string" && /^[a-f0-9]{64}$/i.test(payload.identity) ? payload.identity : null,
      document: payload.document,
    };
    await writeJsonAtomic(recoveryPath(), data);
    recoveryActive = true;
    return true;
  }));

  ipcMain.handle("recovery:clear", async () => {
    await clearRecovery();
    return true;
  });

  ipcMain.on("desktop:update-state", (event, payload) => {
    setRendererState(payload || {});
  });

  ipcMain.on("desktop:close-confirmed", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    forceClose = true;
    pendingClose = false;
    recoveryWritesAllowed = false;
    await clearRecovery();
    mainWindow.close();
  });

  ipcMain.on("desktop:close-cancelled", () => {
    pendingClose = false;
  });

  ipcMain.on("desktop:print-finished", () => {
    if (!backgroundTest && mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  ipcMain.handle("app:show-in-folder", (event, target) => {
    if (typeof target === "string" && target) {
      shell.showItemInFolder(path.resolve(target));
      return true;
    }
    shell.openPath(userDataRoot).catch(() => {});
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", async (event, argv) => {
    showWindow();
    const target = findOpenPath(argv);
    if (target) await openFilePath(target, true);
  });

  app.on("open-file", async (event, filePath) => {
    event.preventDefault();
    if (!mainWindow) {
      pendingOpen = { command: "open-document", payload: await readDocumentFile(filePath) };
      return;
    }
    await openFilePath(filePath, true);
  });

  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    if (process.platform === "win32") app.setAppUserModelId(APP_ID);
    await migrateLegacyProfile();
    userDataRoot = app.getPath("userData");
    loadRecent();
    nativeTheme.themeSource = "system";
    nativeTheme.on("updated", setTitlebarColors);
    session.defaultSession.setSpellCheckerLanguages?.(["en-US"]);
    registerIpc();
    rebuildMenu();
    const initial = findOpenPath(process.argv);
    await createWindow(initial);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    saveWindowState();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
