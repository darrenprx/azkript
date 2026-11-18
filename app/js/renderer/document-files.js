"use strict";

window.AzkriptRenderer.fileActions = function ({
  desktopActions,
  desktopState,
  createHistory,
  documentSession,
  editorActions,
  editorState,
  featurePanels,
  findActions,
  inputEvents,
  interfaceState,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  ribbonActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
  writingTools,
}) {
  const { $, $$, ACCENT_THEMES, LINE_SPACING_OPTIONS, PAPER_TINTS, blankDocument, browserBackups, clamp, cloneDocument, desktop, els, escapeHtml, formatTime, getScenes, getStats, icon, isDesktop, normalizeScriptFont, templateDocument } = shared;

  let saveTimer = null;
  let pendingDiscard = null;
  let versionBackupError = null;
  let backupTimer = null;
  let lastVersionSnapshot = 0;
  /* Storage keys. Current names are azkript.*; the pre-rename fdstudio.* names
   * are read once so an existing workspace opens with its document and
   * preferences intact, then dropped after the migrated value is written. */
  const DOC_KEY = "azkript.document.v3";
  const LEGACY_DOC_KEY = "azkript.document.v2";
  const PREFS_KEY = "azkript.prefs.v2";
  const LEGACY_PREFS_KEY = "azkript.prefs.v1";
  const RENAMED_DOC_KEYS = ["fdstudio.document.v3", "fdstudio.document.v2"];
  const RENAMED_PREFS_KEYS = ["fdstudio.prefs.v2", "fdstudio.prefs.v1"];
  // storage + history
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  /* Read the first key that parses, in the order given. A value found under a
   * pre-rename fdstudio.* key is reported so the caller can re-save it under
   * the current name and drop the stale copy. */
  function storageGetMigrated(keys) {
    for (const key of keys) {
      const parsed = safeParse(storageGet(key));
      if (parsed) return { value: parsed, key };
    }
    return { value: null, key: null };
  }
  function dropRenamedKeys(keys, keep) {
    for (const key of keys) {
      if (key === keep) continue;
      try {
        localStorage.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    }
  }
  function resetHistory() {
    documentSession.history?.dispose();
    documentSession.history = createHistory({
      initialDocument: documentSession.doc,
      currentDocument: () => documentSession.doc,
      captureSelection: () => FDCoreWriting.captureSelection(els.editor),
      onChange: updateHistoryButtons,
    });
  }
  function updateHistoryButtons() {
    if (els.undoButton) els.undoButton.disabled = !documentSession.history || !documentSession.history.past.length;
    if (els.redoButton) els.redoButton.disabled = !documentSession.history || !documentSession.history.future.length;
    const undoControls = $$('[data-ribbon-command="edit-undo"]');
    const redoControls = $$('[data-ribbon-command="edit-redo"]');
    undoControls.forEach((control) => {
      control.disabled = !documentSession.history || !documentSession.history.past.length;
    });
    redoControls.forEach((control) => {
      control.disabled = !documentSession.history || !documentSession.history.future.length;
    });
  }
  // boot
  async function loadInitial() {
    const storedPrefs = storageGetMigrated([
      PREFS_KEY,
      LEGACY_PREFS_KEY,
      ...RENAMED_PREFS_KEYS,
    ]);
    const prefs = storedPrefs.value || {};
    preferences.theme = prefs.theme || "light";
    preferences.accentColor = ACCENT_THEMES[prefs.accentColor] ? prefs.accentColor : "cobalt";
    preferences.paperTint = PAPER_TINTS[prefs.paperTint] ? prefs.paperTint : "ivory";
    preferences.uiDensity = ["comfortable", "compact", "spacious"].includes(prefs.uiDensity)
      ? prefs.uiDensity
      : "comfortable";
    preferences.ambientGlow = prefs.ambientGlow !== false;
    preferences.reducedMotionPref = Boolean(prefs.reducedMotionPref);
    preferences.lineSpacing = LINE_SPACING_OPTIONS[prefs.lineSpacing] ? prefs.lineSpacing : "normal";
    preferences.smartTypeEnabled = prefs.smartTypeEnabled !== false;
    preferences.autoUppercase = Boolean(prefs.autoUppercase);
    preferences.spellcheck = prefs.spellcheck !== false;
    preferences.highlightActiveLine = prefs.highlightActiveLine !== false;
    preferences.typewriterMode = ["off", "frame", "line"].includes(prefs.typewriterMode)
      ? prefs.typewriterMode
      : prefs.typewriterScroll
        ? "line"
        : "off";
    preferences.typewriterScroll = preferences.typewriterMode !== "off";
    preferences.autosaveDelay = clamp(Number(prefs.autosaveDelay) || 650, 200, 10000);
    preferences.zoom = Number(prefs.zoom) || 1;
    workspaceState.mode = prefs.mode === "page" ? "page" : "write";
    preferences.font = normalizeScriptFont(prefs.font);    preferences.fontSize = Number(prefs.fontSize) || 12;
    preferences.typographyMode = prefs.typographyMode === "workspace" ? "workspace" : "document";
    preferences.uiScale = [1, 1.25, 1.5, 2].includes(Number(prefs.uiScale)) ? Number(prefs.uiScale) : 1;
    workspaceLayout.applyInterfaceScale();
    preferences.showGuides = prefs.showGuides !== false;
    preferences.showInvisibles = Boolean(prefs.showInvisibles);
    preferences.showOutline = prefs.showOutline !== false;
    preferences.showRuler = prefs.showRuler !== false;
    preferences.autosave = prefs.autosave !== false;
    preferences.startCenterOnLaunch = prefs.startCenter !== false;
    preferences.readRate = Number(prefs.readRate) || 1;
    preferences.readVoiceURI = String(prefs.readVoice || "");
    preferences.showOutlineInScript = prefs.showOutlineInScript !== false;
    preferences.showStructureLines = Boolean(prefs.showStructureLines);
    preferences.hideScriptNotes = Boolean(prefs.hideScriptNotes);
    preferences.navigatorVisible = prefs.navigatorVisible !== false;
    preferences.textColor = prefs.textColor || "#171614";
    preferences.highlightColor = prefs.highlightColor || "#ffe9a3";
    preferences.beatConnectionColor = prefs.beatConnectionColor || "#0f6cbd";
    preferences.profile = prefs.profile && typeof prefs.profile === "object" ? prefs.profile : { name: "Local Writer", role: "Writer" };
    preferences.lastBackupAt = Number(prefs.lastBackupAt) || 0;
    /* Load the newest valid document across every spelling. A pre-rename key
     * can hold NEWER work than the current one — the app was renamed while a
     * build was still writing fdstudio.*, so someone who writes in an old build
     * and then opens this one has their latest work in the legacy key. The
     * newest savedAt therefore wins over the read order; booting an old
     * spelling must never quietly discard work. */
    const docSpellings = [DOC_KEY, LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS];
    const docCandidates = docSpellings.map((key) => {
      const value = safeParse(storageGet(key));
      return value && Array.isArray(value.paragraphs)
        ? { key, value, stamp: Date.parse(value.savedAt || value.updatedAt || "") || 0 }
        : null;
    }).filter(Boolean);
    /* Ties keep read order, so the current spelling still wins when equally new. */
    const newest = docCandidates.reduce(
      (best, candidate) => (candidate.stamp > best.stamp ? candidate : best),
      docCandidates[0] || null,
    );
    const stored = newest ? newest.value : null;
    documentSession.open(stored || documentSession.doc, {
      lastSaved: isDesktop ? null : stored?.savedAt || null,
    });
    resetHistory();
    workspaceLayout.applyTheme(preferences.theme, false);
    workspaceLayout.applyStudioAppearance();
    planningViews.populateElementControls();
    inputEvents.bindEvents();
    workspaceLayout.renderAll();
    updateHistoryButtons();
    workspaceLayout.syncPrefsUI();
    workspaceLayout.applyProfile();
    if (!stored) persistWorkspace(false);
    /* Only delete another copy of the document once the current spelling
     * provably holds the winning one: either it already did, or the re-save
     * just reported success. A failed write (quota, private mode) leaves every
     * copy in place rather than destroying the last one. */
    const winnerPersisted =
      Boolean(newest) &&
      (newest.key === DOC_KEY || Boolean(persistWorkspace(false)));
    if (winnerPersisted) {
      dropRenamedKeys([LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS], DOC_KEY);
    }
    /* Same rule for preferences, which carry no timestamp: only prune once the
     * current key actually holds a readable value. */
    const migratedPrefs = Boolean(storedPrefs.key && storedPrefs.key !== PREFS_KEY);
    if (migratedPrefs) persistPrefs();
    if (safeParse(storageGet(PREFS_KEY))) {
      dropRenamedKeys([LEGACY_PREFS_KEY, ...RENAMED_PREFS_KEYS], PREFS_KEY);
    }
    requestAnimationFrame(() => {
      els.appShell.classList.remove("is-loading");
      workspaceLayout.fitPaper();
      if (workspaceState.mode === "page") workspaceLayout.setMode("page");
      else pageActions.renderPagePreview();
    });
    if (!isDesktop && !stored) {
      setTimeout(
        () =>
          modalActions.toast(
            "Welcome to Azkript",
            "The sample screenplay is loaded. Start typing or open an FDX file.",
            "info",
          ),
        700,
      );
    }
    featurePanels.initialize();
    if (isDesktop) desktopActions.initDesktop();
  }
  function persistPrefs() {
    storageSet(
      PREFS_KEY,
      JSON.stringify({
        theme: preferences.theme,
        accentColor: preferences.accentColor,
        paperTint: preferences.paperTint,
        uiDensity: preferences.uiDensity,
        ambientGlow: preferences.ambientGlow,
        reducedMotionPref: preferences.reducedMotionPref,
        lineSpacing: preferences.lineSpacing,
        smartTypeEnabled: preferences.smartTypeEnabled,
        autoUppercase: preferences.autoUppercase,
        spellcheck: preferences.spellcheck,
        highlightActiveLine: preferences.highlightActiveLine,
        typewriterScroll: preferences.typewriterScroll,
        typewriterMode: preferences.typewriterMode,
        autosaveDelay: preferences.autosaveDelay,
        zoom: preferences.zoom,
        mode: workspaceState.mode,
        font: preferences.font,
        fontSize: preferences.fontSize,
        showGuides: preferences.showGuides,
        showInvisibles: preferences.showInvisibles,
        showOutline: preferences.showOutline,
        showRuler: preferences.showRuler,
        autosave: preferences.autosave,
        startCenter: preferences.startCenterOnLaunch,
        readRate: preferences.readRate,
        readVoice: preferences.readVoiceURI,
        showOutlineInScript: preferences.showOutlineInScript,
        showStructureLines: preferences.showStructureLines,
        hideScriptNotes: preferences.hideScriptNotes,
        navigatorVisible: preferences.navigatorVisible,
        textColor: preferences.textColor,
        highlightColor: preferences.highlightColor,
        beatConnectionColor: preferences.beatConnectionColor,
        profile: preferences.profile,
        lastBackupAt: preferences.lastBackupAt,
        typographyMode: preferences.typographyMode,
        uiScale: preferences.uiScale,
      }),
    );
  }
  function persistWorkspace(withRecovery = true) {
    if (withRecovery) scheduleVersionSnapshot();
    documentSession.doc.updatedAt = new Date().toISOString();
    const savedAt = new Date().toISOString();
    const saved = { ...documentSession.doc, savedAt };
    /* Report the write so callers can refuse to delete any other copy of the
     * document when this one did not land (quota, private mode, disabled
     * storage). The old contract silently swallowed the failure. */
    const written = storageSet(DOC_KEY, JSON.stringify(saved));
    if (withRecovery && isDesktop && preferences.autosave) {
      const version = documentSession.editVersion;
      desktop
        .writeRecovery({
          title: documentSession.doc.title,
          filePath: documentSession.filePath,
          identity: documentSession.fileIdentity,
          document: documentSession.doc,
        })
        .then((written) => {
          if (version !== documentSession.editVersion || !documentSession.dirty) return;
          if (!written) throw new Error("Recovery storage is unavailable.");
          documentSession.recoveryWrittenAt = Date.now();
          documentSession.recoveryVersion = version;
          documentSession.recoveryFailed = false;
          updateSaveState();
        })
        .catch(() => {
          if (version !== documentSession.editVersion || !documentSession.dirty) return;
          documentSession.recoveryFailed = true;
          updateSaveState();
        });
    }
    return written ? savedAt : null;
  }
  function scheduleBackup() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!preferences.autosave) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!documentSession.dirty) return;
      const writtenAt = persistWorkspace();
      if (!isDesktop) {
        if (writtenAt) {
          documentSession.savedSnapshot = cloneDocument(documentSession.doc);
          documentSession.dirty = false;
          documentSession.lastSaved = Date.now();
          documentSession.saveFailed = false;
          documentSession.saveFailureNotified = false;
        } else {
          // The write did not land (quota, private window, storage disabled).
          // Report it instead of pretending, and keep the document dirty so the
          // unsaved-changes state stays truthful.
          reportSaveFailure();
        }
        updateSaveState();
        workspaceLayout.renderMeta();
      }
    }, clamp(Number(preferences.autosaveDelay) || 650, 200, 10000));
  }
  /* Tell the writer, once per failure streak, that the local copy did not save.
   * Autosave retries on the next edit, so repeating the toast every 650 ms would
   * bury the message under itself; the status chip carries the alarm for as long
   * as the condition lasts. */
  function reportSaveFailure() {
    documentSession.saveFailed = true;
    if (documentSession.saveFailureNotified) return;
    documentSession.saveFailureNotified = true;
    modalActions.toast(      "Not saved",      isDesktop        ? "Your draft could not be written to disk. Check that the folder is writable, then save again."
        : "This browser blocked the local save — storage may be full or disabled, or you are in a private window. Export an FDX copy to keep your work.",      "error",      9000,    );
  }
  function saveLocal(silent = false) {
    if (isDesktop) return saveDocument({ silent });
    clearTimeout(saveTimer);
    saveTimer = null;
    const writtenAt = persistWorkspace();
    if (!writtenAt) {
      /* Do NOT touch savedSnapshot/dirty/lastSaved on failure: clearing them is       * what made the status chip read "Saved" while the text was gone on the       * next load. The in-memory document is untouched, so the writer can still       * export FDX or retry once storage frees up. */
      reportSaveFailure();
      updateSaveState();
      workspaceLayout.renderMeta();
      if (!silent) {
        modalActions.toast(          "Save failed",          isDesktop            ? "Your draft could not be written to disk."
            : "The browser refused to store this draft. Export an FDX copy so the work is not lost.",          "error",          9000,        );
      }
      return Promise.resolve(false);
    }
    documentSession.saveFailed = false;
    documentSession.saveFailureNotified = false;
    documentSession.savedSnapshot = cloneDocument(documentSession.doc);
    documentSession.dirty = false;
    documentSession.lastSaved = Date.now();
    updateSaveState();
    workspaceLayout.renderMeta();
    persistPrefs();
    if (!silent) {
      modalActions.toast(
        "Saved locally",
        "Your screenplay is stored in this browser. Export FDX for a portable copy.",
        "success",
      );
    }
    return Promise.resolve(true);
  }
  function markDirty(options = {}) {
    const firstUnsavedEdit = !documentSession.dirty;
    documentSession.noteEdit();
    if (options.layout !== false) pageActions.invalidateLayout();
    updateSaveState();
    desktopActions.syncDesktopState(firstUnsavedEdit);
    scheduleBackup();
    /* Keep the sprint's word counter live while a sprint is running; the
     * interval alone only refreshed it once a second. */
    if (interfaceState.sprint.running) writingTools.updateSprintUI();
  }
  function updateSaveState() {
    /* A failed write outranks every other state: telling the writer "Saved"
     * after a rejected write is the bug this guard exists to prevent. */    els.saveState.classList.toggle("is-error", Boolean(documentSession.saveFailed));
    els.saveState.classList.toggle("is-dirty", documentSession.dirty && !documentSession.saveFailed);
    els.saveState.classList.toggle("is-saved", !documentSession.dirty && !documentSession.saveFailed);
    els.saveState.classList.toggle("is-busy", documentSession.saving);
    if (documentSession.saveFailed) {      els.saveStateText.textContent = "Not saved";    } else if (documentSession.saving) {
      els.saveStateText.textContent = "Saving…";
    } else if (documentSession.dirty) {
      if (isDesktop) {
        els.saveStateText.textContent = documentSession.recoveryVersion === documentSession.editVersion ? "Edited · recoverable" : "Unsaved";
      } else {
        els.saveStateText.textContent = preferences.autosave ? "Saving…" : "Unsaved";
      }
    } else if (documentSession.lastSaved) {
      els.saveStateText.textContent = `Saved ${formatTime(documentSession.lastSaved)}`;
    } else if (isDesktop) {
      els.saveStateText.textContent = documentSession.filePath ? "Saved" : "New draft";
    } else {
      els.saveStateText.textContent = "Saved locally";
    }
    if (els.statusRecovery) {
      els.statusRecovery.textContent = documentSession.saveFailed ? "Storage blocked" : documentSession.recoveryFailed ? "Recovery failed" : isDesktop
          ? preferences.autosave
            ? documentSession.recoveryWrittenAt
              ? `Recovery ${formatTime(documentSession.recoveryWrittenAt)}`
              : "Recovery on"
            : "Recovery off"
          : "Local draft";
    }
    document.body.classList.toggle("is-dirty", documentSession.dirty);
  }
  async function confirmDiscard(message) {
    if (documentSession.saving) {
      modalActions.toast("Save in progress", "Wait for the current save to finish before changing documents.", "info");
      return false;
    }
    if (!documentSession.dirty) return true;
    if (pendingDiscard) return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        pendingDiscard = null;
        resolve(value);
      };
      pendingDiscard = finish;
      const onClose = () => {
        els.dialog.removeEventListener("close", onClose);
        if (!settled) finish(false);
      };
      els.dialog.addEventListener("close", onClose);
      modalActions.openDialog({
        eyebrow: "Unsaved changes",
        title: "Leave this draft behind?",
        body: `<p>${escapeHtml(message || "This draft has changes that are not saved to a file.")}</p><div class="dialog-note">Export or save the screenplay first if you want to keep this version.</div>`,
        actions: [
          {
            label: "Keep editing",
            onClick: () => {
              finish(false);
              pendingDiscard = null;
            },
          },
          {
            label: "Discard changes",
            kind: "danger",
            onClick: () => finish(true),
          },
        ],
      });
    });
  }
  async function saveTextFile(contents, filename, mime = "text/plain;charset=utf-8") {
    if (isDesktop) {
      try {
        const result = await desktop.saveFile({
          saveAs: true,
          contents,
          exportFormat: filename.split(".").at(-1),
          protectedSourcePath: documentSession.filePath,
          defaultName: filename.replace(/\.[^.]+$/, ""),
        });
        if (result?.copyRequired) {
          modalActions.toast("Choose a separate copy", "Select a different filename to keep the open screenplay intact.", "warning");
        } else if (result?.conflict) {
          modalActions.toast("Export destination changed", "Choose another filename or review the destination before retrying.", "warning");
        } else if (result && !result.canceled) {
          modalActions.toast("File saved", `${result.name} written to disk.`, "success");
          return true;
        }
      } catch (error) {
        modalActions.toast("Export failed", error.message, "error");
      }
      return false;
    }
    FDX.download(filename, contents, mime);
    modalActions.toast("File exported", `${filename} downloaded.`, "success");
    return true;
  }
  /* ---------- file lifecycle ---------------------------------------- */
  function closeDocument() {
    if (documentSession.saving) {
      modalActions.toast("Save in progress", "Wait for the current save to finish before closing.", "info");
      return;
    }
    const finish = () => {
      desktopActions.showStartCenter();
      ribbonActions.ribbonToast("Document closed", "The Start Center is ready for the next draft.", "info", 2400);
    };
    if (!documentSession.dirty) {
      finish();
      return;
    }
    modalActions.openDialog({
      eyebrow: "File · Close",
      title: "Close this document?",
      body: `<p class="dialog-note">“${escapeHtml(documentSession.doc.title || "Untitled Screenplay")}” has unsaved changes. Save before closing, or discard them.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Discard",
          kind: "danger",
          onClick: () => {
            modalActions.closeDialog();
            if (documentSession.savedSnapshot) restoreSavedSnapshot();
            else loadDocument(blankDocument(), { clearRecovery: true });
            finish();
          },
        },
        {
          label: "Save & Close",
          kind: "primary",
          onClick: async () => {
            const saved = await saveDocument();
            if (!saved || documentSession.dirty) return;
            modalActions.closeDialog();
            finish();
          },
        },
      ],
    });
  }
  async function saveAsTemplate() {
    try {
      const xml = FDX.serialize(documentSession.doc, { template: true });
      const filename = ribbonActions.ribbonFileName("fdxt");
      await saveTextFile(xml, filename, "application/xml;charset=utf-8");
    } catch (error) {
      modalActions.toast("Template export failed", error.message || String(error), "error");
    }
  }
  async function exportBeatBoard() {
    const beats = documentSession.doc.beats || [];
    if (!beats.length) {
      modalActions.toast("No beats to export", "Add story beats on the Beat Board first.", "info", 2400);
      return;
    }
    const lines = [
      `BEAT BOARD — ${documentSession.doc.title || "Untitled Screenplay"}`,
      documentSession.doc.author ? `By ${documentSession.doc.author}` : "",
      "",
      ...beats.map((beat, index) => {
        const target = beats.find((entry) => entry.id === beat.targetId);
        return [
          `${String(index + 1).padStart(2, "0")}. [${beat.category || "Beat"}] ${beat.title || "Untitled beat"}`,
          beat.body ? `    ${beat.body}` : "",
          target ? `    → connects to: ${target.title}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ].filter(Boolean);
    await saveTextFile(lines.join("\n"), ribbonActions.ribbonFileName("beatboard.txt"));
  }
  function revertDocument() {
    if (documentSession.saving) {
      modalActions.toast("Save in progress", "Wait for the current save to finish before reverting.", "info");
      return;
    }
    if (!documentSession.savedSnapshot) {
      modalActions.toast("Nothing to revert to", "Save the screenplay first, then Revert can restore that version.", "info", 2800);
      return;
    }
    modalActions.confirmAction(
      "Revert to the last saved version?",
      "Current unsaved edits will be replaced by the last saved snapshot.",
      "Revert",
      () => {
        restoreSavedSnapshot();
        ribbonActions.ribbonToast("Document reverted", "The last saved version is back in the editor.", "success");
      },
    );
  }
  function restoreSavedSnapshot() {
    clearTimeout(saveTimer);
    clearTimeout(backupTimer);
    saveTimer = backupTimer = null;
    documentSession.replaceContent(documentSession.savedSnapshot);
    planningViews.populateElementControls();
    resetHistory();
    pageActions.resetDocumentLayout({ preservePage: true });
    findActions.resetDocumentSearch();
    speechActions.resetDocumentSpeech();
    documentSession.dirty = false;
    documentSession.resetRecoveryStatus();
    const writtenAt = persistWorkspace(false);
    if (isDesktop) desktop.clearRecovery({ currentOnly: true }).catch(() => {});
    else if (!writtenAt) {
      documentSession.dirty = true;
      reportSaveFailure();
    }
    desktopActions.syncDesktopState(true);
    workspaceLayout.renderAll();
    updateHistoryButtons();
  }
  function backupVaultDialog() {
    const last = preferences.lastBackupAt ? new Date(preferences.lastBackupAt).toLocaleString() : "No backups yet";
    modalActions.openDialog({
      eyebrow: "File · Backup",
      title: "Backup Vault",
      body: `
        <div class="setting-line"><div><strong>Create a portable backup</strong><span>Writes a complete FDX copy that can be archived or opened on another machine.</span></div><button type="button" class="pill-btn" id="backupNowButton" style="margin-left:auto">${icon("backup")}Create backup</button></div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Last backup</span><strong>${escapeHtml(last)}</strong></div>
          <div class="shortcut-row"><span>Recovery</span><strong>${isDesktop ? "Automatic (native recovery)" : "Automatic (local autosave)"}</strong></div>
          <div class="shortcut-row"><span>Format</span><strong>FDX v6 (screenplay interchange)</strong></div>        </div>
        <p class="dialog-note">Backups are never overwritten automatically. Keep them next to your draft or in a synced folder.</p>`,
      actions: [
        ...(isDesktop ? [{ label: "Earlier recovery copies", onClick: () => openVersionHistory(true) }] : []),
        { label: "Done", kind: "primary" },
      ],
    });
    const button = $("#backupNowButton", els.dialogBody);
    if (button) {
      button.addEventListener("click", async () => {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
        const xml = FDX.serialize(documentSession.doc);
        if (!(await saveTextFile(xml, ribbonActions.ribbonFileName(`backup-${stamp}.fdx`), "application/xml;charset=utf-8"))) return;
        preferences.lastBackupAt = Date.now();
        persistPrefs();
        button.textContent = "Backup created";
        button.disabled = true;
      });
    }
  }
  function openWgaDialog() {
    const doc = documentSession.doc;
    const summary = [
      `WGA REGISTRATION SUMMARY`,
      `Title: ${doc.title || "Untitled Screenplay"}`,
      `Author: ${doc.author || ""}`,
      `Draft date: ${doc.titlePage && doc.titlePage.draftDate ? doc.titlePage.draftDate : new Date().toLocaleDateString()}`,
      `Pages: ${pageActions.pageCount()}`,
      `Scenes: ${getScenes(doc).length}`,
      `Words: ${getStats(doc).words}`,
    ].join("\n");
    modalActions.openDialog({
      eyebrow: "File · Register",
      title: "WGA Registration",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Title</span><strong>${escapeHtml(doc.title || "Untitled Screenplay")}</strong></div>
          <div class="shortcut-row"><span>Author</span><strong>${escapeHtml(doc.author || "Not set")}</strong></div>
          <div class="shortcut-row"><span>Pages / Scenes</span><strong>${pageActions.pageCount()} pages · ${getScenes(doc).length} scenes</strong></div>
        </div>
        <p class="dialog-note">Registration is completed with the Writers Guild of America. Copy this summary into the WGA registration form; registration numbers are issued by the WGA, not by Azkript.</p>`,
      actions: [
        { label: "Close" },
        {
          label: "Copy summary",
          kind: "primary",
          onClick: () => {
            writingTools.copyText(summary, "Registration summary copied", "Paste it into the WGA registration form.");
          },
        },
      ],
    });
  }
  // file operations
  async function newDocument(kind = null, fromStart = false) {
    if (!(await confirmDiscard("Starting a new screenplay will replace the current edits."))) return;
    const doc = kind ? templateDocument(kind) : blankDocument();
    if (!loadDocument(doc, { clearRecovery: true, focus: "end" })) return;
    modalActions.toast(
      kind ? "Template ready" : "New screenplay",
      kind ? "A fresh document is waiting for its first line." : "A clean page is ready. Start with a scene heading.",
      "success",
    );
    if (fromStart) desktopActions.hideStartCenter();
  }
  async function openFilePicker() {
    if (isDesktop) {
      const generation = documentSession.generation;
      try {
        const file = await desktop.openFile();
        if (generation === documentSession.generation && file) await handleOpenDocument(file);
      } catch (error) {
        modalActions.toast("Open failed", error.message || "Could not read that file.", "error");
      }
    } else {
      els.fileInput.value = "";
      els.fileInput.click();
    }
  }
  async function handleFilePayload(payload) {
    if (!payload || typeof payload.contents !== "string") return false;
    try {
      const parsed = FDX.parse(payload.contents);
      if (parsed.title === "Imported Screenplay" && payload.name) {
        parsed.title = payload.name.replace(/\.(fdx|fdxt|xml)$/i, "");
      }
      const warnings = parsed.warnings || [];
      const fromTemplate = Boolean(parsed.meta && parsed.meta.template) || /\.fdxt$/i.test(payload.name || payload.path || "");
      if (!loadDocument(parsed, {
        path: fromTemplate ? null : payload.path || null,
        name: fromTemplate ? null : payload.name || null,
        dirty: fromTemplate,
        lastSaved: fromTemplate ? null : payload.mtimeMs || Date.now(),
        clearRecovery: true,
        identity: fromTemplate ? null : payload.identity || null,
      })) return false;
      if (fromTemplate) markDirty();
      if (isDesktop && payload.path) desktop.touchRecent(payload.path, documentSession.doc.title).catch(() => {});
      if (fromTemplate) {
        modalActions.toast("Template ready", "A new screenplay was created. Save to choose its filename and location.", "success");
        if (warnings.length) modalActions.toast("Imported with notes", warnings.join(" "), "warning", 6500);
      } else if (warnings.length) {
        modalActions.toast("Imported with notes", warnings.join(" "), "warning", 6500);
      } else {
        modalActions.toast(
          "FDX imported",
          `${documentSession.doc.paragraphs.length} blocks loaded${payload.name ? ` from ${payload.name}` : ""}.`,
          "success",
        );
      }
      return true;
    } catch (error) {
      modalActions.openDialog({
        eyebrow: "Import failed",
        title: "That file could not be read",
        body: `<p>${escapeHtml(error.message || "Unknown FDX error.")}</p><div class="dialog-note">Only FDX/FDXT XML files are supported. Your current draft was not changed.</div>`,
        actions: [{ label: "Close", kind: "primary" }],
      });
      return false;
    }
  }
  async function onFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const generation = documentSession.generation;
    try {
      const text = await readBrowserFdx(file);
      if (generation === documentSession.generation) await handleOpenDocument({ contents: text, name: file.name });
    } catch (error) {
      modalActions.toast("Import failed", error.message || "Could not read that file.", "error");
    }
  }
  async function readBrowserFdx(file) {
    if (file.size > 64 * 1024 * 1024) throw new Error("The document is larger than the 64 MB limit.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  }
  async function handleOpenDocument(payload) {
    if (!payload) return false;
    const generation = documentSession.generation;
    if (!(await confirmDiscard("Opening this screenplay will replace the current edits.")) || generation !== documentSession.generation) return false;
    return handleFilePayload(payload);
  }
  function loadDocument(doc, meta = {}) {
    if (documentSession.saving) {
      modalActions.toast("Save in progress", "Wait for the current save to finish before changing documents.", "info");
      return false;
    }
    featurePanels.workspaceUI?.beforeLoad();
    clearTimeout(backupTimer);
    clearTimeout(saveTimer);
    backupTimer = saveTimer = null;
    lastVersionSnapshot = 0;
    pageActions.resetDocumentLayout();
    findActions.resetDocumentSearch();
    speechActions.resetDocumentSpeech();
    editorActions.resetDocumentInput();
    ribbonActions.clearDocumentSelection();
    planningViews.resetDocumentNavigation();
    documentSession.open(doc, meta);
    resetHistory();
    planningViews.populateElementControls();
    renderExternalChangeBanner();
    if (desktop?.watchFile && documentSession.filePath) {
      desktop.watchFile({ path: documentSession.filePath, identity: documentSession.fileIdentity }).catch(() => {});
    } else if (desktop?.unwatchFile) {
      desktop.unwatchFile().catch(() => {});
    }
    // Loading a file must replace the browser draft even if no edit follows.
    if (meta.persist !== false && !persistWorkspace(false) && !isDesktop) {
      documentSession.dirty = true;
      reportSaveFailure();
    }
    workspaceLayout.renderAll();
    updateHistoryButtons();
    workspaceLayout.setView("script");
    workspaceLayout.setMode("write");
    desktopActions.hideStartCenter();
    desktopState.suppressStartCenter = true;
    if (meta.clearRecovery && isDesktop) desktop.clearRecovery({ currentOnly: true }).catch(() => {});
    desktopActions.syncDesktopState(true);
    const generation = documentSession.generation;
    requestAnimationFrame(() => {
      if (generation !== documentSession.generation) return;
      const first = documentSession.doc.paragraphs[0];
      if (first) editorActions.focusParagraph(first.id, meta.focus || "start");
      featurePanels.workspaceUI?.afterLoad();
    });
    return true;
  }

  function applyDocumentEdit(next, { layout = true, render = true } = {}) {
    documentSession.history.finishBurst();
    documentSession.replaceContent(next);
    markDirty({ layout });
    documentSession.history.record();
    if (render) {
      planningViews.populateElementControls();
      workspaceLayout.renderAll();
    }
  }

  async function saveDocument({ silent = false, saveAs = false, forClose = false } = {}) {
    if (!isDesktop) {
      if (forClose) return saveLocal(silent);
      return saveLocal(silent);
    }
    if (documentSession.saving) {
      if (forClose) desktop.cancelClose();
      return false;
    }
    documentSession.saving = true;
    updateSaveState();
    const generation = documentSession.generation;
    const version = documentSession.editVersion;
    const savedDoc = cloneDocument(documentSession.doc);
    try {
      const protectedSourcePath = !documentSession.hasSafetyCopy && savedDoc.sourceFDX && documentSession.filePath && FDX.compatibility(savedDoc).recommendSaveCopy ? documentSession.filePath : null;
      const contents = FDX.serialize(savedDoc);
      const result = await desktop.saveFile({
        path: saveAs || protectedSourcePath ? null : documentSession.filePath,
        saveAs: saveAs || Boolean(protectedSourcePath),
        protectedSourcePath,
        contents,
        defaultName: `${documentSession.doc.title || "screenplay"}${protectedSourcePath ? " copy" : ""}`,
        documentId: savedDoc.documentId,
        ...(documentSession.filePath ? { expectedPath: documentSession.filePath, expectedIdentity: documentSession.fileIdentity ?? null } : {}),
      });
      if (generation !== documentSession.generation) {
        if (forClose) desktop.cancelClose();
        return false;
      }
      if (result?.copyRequired) {
        if (forClose) desktop.cancelClose();
        modalActions.toast("Choose a separate copy", "This edit may affect retained production references. The original file was not overwritten.", "warning", 7000);
        openCompatibilityInspector(); return false;
      }
      if (result && result.conflict) {
        if (forClose) desktop.cancelClose();
        if (desktopActions.sameDesktopPath(result.path, documentSession.filePath)) {
          documentSession.externalChange = result;
          renderExternalChangeBanner();
          modalActions.toast("The file changed on disk", "Compare or reload the disk version, or save your draft as a separate copy.", "warning", 7000);
          openFileStatus();
        } else {
          modalActions.toast("Save destination changed", "Choose another filename or review the destination before retrying.", "warning", 7000);
        }
        return false;
      }
      if (!result || result.canceled) {
        if (forClose) desktop.cancelClose();
        return false;
      }
      documentSession.filePath = result.path;
      if (protectedSourcePath) documentSession.hasSafetyCopy = true;
      documentSession.fileName = result.name;
      documentSession.fileIdentity = result.identity || documentSession.fileIdentity;
      documentSession.externalChange = null;
      renderExternalChangeBanner();
      if (desktop.watchFile && documentSession.fileIdentity) desktop.watchFile({ path: result.path, identity: documentSession.fileIdentity }).catch(() => {});
      documentSession.recordSaved(savedDoc, version);
      if (!documentSession.dirty) {
        clearTimeout(saveTimer);
        saveTimer = null;
        documentSession.recoveryWrittenAt = null;
        documentSession.recoveryVersion = null;
        documentSession.recoveryFailed = false;
        await desktop.clearRecovery({ currentOnly: true }).catch(() => {});
      }
      // A write saves its captured version. Keep newer edits in recovery,
      // including edits made while recovery cleanup was awaiting IPC.
      persistWorkspace(documentSession.dirty);
      desktop.touchRecent(result.path, documentSession.doc.title).catch(() => {});
      updateSaveState();
      workspaceLayout.renderMeta();
      desktopActions.syncDesktopState(true);
      if (!silent) {
        modalActions.toast(
          "Screenplay saved",
          `${result.name} written to disk${documentSession.dirty ? " (newer edits are still unsaved)" : ""}.`,
          "success",
        );
      }
      if (forClose) {
        if (documentSession.dirty) {
          desktop.cancelClose();
          modalActions.toast("Newer edits are unsaved", "Save again before closing to keep the edits made during this save.", "info");
        } else desktop.confirmClose();
      }
      return true;
    } catch (error) {
      if (forClose) desktop.cancelClose();
      modalActions.toast("Save failed", error.message || "Could not write the screenplay.", "error", 5200);
      return false;
    } finally {
      documentSession.saving = false;
      updateSaveState();
    }
  }
  async function exportFDX() {
    try {
      const xml = FDX.serialize(documentSession.doc);
      await saveTextFile(xml, ribbonActions.ribbonFileName("fdx"), "application/xml;charset=utf-8");
    } catch (error) {
      modalActions.toast("Export failed", error.message || "Could not serialize the document.", "error");
    }
  }
  function undo() {
    const entry = documentSession.history?.undo();
    if (!entry) {
      modalActions.toast("Nothing to undo", "The history is at its beginning.", "info", 1800);
      return;
    }
    documentSession.replaceContent(entry.document);
    editorState.pendingSelection = entry.selection;
    planningViews.populateElementControls();
    markDirty();
    workspaceLayout.renderAll();
    updateHistoryButtons();
  }
  /* File safety tools share the same document model as the editor. */
  function scheduleVersionSnapshot() {
    if (Date.now() - lastVersionSnapshot < 30000 || backupTimer) return;
    backupTimer = setTimeout(() => {
      backupTimer = null;
      saveVersionSnapshot("Automatic snapshot", true);
    }, 2000);
  }
  async function saveVersionSnapshot(label = "Snapshot", silent = false) {
    const live = documentSession.doc;
    const document = cloneDocument(documentSession.doc);
    try {
      const result = desktop?.createBackup
        ? await desktop.createBackup({ documentId: document.documentId, filePath: documentSession.filePath, title: document.title, document, label: label === "Automatic snapshot" ? "" : label })
        : await browserBackups.create(document, { label, filePath: documentSession.filePath });
      if (live === documentSession.doc) lastVersionSnapshot = Date.now();
      versionBackupError = null;
      if (!silent) modalActions.toast("Version saved", "This version is available in Version history.", "success");
      return result;
    } catch (error) {
      if (!silent || !versionBackupError) modalActions.toast("Version was not saved", error.message || "Version history storage is unavailable.", "error");
      versionBackupError = error.message;
      return null;
    }
  }
  function diffMarkup(before, after) {
    const diff = FDWritingTools.compareDocuments(before, after);
    const counts = Object.entries(diff.counts).map(([name, count]) => `${count} ${name}`).join(" · ");
    return `<p>${escapeHtml(counts)}</p>${diff.metadataChanged.length ? `<p>Document settings changed: ${escapeHtml(diff.metadataChanged.join(", "))}</p>` : ""}
      <div class="text-diff">${diff.rows.map(row => `<details><summary>${escapeHtml(row.kind)} · ${escapeHtml(row.type)}</summary>
        <div><pre aria-label="Earlier text">${escapeHtml(row.before.slice(0, 2500))}</pre><pre aria-label="Current text">${escapeHtml(row.after.slice(0, 2500))}</pre></div></details>`).join("") || "<p>No paragraph changes.</p>"}</div>
      ${diff.truncated ? '<p>Showing the first 200 differences.</p>' : ''}`;
  }
  async function openVersionHistory(recoveryArchive = false) {
    recoveryArchive = recoveryArchive === true;
    const documentId = FDWritingTools.backupKey(documentSession.doc);
    const current = documentSession.doc;
    try {
      const versions = desktop?.listBackups
        ? await desktop.listBackups(recoveryArchive ? { recoveryArchive: true } : { documentId, filePath: documentSession.filePath })
        : await browserBackups.list(documentId);
      if (current !== documentSession.doc) return;
      modalActions.openDialog({ eyebrow: "Document safety", title: recoveryArchive ? "Earlier recovery copies" : "Version history", wide: true,
        body: `${recoveryArchive ? "<p>Open a recovery copy as a separate draft.</p>" : `<p>Compare a version before restoring it. Restoring keeps a snapshot of your current draft.</p>
          <label class="field">Snapshot name<input id="snapshotLabel" class="input" maxlength="100" placeholder="Before the next revision"></label>`}
          <div class="history-versions">${versions.map(version => `<button type="button" class="history-version" data-version="${escapeHtml(version.id)}">
            <strong>${escapeHtml((recoveryArchive ? version.title : version.label || version.title) || "Saved version")}</strong>
            <span>${escapeHtml(new Date(version.createdAt || version.savedAt || Date.now()).toLocaleString())}</span></button>`).join("") || (recoveryArchive ? "<p>No earlier recovery copies.</p>" : "<p>No earlier versions yet. Save a named snapshot to begin.</p>")}</div>`,
        actions: [...(recoveryArchive ? [] : [{ label: "Save snapshot", keepOpen: true, onClick: async () => {
          const label = $("#snapshotLabel")?.value.trim() || "Named snapshot";
          if (await saveVersionSnapshot(label)) openVersionHistory();
        } }]), { label: "Close", kind: "primary" }],
      });
      const historyGeneration = modalActions.getDialogGeneration();
      $$('[data-version]', els.dialogBody).forEach(button => button.addEventListener("click", async () => {
        try {
          const backup = desktop?.readBackup ? await desktop.readBackup(button.dataset.version) : await browserBackups.read(button.dataset.version);
          if (current !== documentSession.doc || historyGeneration !== modalActions.getDialogGeneration() || !els.dialog.open) return;
          if (!backup) throw new Error("That version is no longer available.");
          const older = backup.document || FDX.parse(backup.contents);
          if (recoveryArchive) {
            if (!(await confirmDiscard("Opening this recovered draft will replace the current edits."))) return;
            if (!loadDocument(older, { dirty: true, clearRecovery: true, savedSnapshot: null })) return;
            markDirty();
            modalActions.closeDialog();
            modalActions.toast("Draft recovered", "Save this copy to choose its filename and location.", "success");
            return;
          }
          modalActions.openDialog({ eyebrow: "Compare version", title: backup.label || "Earlier version", wide: true,
            body: diffMarkup(older, documentSession.doc), actions: [
              { label: "Back", onClick: openVersionHistory },
              { label: "Restore this version", kind: "danger", keepOpen: true, onClick: async () => {
                if (documentSession.saving) { modalActions.toast("Save in progress", "Wait for the current save before restoring."); return; }
                const live = documentSession.doc;
                const liveVersion = documentSession.editVersion;
                const lastSavedDocument = documentSession.savedSnapshot;
                if (!(await saveVersionSnapshot("Before restoring a version", true))) {
                  modalActions.toast("Restore cancelled", "The current draft could not be backed up. Save an FDX copy before trying again.", "error"); return;
                }
                if (documentSession.doc !== live || liveVersion !== documentSession.editVersion) return;
                const meta = { path: documentSession.filePath, name: documentSession.fileName, identity: documentSession.fileIdentity,
                  lastSaved: documentSession.lastSaved, dirty: true, savedSnapshot: lastSavedDocument };
                if (!loadDocument(older, meta)) return;
                markDirty();
                modalActions.closeDialog();
                modalActions.toast("Version restored", "Review the draft, then save when ready.", "success");
              } },
            ],
          });
        } catch (error) { modalActions.toast("Version unavailable", error.message, "error"); }
      }));
    } catch (error) { modalActions.toast("Version history unavailable", error.message, "error"); }
  }
  function openCompatibilityInspector() {
    const info = typeof FDX.compatibility === "function" ? FDX.compatibility(documentSession.doc) : null;
    modalActions.openDialog({ eyebrow: "FDX exchange", title: "Compatibility review", wide: true,
      body: `<p>${escapeHtml(info?.summary || "Review the document before exchanging it with another editor.")}</p>
        ${(info?.risks || []).map(risk => `<div class="dialog-note">${escapeHtml(risk.message)}</div>`).join("")}
        <div class="dialog-note">Original vendor data can be retained without being editable here. Save a copy when sharing a draft. Matching pagination and a trusted Final Draft open/save cycle still require reference verification.</div>
        <h3>Editable fields</h3><ul>${(info?.mapped || []).map(row => `<li>${escapeHtml(row.label || row.name)}</li>`).join("")}</ul>
        <details class="safety-details"><summary>Preserved original metadata (${info?.preserved?.length || 0} sections)</summary>
          <ul>${(info?.preserved || []).map(row => `<li><strong>${escapeHtml(row.label || row.name)}</strong> — ${escapeHtml(row.detail || "Preserved")}</li>`).join("")}</ul></details>
        <details class="safety-details"><summary>Document identity and source details</summary>
          <dl class="safety-facts"><dt>Document ID</dt><dd>${escapeHtml(documentSession.doc.documentId || "")}</dd>
          <dt>Source fingerprint</dt><dd>${escapeHtml(documentSession.doc.sourceFingerprint || "New document")}</dd></dl></details>`,
      actions: [
        { label: "Edit native metadata", onClick: openNativeMetadataEditor },
        { label: "Save a copy", onClick: () => isDesktop ? saveDocument({ saveAs: true }) : exportFDX() },
        { label: "Close", kind: "primary" },
      ],
    });
  }
  function openNativeMetadataEditor(selectedSection) {
    const version = documentSession.editVersion;
    const current = documentSession.doc;
    let metadata;
    try { metadata = FDX.nativeMetadata(current); }
    catch (error) { modalActions.toast("Native metadata unavailable", error.message, "error"); return; }
    const sections = metadata.sections || [];
    const section = sections.find(entry => entry.name === selectedSection) || sections[0];
    const fields = [], operations = [];
    const renderNode = (node, depth = 0) => {
      const rows = (node.attributes || []).map(attribute => {
        if (!attribute.editable) return `<span class="native-metadata-reference">${escapeHtml(attribute.name)}: ${escapeHtml(attribute.value)}</span>`;
        const index = fields.push({ section: section.name, path: node.path, attribute: attribute.name, value: attribute.value }) - 1;
        return `<label class="field"><span>${escapeHtml(attribute.label || attribute.name)}</span><input class="input" data-native-field="${index}" value="${escapeHtml(attribute.value)}"></label>`;
      });
      if (node.editableText) {
        const index = fields.push({ section: section.name, path: node.path, text: node.text || "" }) - 1;
        rows.push(`<label class="field"><span>${escapeHtml(node.textLabel || "Text")}</span><textarea class="input" rows="3" data-native-field="${index}">${escapeHtml(node.text || "")}</textarea></label>`);
      } else if (node.text) rows.push(`<p>${escapeHtml(node.text)}</p>`);
      for (const action of ["duplicate", "delete"]) {
        if (!node.actions?.includes(action)) continue;
        const index = operations.push({ section: section.name, path: node.path, action }) - 1;
        rows.push(`<button type="button" class="btn" data-native-operation="${index}">${action === "delete" ? "Delete" : "Duplicate"} ${escapeHtml(node.label || node.name)}</button>`);
      }
      return `<details class="safety-details native-metadata-node"${depth === 0 ? " open" : ""}><summary>${escapeHtml(node.label || node.name)}</summary>${rows.join("")}${(node.children || []).map(child => renderNode(child, depth + 1)).join("")}</details>`;
    };
    modalActions.openDialog({ eyebrow: "FDX exchange", title: "Native metadata", wide: true,
      body: `<p>Edit supported fields in the document’s original cast, tags, boards and page-lock data. Reference IDs stay protected; changes are checked before being applied. Keep a separate copy for production interchange.</p>
        ${metadata.warnings?.length ? `<details class="safety-details"><summary>Existing metadata warnings (${metadata.warnings.length})</summary><ul>${metadata.warnings.slice(0, 50).map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>${metadata.warnings.length > 50 ? '<p>Showing the first 50 warnings.</p>' : ''}</details>` : ""}
        ${section ? `<label class="field"><span>Metadata section</span><select id="nativeMetadataSection">${sections.map(entry => `<option value="${escapeHtml(entry.name)}"${entry === section ? " selected" : ""}>${escapeHtml(entry.label || entry.name)}</option>`).join("")}</select></label>
          <div id="nativeMetadataFields">${(section.nodes || []).map(node => renderNode(node)).join("")}</div>` : '<p>No supported native sections are present. Import an FDX with populated metadata to edit its supported fields.</p>'}
        <p id="nativeMetadataError" role="alert" class="dialog-note" hidden></p>`,
      actions: [{ label: "Cancel" }, ...(section ? [{ label: "Apply native changes", kind: "primary", keepOpen: true, onClick: () => applyChanges() }] : [])],
    });
    const showError = message => { const el = $("#nativeMetadataError"); if (el) { el.hidden = false; el.textContent = message; } };
    const collectChanges = () => [...els.dialogBody.querySelectorAll('[data-native-field]')].flatMap(input => {
      const field = fields[Number(input.dataset.nativeField)];
      const old = Object.hasOwn(field, "attribute") ? field.value : field.text;
      if (input.value === String(old ?? "")) return [];
      return [{ ...field, ...(Object.hasOwn(field, "attribute") ? { value: input.value } : { text: input.value }) }];
    });
    function applyChanges(operation, nextSection) {
      try {
        if (version !== documentSession.editVersion) throw new Error("The document changed while this editor was open. Close and reopen it before applying changes.");
        const edits = collectChanges();
        if (operation) edits.push(operation);
        if (edits.length) {
          const updated = FDX.updateNativeMetadata(current, { signature: metadata.signature, edits });
          applyDocumentEdit(updated);
        }
        if (operation || nextSection) openNativeMetadataEditor(nextSection || section.name);
        else { modalActions.closeDialog(); if (edits.length) modalActions.toast("Native metadata updated", "Save an FDX copy to exchange the changes.", "success"); }
      } catch (error) { showError(error.message); }
    }
    $("#nativeMetadataSection")?.addEventListener("change", event => {
      const next = event.target.value;
      if (collectChanges().length) {
        event.target.value = section.name;
        showError("Apply your native changes before switching sections, or cancel this editor to discard them.");
        return;
      }
      openNativeMetadataEditor(next);
    });
    $$('[data-native-operation]', els.dialogBody).forEach(button => button.addEventListener("click", () => applyChanges(operations[Number(button.dataset.nativeOperation)])));
  }
  function renderExternalChangeBanner() {
    let banner = $("#externalChangeBanner");
    if (!banner) {
      banner = document.createElement("div"); banner.id = "externalChangeBanner"; banner.className = "external-change-banner";
      banner.setAttribute("role", "status");
      banner.innerHTML = `<span>The file changed outside Azkript. Your draft is still here.</span><button type="button" class="btn" id="reviewExternalChange">Review changes</button>`;
      els.workspace.prepend(banner);
      banner.querySelector("button").addEventListener("click", openFileStatus);
    }
    banner.hidden = !documentSession.externalChange;
  }
  async function openFileStatus() {
    if (!desktop || !documentSession.filePath) {
      modalActions.openDialog({ eyebrow: "Document safety", title: "File status", body: "<p>This draft has no active desktop file. Save it to choose a location.</p>", actions: [{ label: "Close", kind: "primary" }] }); return;
    }
    const filePath = documentSession.filePath;
    try {
      const disk = await desktop.readFile(filePath);
      if (documentSession.filePath !== filePath) return;
      const parsed = FDX.parse(disk.contents);
      const unchanged = documentSession.fileIdentity && disk.identity === documentSession.fileIdentity;
      modalActions.openDialog({ eyebrow: "File on disk", title: unchanged ? "File is up to date" : "Compare disk changes", wide: true,
        body: `<p>${escapeHtml(filePath)}</p>${diffMarkup(parsed, documentSession.doc)}`,
        actions: [
          { label: "Reload disk version", keepOpen: true, onClick: async () => {
            if (documentSession.saving) { modalActions.toast("Save in progress", "Wait for the current save before reloading."); return; }
            const live = documentSession.doc;
            const editVersion = documentSession.editVersion;
            if (!(await saveVersionSnapshot("Before reloading from disk", true))) {
              modalActions.toast("Reload cancelled", "The current draft could not be backed up. Save a copy first.", "error"); return;
            }
            if (documentSession.doc !== live) return;
            // Re-read after the backup: the file can change during the review.
            const diskNow = await desktop.readFile(filePath);
            if (documentSession.doc !== live || documentSession.filePath !== filePath || documentSession.editVersion !== editVersion) {
              modalActions.toast("Reload cancelled", "The draft changed while the disk version was loading.", "info");
              return;
            }
            const generation = modalActions.getDialogGeneration();
            await handleFilePayload(diskNow);
            if (modalActions.getDialogGeneration() === generation) modalActions.closeDialog();
          } },
          { label: "Save a copy", onClick: () => saveDocument({ saveAs: true }) },
          { label: "Keep editing", kind: "primary" },
        ],
      });
    } catch (error) {
      modalActions.openDialog({ eyebrow: "File unavailable", title: "The disk file could not be read",
        body: `<p>${escapeHtml(error.message)}</p><p>Your current draft is still available. Save a separate copy to keep it.</p>`,
        actions: [{ label: "Save a copy", onClick: () => saveDocument({ saveAs: true }) }, { label: "Keep editing", kind: "primary" }],
      });
    }
  }
  function redo() {
    const entry = documentSession.history?.redo();
    if (!entry) {
      modalActions.toast("Nothing to redo", "You are at the latest edit.", "info", 1800);
      return;
    }
    documentSession.replaceContent(entry.document);
    editorState.pendingSelection = entry.selection;
    planningViews.populateElementControls();
    markDirty();
    workspaceLayout.renderAll();
    updateHistoryButtons();
  }
  return {
    applyDocumentEdit,
    DOC_KEY,
    LEGACY_DOC_KEY,
    RENAMED_DOC_KEYS,
    backupVaultDialog,
    closeDocument,
    confirmDiscard,
    exportBeatBoard,
    exportFDX,
    handleOpenDocument,
    loadDocument,
    loadInitial,
    markDirty,
    newDocument,
    onFileChosen,
    openCompatibilityInspector,
    openFilePicker,
    openFileStatus,
    openNativeMetadataEditor,
    openVersionHistory,
    openWgaDialog,
    persistPrefs,
    persistWorkspace,
    readBrowserFdx,
    redo,
    renderExternalChangeBanner,
    revertDocument,
    saveAsTemplate,
    saveDocument,
    saveVersionSnapshot,
    undo,
    updateHistoryButtons,
    updateSaveState
  };
};
