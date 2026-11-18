"use strict";

window.AzkriptRenderer.inputEvents = function ({
  desktopActions,
  desktopState,
  documentSession,
  editorActions,
  editorState,
  fileActions,
  findActions,
  interfaceState,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  productionActions,
  ribbonActions,
  settingsActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
  writingTools,
}) {
  const { $, $$, on, ELEMENTS, clamp, desktop, els, icon, isDesktop, motionQuery, normalizeScriptFont, prefersReducedMotion } = shared;

  // keyboard
  function isTypingTarget(target) {
    return (
      target &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    );
  }
  /* The screenplay surface is also contentEditable, but it is the document
   * itself: app-level shortcuts must keep working there. Only real form fields
   * (inputs, textareas, selects, and rich-text fields other than #editor) own
   * their editing shortcuts. */
  function isFormFieldTarget(target) {
    if (!target) return false;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
    if (!target.isContentEditable) return false;
    if (els.editor && (target === els.editor || els.editor.contains(target))) return false;
    return true;
  }
  function onGlobalKeyDown(event) {
    if (event.isComposing || editorState.composing || event.keyCode === 229) return;
    const meta = event.ctrlKey || event.metaKey;
    if (els.startCenter.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        desktopActions.hideStartCenter();
      }
      return;
    }
    if (els.findDialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        findActions.closeFind();
      }
      return;
    }
    if (els.commandDialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        modalActions.closeCommandDialog();
      }
      return;
    }
    if (els.dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        modalActions.closeDialog();
      }
      return;
    }
    if (event.key === "F6" && !meta && !event.altKey && !event.shiftKey &&
        workspaceState.view === "script" && workspaceState.mode === "write") {
      if (els.editor.contains(event.target)) {
        const control = [".focus-exit", "#titlePageButton", "#inspectorToggle", "#settingsButton", "#brandButton"]
          .map(selector => $(selector)).find(button => button?.getClientRects().length);
        if (control) {
          event.preventDefault();
          control.focus();
        }
      } else {
        const paragraph = $(".para.is-active", els.editor) || $(".para", els.editor);
        if (!paragraph) return;
        event.preventDefault();
        const selection = FDCoreWriting.captureSelection(els.editor);
        if (!FDCoreWriting.restoreSelection(els.editor, selection)) editorActions.focusParagraph(paragraph.dataset.id, "start");
      }
      return;
    }
    /* A focused form field owns its own editing shortcuts: undo, redo, find and
     * the like must act on the field, not on the screenplay. Save and the
     * command palette stay global because they have no field-local meaning. */
    if (
      isFormFieldTarget(event.target) &&
      !(meta && ["s", "k"].includes(event.key.toLowerCase()))
    ) {
      return;
    }
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      modalActions.openCommandPalette();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      fileActions.saveDocument({ saveAs: true });
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      fileActions.saveDocument();
      return;
    }
    if (meta && event.key.toLowerCase() === "o") {
      event.preventDefault();
      fileActions.openFilePicker();
      return;
    }
    // Require the exact chord: without !shiftKey this also captured
    // Ctrl+Shift+N and shadowed the ScriptNote shortcut bound further down.
    if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      fileActions.newDocument();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      pageActions.exportPDF();
      return;
    }
    /* Ctrl+P prints. This must require that Alt is NOT held: without the
     * !altKey check it also swallowed Ctrl+Alt+P (Page View) and printed
     * instead, opening a native print dialog that blocked the renderer. */
    if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      pageActions.printDocument();
      return;
    }
    if (meta && event.key.toLowerCase() === "h") {
      event.preventDefault();
      findActions.openFind("replace");
      return;
    }
    if (meta && event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      workspaceLayout.toggleFocus();
      return;
    }
    if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findActions.openFind("find");
      return;
    }
    if (meta && !event.shiftKey && event.key.toLowerCase() === "g") {
      event.preventDefault();
      writingTools.openGoToDialog();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      speechActions.openReadDock(true);
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      productionActions.toggleRevisionMode();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      productionActions.startNextRevision();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      workspaceLayout.setView("script");
      workspaceLayout.setMode("page");
      return;
    }
    if (meta && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      editorActions.moveScene(event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (!meta && event.altKey && !event.shiftKey && /^[0-9ESOL]$/.test(event.key.toUpperCase())) {
      /* The guard used to be /^[0-7]$/, which silently killed six of the fourteen       * element shortcuts: Act break (8), End of Act (9), General (E), Summary       * (S), Outline 1 (O) and Outline 2 (L). Those letters were advertised in the       * element combo and the reports, so the advert was a lie. The key set is       * derived from ELEMENTS rather than hard-coded so it cannot drift again. */
      const entry = Object.entries(ELEMENTS).find(        ([, spec]) => String(spec.shortcut).toUpperCase() === event.key.toUpperCase(),      );
      if (entry) {
        event.preventDefault();
        editorActions.changeElementType(entry[0]);
        return;
      }
    }
    if (meta && event.key === "Enter") {
      event.preventDefault();
      editorActions.insertScene();
      return;
    }
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? fileActions.redo() : fileActions.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      fileActions.redo();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      productionActions.openSceneDetails();
      return;
    }
    if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      editorActions.toggleDualDialogue();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      editorActions.openScriptNote();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      editorActions.formatSelection("strikeThrough");
      return;
    }
    if (event.key === "F7") {
      event.preventDefault();
      if (event.shiftKey) editorActions.openThesaurus();
      else editorActions.openSpellcheckDialog();
      return;
    }
    if (meta && event.key === "1") {
      event.preventDefault();
      workspaceLayout.setView("script");
      return;
    }
    if (meta && event.key === "2") {
      event.preventDefault();
      workspaceLayout.setView("navigator");
      return;
    }
    if (meta && event.key === "3") {
      event.preventDefault();
      workspaceLayout.setView("characters");
      return;
    }
    if (meta && event.key === "4") {
      event.preventDefault();
      workspaceLayout.setView("reports");
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      settingsActions.openHelp();
      return;
    }
    if (event.key === "Escape" && document.body.classList.contains("focus-mode")) {
      event.preventDefault();
      workspaceLayout.toggleFocus();
      return;
    }
    if (isTypingTarget(event.target) && meta && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      editorActions.formatSelection(
        event.key.toLowerCase() === "b"
          ? "bold"
          : event.key.toLowerCase() === "i"
            ? "italic"
            : "underline",
      );
      return;
    }
    if (event.key === "?" && !isTypingTarget(event.target)) {
      event.preventDefault();
      settingsActions.openHelp();
    }
  }
  // event wiring
  function bindEvents() {
    ribbonActions.bindRibbonEvents();
    modalActions.initTooltips();
    els.editor.addEventListener("input", editorActions.onEditorInput);
    els.editor.addEventListener("beforeinput", editorActions.onEditorBeforeInput);
    els.editor.addEventListener("compositionstart", editorActions.onCompositionStart);
    els.editor.addEventListener("compositionend", editorActions.onCompositionEnd);
    els.editor.addEventListener("focusin", editorActions.onEditorFocusIn);
    els.editor.addEventListener("keydown", editorActions.onEditorKeyDown);
    els.editor.addEventListener("paste", editorActions.onPaste);
    els.editor.addEventListener("click", (event) => {
      const altBadge = event.target.closest ? event.target.closest(".alt-badge") : null;
      if (altBadge) {
        event.preventDefault();
        event.stopPropagation();
        const paraEl = altBadge.closest(".para");
        if (paraEl && paraEl.dataset.id) {
          writingTools.cycleParagraphAlt(paraEl.dataset.id);
        }
      }
    });
    els.editor.addEventListener("focusout", (event) => {
      const el = event.target && event.target.closest ? event.target.closest(".para") : null;
      if (el && !editorState.composing && editorActions.maybeAutoUppercase(el)) {
        fileActions.markDirty();
        documentSession.history.schedule();
        editorActions.scheduleChrome();
      }
      setTimeout(() => {
        if (!els.smartType || !editorState.smart.visible) return;
        if (document.activeElement && document.activeElement.closest(".smart-type")) return;
        editorActions.hideSmartType();
      }, 120);
    });
    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("selectionchange", () => {
      const el = editorActions.activeParagraphElement();
      if (el && el.dataset.id !== editorState.selectedId) editorActions.setActiveParagraph(el.dataset.id);
      editorActions.syncFormatButtons();
    });
    $$(".format-btn").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => editorActions.formatSelection(button.dataset.format));
    });
    // Wrapped so the click event is not passed as newDocument's `kind` argument;
    // an event object is truthy and silently produced the feature template.
    on("newButton", "click", () => fileActions.newDocument());
    on("openButton", "click", fileActions.openFilePicker);
    on("saveButton", "click", () => fileActions.saveDocument());
    on("exportButton", "click", fileActions.exportFDX);
    on("undoButton", "click", fileActions.undo);
    on("redoButton", "click", fileActions.redo);
    on("themeToggle", "click", workspaceLayout.toggleTheme);
    on("focusToggle", "click", workspaceLayout.toggleFocus);
    on("settingsButton", "click", settingsActions.openSettings);
    on("helpButton", "click", settingsActions.openHelp);
    on("statusHelp", "click", settingsActions.openHelp);
    on("commandButton", "click", modalActions.openCommandPalette);
    on("elementSettingsButton", "click", editorActions.openElementSettings);
    on("caseButton", "click", editorActions.cycleCase);
    on("dualDialogueButton", "click", editorActions.toggleDualDialogue);
    on("scriptNoteButton", "click", editorActions.openScriptNote);
    on("thesaurusButton", "click", editorActions.openThesaurus);
    on("outlineToggleButton", "click", () => editorActions.toggleOutlineLayer());
    on("rulerToggleButton", "click", () => editorActions.toggleRulerLayer());
    on("splitViewButton", "click", () => editorActions.toggleSplitView());
    on("splitOrientationBtn", "click", () =>
      editorActions.toggleSplitView(true, workspaceState.splitView.orientation === "vertical" ? "horizontal" : "vertical"),
    );
    on("splitSwapBtn", "click", editorActions.swapSplitPanes);
    on("splitCloseBtn", "click", () => editorActions.toggleSplitView(false));
    $$(".split-pane__tab", els.splitPane).forEach((tab) => {
      tab.addEventListener("click", () => {
        workspaceState.splitView.mode = tab.dataset.splitMode;
        editorActions.renderSplitPane();
      });
    });
    on("documentPill", "click", settingsActions.openDocumentDetails);
    on("pageSetupButton", "click", settingsActions.openPageSetup);
    on("titlePageButton", "click", productionActions.openTitlePage);
    on("titlePageInspectorButton", "click", productionActions.openTitlePage);
    on("exportPdfButton", "click", pageActions.exportPDF);
    on("inspectorToggle", "click", () => workspaceLayout.toggleInspector());
    on("inspectorClose", "click", () => workspaceLayout.toggleInspector(false));
    on("addSceneButton", "click", editorActions.insertScene);
    on("refreshReport", "click", () => {
      planningViews.renderReports();
      modalActions.toast("Report refreshed", "Scene and dialogue analytics are up to date.", "success", 2200);
    });
    on("copyReport", "click", planningViews.copyReport);
    on("validateButton", "click", productionActions.validateDocumentAction);
    on("copyOutlineButton", "click", planningViews.copyOutline);
    on("tableReadButton", "click", () => speechActions.openReadDock(true));
    on("zoomIn", "click", () => workspaceLayout.setZoom(0.1));
    on("zoomOut", "click", () => workspaceLayout.setZoom(-0.1));
    on("brandButton", "click", desktopActions.showStartCenter);
    on("railToggle", "click", workspaceLayout.toggleRail);
    on("findButton", "click", () => findActions.openFind("find"));
    on("revisionButton", "click", productionActions.openRevisionManager);
    on("revisionInspectorButton", "click", productionActions.openRevisionManager);
    on("sceneDetailsButton", "click", productionActions.openSceneDetails);
    on("pagePrev", "click", () => pageActions.stepPage(-1));
    on("pageNext", "click", () => pageActions.stepPage(1));
    on("cardHelpButton", "click", () => {
      modalActions.openDialog({
        eyebrow: "Index cards",
        title: "A board that behaves like a script",
        body: `
          <div class="shortcut-grid" style="grid-template-columns:1fr">
            <div class="shortcut-row"><span>Drag any card</span><span><kbd>drop</kbd></span></div>
            <div class="shortcut-row"><span>Edit synopsis, color, notes</span><span>${icon("pencil")}</span></div>
            <div class="shortcut-row"><span>Omit a scene from the page view</span><span>${icon("eye-off")}</span></div>
            <div class="shortcut-row"><span>Jump back into the screenplay</span><span>click card</span></div>
          </div>
          <div class="dialog-note">Omitted scenes stay in the editor and are skipped by pagination, PDF, print, and FDX page geometry.</div>`,
        actions: [{ label: "Got it", kind: "primary" }],
      });
    });
    $$("#viewSegmented .segmented__item").forEach((button) => {
      button.addEventListener("click", () => workspaceLayout.setMode(button.dataset.mode));
    });
    $$(".rail__item[data-view]").forEach((button) => {
      button.addEventListener("click", () => workspaceLayout.setView(button.dataset.view));
    });
    $$(".inspector-tab").forEach((button) => {
      button.addEventListener("click", () => planningViews.setInspectorTab(button.dataset.tab));
    });
    els.sceneSearch.addEventListener("input", () => {
      workspaceState.sceneQuery = els.sceneSearch.value;
      planningViews.renderScenes();
    });
    els.navigatorSearch.addEventListener("input", () => {
      workspaceState.navigatorQuery = els.navigatorSearch.value;
      planningViews.renderNavigator();
    });
    els.paperScroll.addEventListener(
      "scroll",
      () => {
        /* A user-initiated scroll cancels any navigation lock still pending, so the
         * highlight follows the pointer immediately rather than waiting out the settle
         * window. Distinguished by whether we have already arrived at the target: once
         * the smooth scroll is at (or within 2px of) its destination it is over, and any
         * further scroll from there is the user's. */
        if (workspaceState.navigationInFlight && workspaceState.navigationTarget != null &&
            Math.abs(els.paperScroll.scrollTop - workspaceState.navigationTarget) > 2) {
          // still travelling to the target: keep the lock
        } else {
          workspaceState.navigationInFlight = false;
          workspaceState.navigationTarget = null;
          workspaceState.navigatedSceneId = null;
        }
        planningViews.updateActiveSceneFromScroll();
      },
      { passive: true },
    );
    els.pagePreview.addEventListener("scroll", pageActions.updatePageFromScroll, { passive: true });
    els.fileInput.addEventListener("change", fileActions.onFileChosen);
    on("titleInput", "input", () => {
      const previous = documentSession.doc.title;
      documentSession.doc.title = els.titleInput.value || "Untitled Screenplay";
      if (documentSession.doc.titlePage.title === previous || !documentSession.doc.titlePage.title) {
        documentSession.doc.titlePage.title = documentSession.doc.title;
      }
      els.docTitle.textContent = documentSession.doc.title;
      els.scriptTitle.textContent = documentSession.doc.title;
      els.paperTitle.textContent = documentSession.doc.title.toUpperCase();
      document.title = `${documentSession.doc.title} — Azkript`;
      fileActions.markDirty();
      workspaceLayout.renderMeta();
      documentSession.history.schedule();
      workspaceLayout.updateWindowStateSoon();
      if (workspaceState.mode === "page") pageActions.renderPagePreview();
    });
    on("authorInput", "input", () => {
      documentSession.doc.author = els.authorInput.value;
      if (!documentSession.doc.titlePage.author) documentSession.doc.titlePage.author = documentSession.doc.author;
      fileActions.markDirty();
      documentSession.history.schedule();
    });
    on("targetPagesInput", "change", () => {
      documentSession.doc.settings.targetPages = clamp(Number(els.targetPagesInput.value) || 120, 1, 999);
      fileActions.markDirty();
      documentSession.history.record();
      workspaceLayout.renderAll();
    });
    ["pageWidth", "pageHeight", "pageTop", "pageBottom"].forEach((id) => {
      const input = document.getElementById(id);
      input.addEventListener("change", () => {
        const page = documentSession.doc.page;
        documentSession.doc.page = {
          ...page,
          width: clamp(Number(els.pageWidth.value) || page.width, 5, 14),
          height: clamp(Number(els.pageHeight.value) || page.height, 7, 20),
          top: clamp(Number(els.pageTop.value) || page.top, 0.5, 2.5),
          bottom: clamp(Number(els.pageBottom.value) || page.bottom, 0.5, 2.5),
        };
        fileActions.markDirty();
        documentSession.history.record();
        workspaceLayout.renderAll();
        workspaceLayout.fitPaper();
        if (workspaceState.mode === "page") pageActions.renderPagePreview();
      });
    });
    $$(".theme-swatch").forEach((button) => {
      button.addEventListener("click", () => workspaceLayout.applyTheme(button.dataset.themeChoice));
    });
    on("invisiblesToggle", "click", () => {
      preferences.showInvisibles = !preferences.showInvisibles;
      els.paper.classList.toggle("has-invisibles", preferences.showInvisibles);
      $("#invisiblesToggle").classList.toggle("is-on", preferences.showInvisibles);
      $("#invisiblesToggle").setAttribute("aria-checked", String(preferences.showInvisibles));
      fileActions.persistPrefs();
    });
    on("guidesToggle", "click", () => {
      preferences.showGuides = !preferences.showGuides;
      els.paper.classList.toggle("has-guides", preferences.showGuides);
      $("#guidesToggle").classList.toggle("is-on", preferences.showGuides);
      $("#guidesToggle").setAttribute("aria-checked", String(preferences.showGuides));
      fileActions.persistPrefs();
    });
    on("sceneNumbersToggle", "click", () => {
      documentSession.doc.settings.sceneNumbers = !documentSession.doc.settings.sceneNumbers;
      els.sceneNumbersToggle.classList.toggle("is-on", documentSession.doc.settings.sceneNumbers);
      els.sceneNumbersToggle.setAttribute("aria-checked", String(documentSession.doc.settings.sceneNumbers));
      fileActions.markDirty();
      workspaceLayout.renderAll();
    });
    on("fontSelect", "change", () => {
      preferences.font = normalizeScriptFont($("#fontSelect").value);      workspaceLayout.applyPageMetrics();
      pageActions.useWorkspaceTypography();
      fileActions.persistPrefs();
      if (workspaceState.mode === "page") pageActions.renderPagePreview();
    });
    on("fontSize", "change", () => {
      preferences.fontSize = clamp(Number($("#fontSize").value) || 12, 8, 24);
      pageActions.useWorkspaceTypography();
      workspaceLayout.applyPageMetrics();
      pageActions.invalidateLayout();
      fileActions.persistPrefs();
      if (workspaceState.mode === "page") pageActions.renderPagePreview();
    });
    on("sceneNumberInput", "input", () => {
      planningViews.updateActiveScene({ number: els.sceneNumberInput.value.trim() });
      editorActions.decorateEditor();
      if (workspaceState.mode === "page") pageActions.renderPagePreview();
    });
    on("sceneNumberInput", "blur", () => {
      planningViews.renderSceneInspector();
    });
    on("sceneTitleInput", "input", () => {
      const input = $("#sceneTitleInput");
      if (input) planningViews.updateActiveScene({ title: input.value });
    });
    on("sceneSynopsis", "input", () => planningViews.updateActiveScene({ synopsis: els.sceneSynopsis.value }));
    on("sceneNotes", "input", () => planningViews.updateActiveScene({ notes: els.sceneNotes.value }));
    on("sceneOmitToggle", "click", () => {
      const on = !els.sceneOmitToggle.classList.contains("is-on");
      els.sceneOmitToggle.classList.toggle("is-on", on);
      els.sceneOmitToggle.setAttribute("aria-checked", String(on));
      planningViews.updateActiveScene({ omit: on });
    });
    on("sceneColorRow", "click", (event) => {
      const button = event.target.closest(".scene-color");
      if (!button) return;
      $$(".scene-color", els.sceneColorRow).forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      planningViews.updateActiveScene({ color: button.dataset.color });
      els.sceneInspectorDot.style.background = button.dataset.color || "var(--brand)";
    });
    on("revisionMini", "click", (event) => {
      if (event.target.closest("[data-revision-toggle]")) productionActions.toggleRevisionMode();
    });
    /* Ribbon actions & Azkript extended workspace controls */
    $$("[data-ribbon-action]").forEach((btn) => {
      btn.addEventListener("click", () => ribbonActions.handleRibbonAction(btn.dataset.ribbonAction));
    });
    $$(".navigator-tab").forEach((tab) => {
      tab.addEventListener("click", () => planningViews.setNavigatorTab(tab.dataset.navTab));
    });
    $$("#sceneViewColumnsToggle [data-sv-col]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.svCol;
        workspaceState.sceneViewCols[col] = !workspaceState.sceneViewCols[col];
        btn.classList.toggle("is-active", workspaceState.sceneViewCols[col]);
        planningViews.renderSceneView();
      });
    });
    on("sceneViewAddBtn", "click", editorActions.insertScene);
    $$("#cardModeSegmented [data-card-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspaceState.cardMode = btn.dataset.cardMode;
        planningViews.renderNavigator();
      });
    });
    on("cardsAcrossSelect", "change", () => {
      const sel = $("#cardsAcrossSelect");
      if (sel) {
        /* "Auto" is value 0 and means "use the responsive auto-fill layout"
         * (renderNavigator removes the inline grid-template-columns for it).
         * `Number(v) || 3` mapped 0 to 3, so Auto behaved exactly like the
         * fixed-3 choice and the responsive layout was unreachable. */
        const value = Number(sel.value);
        workspaceState.cardsAcross = Number.isFinite(value) && value >= 1 ? clamp(value, 1, 9) : 0;
        planningViews.renderNavigator();
      }
    });
    on("sendCardsToScriptBtn", "click", planningViews.sendCardsToScript);
    on("addBeatBtn", "click", () => planningViews.addBeat("beat"));
    on("beatBoardStage", "dblclick", (event) => {
      if (event.target.closest('.beat-card, button, input, select, textarea')) return;
      const canvas = $('#beatBoardCanvas'), rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / canvas.offsetWidth || 1, scaleY = rect.height / canvas.offsetHeight || 1;
      let x = Math.max(16, (event.clientX - rect.left) / scaleX), y = Math.max(16, (event.clientY - rect.top) / scaleY);
      if (workspaceState.beatSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
      planningViews.addBeat('beat', x, y);
    });
    on("addStructureBeatBtn", "click", () => planningViews.addBeat("structure"));
    on("beatAlignSelect", "change", (event) => {
      const val = event.target.value;
      if (val) {
        planningViews.alignBeats(val);
        event.target.value = "";
      }
    });
    on("beatSnapToggle", "click", planningViews.toggleBeatSnap);
    on("beatSendToScriptBtn", "click", () => planningViews.sendBeatToScript(null));
    on("charHighlightBtn", "click", writingTools.openHighlightCharactersDialog);
    on("charRenameBtn", "click", writingTools.openRenameCharacterDialog);
    on("charNonSpeakingBtn", "click", writingTools.openNonSpeakingDialog);
    on("charAssignVoicesBtn", "click", speechActions.openAssignVoicesDialog);
    $$("#reportTypeTabs [data-report-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        workspaceState.reportType = btn.dataset.reportType;
        planningViews.renderReports();
      });
    });
    on("namesDbQuickBtn", "click", writingTools.openNamesDatabaseDialog);
    on("writingStatsQuickBtn", "click", writingTools.openWritingStatsDialog);
    on("askFdQuickBtn", "click", writingTools.openAskFdDialog);
    on("sprintQuickButton", "click", () => writingTools.toggleSprintWidget());
    on("sprintCloseBtn", "click", () => writingTools.toggleSprintWidget(false));
    on("sprintToggleBtn", "click", writingTools.startOrPauseSprint);
    on("sprintResetBtn", "click", writingTools.resetSprint);
    on("sprintDurationSelect", "change", writingTools.resetSprint);
    on("commandInput", "input", () => {
      interfaceState.commandIndex = 0;
      modalActions.renderCommandList($("#commandInput").value);
    });
    on("commandInput", "keydown", modalActions.onCommandKeyDown);
    els.commandDialog.addEventListener("click", (event) => {
      if (event.target === els.commandDialog) modalActions.closeCommandDialog();
    });
    els.commandDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      modalActions.closeCommandDialog();
    });
    els.dialog.addEventListener("click", (event) => {
      if (event.target === els.dialog) modalActions.closeDialog();
    });
    els.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      modalActions.closeDialog();
    });
    const dialogCloseBtn = els.dialog.querySelector(".dialog-head button");
    if (dialogCloseBtn) {
      dialogCloseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        modalActions.closeDialog();
      });
    }
    findActions.bindFindEvents();
    speechActions.bindReadEvents();
    desktopActions.bindStartCenterEvents();
    on("startCenterClose", "click", desktopActions.hideStartCenter);
    on("startContinue", "click", desktopActions.hideStartCenter);
    on("startOpen", "click", async () => {
      desktopActions.hideStartCenter();
      await fileActions.openFilePicker();
    });
    on("startOnLaunch", "change", () => {
      preferences.startCenterOnLaunch = els.startOnLaunch.checked;
      fileActions.persistPrefs();
    });
    on("recentClear", "click", async () => {
      if (!isDesktop) return;
      await desktop.clearRecent().catch(() => {});
      desktopState.recent = [];
      desktopActions.refreshStartCenter();
    });
    on("recoveryRestore", "click", desktopActions.restoreRecovery);
    on("recoveryDiscard", "click", desktopActions.discardRecovery);
    on("startTitlePage", "click", () => {
      desktopActions.hideStartCenter();
      productionActions.openTitlePage();
    });
    on("startTableRead", "click", () => {
      desktopActions.hideStartCenter();
      speechActions.openReadDock(false);
    });
    on("startRevision", "click", () => {
      desktopActions.hideStartCenter();
      productionActions.openRevisionManager();
    });
    $$(".template-card").forEach((button) => {
      button.addEventListener("click", async () => {
        desktopActions.hideStartCenter();
        await fileActions.newDocument(button.dataset.template, true);
      });
    });
    window.addEventListener("resize", () => {
      clearTimeout(workspaceState.resizeTimer);
      workspaceState.resizeTimer = setTimeout(() => {
        workspaceLayout.applyInterfaceScale();
        workspaceLayout.fitPaper();
        if (workspaceState.mode === "page") pageActions.renderPagePreview();
        const activeRail = $(".rail__item[data-view].is-active");
        if (activeRail && els.railIndicator) {
          els.railIndicator.style.transform = `translateX(${activeRail.offsetLeft}px)`;
          els.railIndicator.style.width = `${activeRail.offsetWidth}px`;
        }
      }, 120);
    });
    const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
    systemQuery.addEventListener("change", () => {
      if (preferences.theme === "system") workspaceLayout.applyTheme("system", false);
    });
    motionQuery.addEventListener("change", () => {
      if (prefersReducedMotion()) workspaceLayout.finishThemeTransition();
    });
    els.startCenter.addEventListener("click", (event) => {
      if (event.target === els.startCenter) desktopActions.hideStartCenter();
    });
    els.startCenter.addEventListener("cancel", (event) => {
      event.preventDefault();
      desktopActions.hideStartCenter();
    });
    els.startCenter.addEventListener("close", () => {
      desktopState.startCenterOpen = false;
      els.startCenter.classList.remove("is-open", "is-ready");
    });
    window.addEventListener("dragover", (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      document.body.classList.add("is-file-drag");
    });
    window.addEventListener("dragleave", (event) => {
      if (event.relatedTarget) return;
      document.body.classList.remove("is-file-drag");
    });
    window.addEventListener("drop", async (event) => {
      if (!event.dataTransfer || !event.dataTransfer.files.length) return;
      event.preventDefault();
      document.body.classList.remove("is-file-drag");
      const file = event.dataTransfer.files[0];
      if (!/\.(fdx|fdxt|xml)$/i.test(file.name)) {
        modalActions.toast("Unsupported file", "Drop an FDX or FDXT screenplay.", "warning");
        return;
      }
      try {
        if (isDesktop) {
          const filePath = desktop.pathForFile(file);
          if (filePath) {
            const payload = await desktop.readFile(filePath);
            await fileActions.handleOpenDocument(payload);
            return;
          }
        }
        const text = await fileActions.readBrowserFdx(file);
        await fileActions.handleOpenDocument({ contents: text, name: file.name });
      } catch (error) {
        modalActions.toast("Open failed", error.message || "Could not read the dropped file.", "error");
      }
    });
    window.addEventListener("beforeunload", () => {
      if (documentSession.dirty) fileActions.persistWorkspace();
      desktopActions.syncDesktopState(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && documentSession.dirty) fileActions.persistWorkspace();
    });
    document.addEventListener("pointerdown", (event) => {
      if (prefersReducedMotion()) return;
      const target = event.target.closest(".template-card, .recent-item");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      ripple.style.setProperty("--ripple-size", `${Math.max(rect.width, rect.height) * 1.5}px`);
      target.appendChild(ripple);
      setTimeout(() => ripple.remove(), 620);
    });
  }
  return {
    bindEvents
  };
};
