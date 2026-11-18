"use strict";

window.AzkriptRenderer.desktopActions = function ({
  desktopState,
  documentSession,
  editorActions,
  fileActions,
  findActions,
  modalActions,
  pageActions,
  preferences,
  productionActions,
  settingsActions,
  shared,
  speechActions,
  workspaceLayout,
}) {
  const { $, $$, desktop, els, escapeHtml, formatDate, getStats, icon, isDesktop } = shared;

  // desktop bridge
  function syncDesktopState(immediate = false) {
    if (!isDesktop) return;
    const send = () =>
      desktop.updateState({
        title: documentSession.doc.title || "Untitled Screenplay",
        dirty: documentSession.dirty,
        filePath: documentSession.filePath,
        theme: preferences.theme,
        revision: documentSession.doc.revision ? documentSession.doc.revision.current : 1,
      });
    clearTimeout(desktopState.windowTimer);
    if (immediate) {
      send();
      desktopState.windowTimer = null;
    } else {
      desktopState.windowTimer = setTimeout(() => {
        desktopState.windowTimer = null;
        send();
      }, 90);
    }
  }
  async function initDesktop() {
    document.body.classList.add("is-desktop");
    document.body.classList.add(desktop.platform === "win32" ? "is-win" : "is-mac");
    syncDesktopState(true);
    desktop.onCommand(handleDesktopCommand);
    desktop.onRequestSave(() => fileActions.saveDocument({ forClose: true }));
    if (desktop.onFileChanged) desktop.onFileChanged(change => {
      if (!sameDesktopPath(change.path, documentSession.filePath)) return;
      if (change.identity === documentSession.fileIdentity) { documentSession.externalChange = null; fileActions.renderExternalChangeBanner(); return; }
      documentSession.externalChange = change;
      fileActions.renderExternalChangeBanner();
    });
    [desktopState.appInfo, desktopState.recovery] = await Promise.all([
      desktop.getInfo().catch(() => null), desktop.readRecovery().catch(() => null),
    ]);
    setTimeout(() => {
      if (desktopState.suppressStartCenter) return;
      if (preferences.startCenterOnLaunch || desktopState.recovery) showStartCenter();
    }, 600);
  }
  function sameDesktopPath(a, b) {
    return Boolean(a && b) && (desktop.platform === "win32"
      ? a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
      : a === b);
  }
  async function handleDesktopCommand(message) {
    if (!message || !message.command) return;
    const { command, payload } = message;
    switch (command) {
      case "open-document":
        return fileActions.handleOpenDocument(payload);
      case "new":
        return fileActions.newDocument();
      case "open":
        return fileActions.openFilePicker();
      case "save":
        return fileActions.saveDocument({ forClose: Boolean(payload && payload.forClose) });
      case "save-as":
        return fileActions.saveDocument({ saveAs: true });
      case "export-fdx":
        return fileActions.exportFDX();
      case "export-pdf":
        return pageActions.exportPDF();
      case "print":
        return pageActions.printDocument();
      case "undo":
        return fileActions.undo();
      case "redo":
        return fileActions.redo();
      case "find":
        return findActions.openFind("find");
      case "unified-search":
        return document.getElementById('quickSearchButton')?.click();
      case "replace":
        return findActions.openFind("replace");
      case "title-page":
        return productionActions.openTitlePage();
      case "page-setup":
        return settingsActions.openPageSetup();
      case "revision":
        return productionActions.openRevisionManager();
      case "revision:toggle":
        return productionActions.toggleRevisionMode();
      case "revision:next":
        return productionActions.startNextRevision();
      case "scene-details":
        return productionActions.openSceneDetails();
      case "scene:new":
        return editorActions.insertScene();
      case "scene:previous":
      case "scene:next":
        return editorActions.moveScene(command === "scene:previous" ? -1 : 1);
      case "table-read":
        return speechActions.openReadDock(false);
      case "table-read:here":
        return speechActions.openReadDock(true);
      case "help":
        return settingsActions.openHelp();
      case "documentation":
        return settingsActions.openUserGuide();
      case "start-center":
        return showStartCenter();
      case "focus":
        return workspaceLayout.toggleFocus();
      case "inspector":
        return workspaceLayout.toggleInspector();
      case "rail":
        return workspaceLayout.toggleRail();
      case "view":
        return workspaceLayout.setView((payload && payload.view) || "script");
      case "mode":
        return workspaceLayout.setMode((payload && payload.mode) || "write");
      case "zoom":
        if (payload && payload.reset) {
          preferences.zoom = 1;
          workspaceLayout.applyZoom();
          fileActions.persistPrefs();
        } else {
          workspaceLayout.setZoom((payload && payload.delta) || 0.1);
        }
        return undefined;
      case "element":
        return editorActions.changeElementType(payload && payload.type);
      case "format:bold":
        return editorActions.formatSelection("bold");
      case "format:italic":
        return editorActions.formatSelection("italic");
      case "format:underline":
        return editorActions.formatSelection("underline");
      default:
        return undefined;
    }
  }
  // start center
  function showStartCenter() {
    if (!isDesktop) {
      modalActions.toast("Start Center", "The desktop build adds recent files, recovery, and native dialogs.", "info", 3200);
      return;
    }
    if (desktopState.startCenterOpen) {
      els.startCenter.focus();
      return;
    }
    desktopState.suppressStartCenter = false;
    /* Open synchronously. This used to be an async function that awaited
     * refreshStartCenter() before calling showModal(), so for the first frames
     * of the session the panel did not exist yet and the very first click on
     * the close button hit the workspace behind it. Nothing in the panel needs
     * the refreshed copy before it is visible. */
    els.startCenter.classList.remove("is-closing");
    els.startCenter.showModal();
    desktopState.startCenterOpen = true;
    els.startCenter.classList.add("is-open");
    requestAnimationFrame(() => {
      els.startCenter.classList.add("is-ready");
    });
    refreshStartCenter().catch(() => {});
  }
  function hideStartCenter() {
    if (!els.startCenter.open) {
      /* Already closed, but a stale flag or class could still be set; clear it. */
      els.startCenter.classList.remove("is-open", "is-ready", "is-closing");
      desktopState.startCenterOpen = false;
      return;
    }
    /* Cancel any close already in flight so repeated clicks stay idempotent,
     * then run one clean close. Clearing the latch first matters: a close whose
     * animation was interrupted used to leave `is-closing` on the element, and
     * every later attempt returned early, stranding the user on a page they
     * could not leave. */
    clearTimeout(desktopState.startCenterCloseTimer);
    els.startCenter.classList.remove("is-closing");
    modalActions.closeModalAnimated(els.startCenter, () => {
      els.startCenter.classList.remove("is-open", "is-ready");
      desktopState.startCenterOpen = false;
    });
    scheduleStartCenterRecovery();
  }
  /* Last-resort recovery for the panel. If the dialog is still open shortly
   * after a close attempt but its panel is invisible (opacity ~0), the close
   * animation was interrupted and the result is an invisible modal that blocks
   * the whole window. Force it shut instead. Runs on every close path, and also
   * on show/state changes, so no single missed animation can lock the app. */
  function scheduleStartCenterRecovery() {
    clearTimeout(desktopState.startCenterCloseTimer);
    desktopState.startCenterCloseTimer = setTimeout(() => {
      if (!els.startCenter.open) return;
      if (els.startCenter.classList.contains("is-closing")) {
        /* Still animating out: give it one more beat before forcing. */
        scheduleStartCenterRecovery();
        return;
      }
      const panel = els.startCenter.querySelector(".start-center");
      const opacity = panel ? Number(getComputedStyle(panel).opacity) : 0;
      if (!panel || opacity < 0.05) {
        try {
          els.startCenter.close();
        } catch (_) {}
        els.startCenter.classList.remove("is-open", "is-ready", "is-closing");
        desktopState.startCenterOpen = false;
      }
    }, 450);
  }
  async function refreshStartCenter() {
    const stats = getStats(documentSession.doc);
    const pages = pageActions.pageCount();
    const startDraftName = $("#startDraftName");
    if (startDraftName) startDraftName.textContent = documentSession.doc.title || "Untitled";
    const startPages = $("#startDraftPages");
    if (startPages) startPages.textContent = String(pages);
    const startWords = $("#startDraftWords");
    if (startWords) startWords.textContent = stats.words.toLocaleString();
    els.startOnLaunch.checked = preferences.startCenterOnLaunch;
    if (desktopState.recovery) {
      els.recoveryBanner.hidden = false;
      const age = desktopState.recovery.ageMs
        ? desktopState.recovery.ageMs < 60000
          ? "less than a minute ago"
          : `${Math.round(desktopState.recovery.ageMs / 60000)} min ago`
        : "recently";
      els.recoveryCopy.textContent = `${desktopState.recovery.title || "Untitled draft"} · recovered ${age}`;
    } else {
      els.recoveryBanner.hidden = true;
    }
    const startVersion = $("#startVersion");
    if (startVersion) {
      startVersion.textContent = desktopState.appInfo
        ? `Azkript ${desktopState.appInfo.version}`
        : "Azkript";
    }
    if (!isDesktop) {
      els.recentList.innerHTML = `<div class="recent-empty">${icon("folder")}<span>Open an FDX file to begin. Browser mode does not keep a recent-file list.</span></div>`;
      return;
    }
    desktopState.recent = await desktop.recent().catch(() => []);
    if (!desktopState.recent.length) {
      els.recentList.innerHTML = `<div class="recent-empty">${icon("file")}<span>No recent screenplays yet. Open an FDX or start from a template.</span></div>`;
      return;
    }
    els.recentList.innerHTML = desktopState.recent
      .map(
        (item, index) => `
        <button class="recent-item" type="button" data-recent-index="${index}" style="--i:${index}">
          <span class="recent-item__icon">${icon("file")}</span>
          <span class="recent-item__copy"><strong>${escapeHtml(item.title || item.name)}</strong><span>${escapeHtml(item.path)}</span></span>
          <span class="recent-item__date">${escapeHtml(formatDate(item.openedAt))}</span>
          <svg><use href="#i-chevron-right"></use></svg>
        </button>`,
      )
      .join("");
    $$(".recent-item", els.recentList).forEach((button) => {
      button.addEventListener("click", () => openRecent(Number(button.dataset.recentIndex)));
    });
  }
  async function openRecent(index) {
    const item = desktopState.recent[index];
    if (!item) return;
    const generation = documentSession.generation;
    try {
      const file = await desktop.readFile(item.path);
      if (generation === documentSession.generation) await fileActions.handleOpenDocument(file);
    } catch (error) {
      modalActions.toast("Could not open recent file", error.message || item.path, "error");
    }
  }
  async function restoreRecovery() {
    const version = documentSession.editVersion;
    if (!(await fileActions.confirmDiscard("Restoring the recovery copy will replace the current edits."))) return;
    const current = await desktop.readRecovery({ resume: true, updatedAt: desktopState.recovery?.updatedAt }).catch(() => null);
    if (version !== documentSession.editVersion) return;
    const recovery = desktopState.recovery || current;
    if (!recovery || !recovery.document) {
      modalActions.toast("Recovery unavailable", "The recovery copy could not be read.", "warning");
      return;
    }
    if (!fileActions.loadDocument(recovery.document, { path: recovery.filePath || null, identity: recovery.identity || null,
      name: recovery.filePath ? recovery.filePath.split(/[\\/]/).pop() : null, dirty: true, savedSnapshot: null })) return;
    desktopState.recovery = null;
    if (current && current.updatedAt === recovery.updatedAt) {
      documentSession.recoveryWrittenAt = Date.now();
      documentSession.recoveryVersion = documentSession.editVersion;
    } else fileActions.persistWorkspace();
    fileActions.updateSaveState();
    modalActions.toast("Draft recovered", "The unsaved copy is open. Save it to a file when you are ready.", "success");
  }
  async function discardRecovery() {
    const recovery = desktopState.recovery;
    if (!recovery) return;
    try {
      await desktop.clearRecovery({ updatedAt: recovery.updatedAt });
    } catch (error) {
      modalActions.toast("Recovery copy could not be discarded", error.message, "error");
      return;
    }
    desktopState.recovery = null;
    if (els.recoveryBanner) {
      els.recoveryBanner.classList.add("is-closing");
      setTimeout(() => {
        els.recoveryBanner.hidden = true;
        els.recoveryBanner.classList.remove("is-closing");
      }, 180);
    }
    modalActions.toast("Recovery discarded", "The unsaved recovery copy was removed.", "info", 2200);
  }
  function bindStartCenterEvents() {
    /* See bindEvents; kept as a named group for readability. */
  }
  return {
    bindStartCenterEvents,
    discardRecovery,
    hideStartCenter,
    initDesktop,
    refreshStartCenter,
    restoreRecovery,
    sameDesktopPath,
    showStartCenter,
    syncDesktopState
  };
};
