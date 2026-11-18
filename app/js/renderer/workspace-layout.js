"use strict";

window.AzkriptRenderer.workspaceLayout = function ({
  desktopActions,
  documentSession,
  editorActions,
  editorState,
  fileActions,
  formatActions,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  ribbonActions,
  shared,
  workspaceState,
}) {
  const { $, $$, ACCENT_THEMES, LINE_SPACING_OPTIONS, PAPER_TINTS, clamp, desktop, els, escapeHtml, formatTime, getScenes, getStats, icon, isDesktop, normalizeScriptFont, plural, prefersReducedMotion, revisionEntry, scriptFontStack } = shared;

  /* The line, measured from the top of the scrolling paper, above which a scene heading
   * counts as "the scene you are looking at".
   *
   * This number was duplicated: `updateActiveSceneFromScroll` used a hard-coded 190,
   * while `scrollParagraphIntoView(el, "center")` — what `goToScene` calls — positions
   * the heading at 38% of the viewport height. Those disagree, and on any viewport
   * taller than ~500px the 38% line is BELOW 190px: measured 248px at 1440x1080 and
   * 218px at 1440x1000. So after clicking scene N the heading sat past the threshold,
   * the tracker still saw scene N-1 as the last one above the line, and the highlighted
   * row jumped back one. That is the reported "clicking some scene also jump to a
   * previous scene". It always landed exactly one scene earlier, which is why it read
   * as an off-by-one rather than a scroll bug.
   *
   * One constant feeds both call sites, so the heading a click centres can never fall
   * outside the band the tracker measures. A few px of tolerance keeps sub-pixel
   * rounding from flipping the result.
   *
   * Declared here, above `scrollParagraphIntoView`, so it is initialised before any
   * scroll can run — no temporal-dead-zone dependency on declaration order. */
  const SCENE_ANCHOR_FRACTION = 0.38;
  /* Returns null when the reading viewport has not been laid out yet.
   *
   * It used to fall back to a hard-coded 190, which quietly reintroduced the original
   * two-thresholds bug for any call that ran before layout: the tracker would measure
   * against 190 while the scroll path measures against 38% of the real height. But a
   * zero-height container means `scrollParagraphIntoView` has already bailed out
   * (`if (!cRect.height) return;`) — no scroll has happened, so there is nothing correct
   * for the tracker to derive. Returning null makes the caller skip rather than guess.
   * Both sides now depend on the same precondition instead of disagreeing about it. */
  function sceneAnchorOffset() {
    const container = els.paperScroll;
    if (!container) return null;
    const height = container.getBoundingClientRect().height;
    if (!height) return null;
    return height * SCENE_ANCHOR_FRACTION + 4;
  }
  // theme, zoom, layout
  function resolveTheme(theme) {
    if (theme === "midnight") return "midnight";
    if (theme !== "system") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  let themeTransition = null;
  let themeGeneration = 0;
  function finishThemeTransition() { themeTransition?.skipTransition(); }
  function toggleTheme() {
    applyTheme(resolveTheme(preferences.theme) === "light" ? "dark" : "light");
  }
  function applyTheme(theme, animate = true) {
    preferences.theme = ["light", "dark", "midnight", "system"].includes(theme) ? theme : "system";
    const generation = ++themeGeneration;
    themeTransition?.skipTransition();
    themeTransition = null;
    const resolved = resolveTheme(preferences.theme);
    const isDarkLike = resolved === "dark" || resolved === "midnight";
    const apply = () => {
      // A skipped transition may still run its update callback. Only the latest
      // request may change the theme, accent, labels and desktop chrome.
      if (generation !== themeGeneration) return;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="color-scheme"]').content = isDarkLike ? "dark" : "light";
      document.body.classList.toggle("theme-dark", isDarkLike);
      document.body.classList.toggle("theme-midnight", resolved === "midnight");
      const themeName = { light: "Day", dark: "Night", midnight: "Midnight" }[resolved];
      const toggleLabel = `${themeName} theme. Switch to ${isDarkLike ? "Day" : "Night"} theme`;
      els.themeToggle.setAttribute("aria-label", toggleLabel);
      els.themeToggle.dataset.tooltip = toggleLabel;
      applyStudioAppearance();
      $$(".theme-swatch").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.themeChoice === preferences.theme);
      });
      desktopActions.syncDesktopState(true);
      ribbonActions.syncRibbon();
    };
    if (animate && !prefersReducedMotion() && document.startViewTransition && document.documentElement.dataset.theme !== resolved) {
      themeTransition = document.startViewTransition(apply);
      // Interruption is expected when the user changes themes quickly.
      themeTransition.ready.catch(() => {});
    } else {
      apply();
    }
    fileActions.persistPrefs();
  }
  function applyStudioAppearance() {
    const resolved = resolveTheme(preferences.theme);
    const isDarkLike = resolved === "dark" || resolved === "midnight";
    const accent = ACCENT_THEMES[preferences.accentColor] || ACCENT_THEMES.cobalt;
    const palette = isDarkLike ? accent.dark : accent.light;
    const docStyle = document.documentElement.style;
    docStyle.setProperty("--brand", palette.brand);
    docStyle.setProperty("--brand-hover", palette.hover);
    docStyle.setProperty("--brand-pressed", palette.pressed);
    docStyle.setProperty("--brand-soft", palette.soft);
    docStyle.setProperty("--brand-soft-2", palette.soft2);
    const tintKey = PAPER_TINTS[preferences.paperTint] ? preferences.paperTint : "ivory";
    const tint = PAPER_TINTS[tintKey];
    if (resolved === "midnight" && tintKey === "ivory") {
      docStyle.setProperty("--paper", "#14161b");
      docStyle.setProperty("--paper-ink", "#e8eaed");
      docStyle.setProperty("--paper-edge", "rgba(255, 255, 255, 0.12)");
    } else if (tintKey === "ivory" && resolved === "dark") {
      docStyle.setProperty("--paper", "#f4f1ea");
      docStyle.setProperty("--paper-ink", "#181714");
      docStyle.setProperty("--paper-edge", "rgba(0, 0, 0, 0.4)");
    } else {
      docStyle.setProperty("--paper", tint.paper);
      docStyle.setProperty("--paper-ink", tint.ink);
      docStyle.setProperty("--paper-edge", tint.edge);
    }
    document.body.dataset.paperTint = tintKey;
    document.body.dataset.density = preferences.uiDensity || "comfortable";
    document.body.dataset.typewriter =
      preferences.typewriterMode || (preferences.typewriterScroll ? "line" : "off");
    document.body.classList.toggle("no-ambient", !preferences.ambientGlow);
    document.body.classList.toggle("reduce-motion", Boolean(preferences.reducedMotionPref));
    if (els.editor) {
      els.editor.classList.toggle("no-active-highlight", !preferences.highlightActiveLine);
      els.editor.spellcheck = preferences.spellcheck !== false;
      $$(".para", els.editor).forEach((el) => {
        el.spellcheck = preferences.spellcheck !== false;
      });
    }
  }
  function syncPrefsUI() {
    const fontSelect = $("#fontSelect");
    if (fontSelect) fontSelect.value = normalizeScriptFont(preferences.font);    const fontSize = $("#fontSize");
    if (fontSize) fontSize.value = String(preferences.fontSize);
    pageActions.syncDocumentFontControls();
    const invisiblesToggle = $("#invisiblesToggle");
    if (invisiblesToggle) {
      invisiblesToggle.classList.toggle("is-on", preferences.showInvisibles);
      invisiblesToggle.setAttribute("aria-checked", String(preferences.showInvisibles));
    }
    const guidesToggle = $("#guidesToggle");
    if (guidesToggle) {
      guidesToggle.classList.toggle("is-on", preferences.showGuides);
      guidesToggle.setAttribute("aria-checked", String(preferences.showGuides));
    }
    if (els.sceneNumbersToggle) {
      els.sceneNumbersToggle.classList.toggle("is-on", documentSession.doc.settings.sceneNumbers);
      els.sceneNumbersToggle.setAttribute("aria-checked", String(documentSession.doc.settings.sceneNumbers));
    }
    if (els.readRate) els.readRate.value = String(preferences.readRate);
    $$(".theme-swatch").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.themeChoice === preferences.theme);
    });
  }
  function applyPageMetrics() {
    const page = documentSession.doc.page;
    const root = els.paper;
    const spacing = LINE_SPACING_OPTIONS[preferences.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    root.style.setProperty("--page-w", `${page.width}in`);
    root.style.setProperty("--page-h", `${page.height}in`);
    root.style.setProperty("--page-top", `${page.top}in`);
    root.style.setProperty("--page-bottom", `${page.bottom}in`);
    root.style.setProperty("--script-font", scriptFontStack(preferences.font));    root.style.setProperty("--script-size", `${preferences.fontSize}pt`);
    root.style.setProperty("--script-line-height", spacing.css);
    els.paperTitle.textContent = (documentSession.doc.title || "Untitled Screenplay").toUpperCase();
    els.paperPage.textContent = documentSession.doc.settings.pageNumbers !== false ? "1." : "";
    els.paperWords.textContent = `${getStats(documentSession.doc).words} words`;
    els.pageWidth.value = page.width;
    els.pageHeight.value = page.height;
    els.pageTop.value = page.top;
    els.pageBottom.value = page.bottom;
    els.paper.classList.toggle("has-guides", preferences.showGuides);
    els.paper.classList.toggle("has-invisibles", preferences.showInvisibles);
    els.paper.classList.toggle("show-scene-numbers", documentSession.doc.settings.sceneNumbers);
    els.paper.dataset.sceneNumberSide = documentSession.doc.settings.sceneNumberSide || "both";
    els.editor.dataset.sceneNumberSide = documentSession.doc.settings.sceneNumberSide || "both";
    els.editor.classList.toggle("no-active-highlight", !preferences.highlightActiveLine);
    $$(".page-card").forEach((card) => {
      card.style.setProperty("--script-font", scriptFontStack(preferences.font));      card.style.setProperty("--script-size", `${preferences.fontSize}pt`);
      card.style.setProperty("--script-line-height", spacing.css);
    });
  }
  function fitPaper() {
    const wasFlow = workspaceState.flow;
    workspaceState.flow = window.matchMedia("(max-width: 520px)").matches;
    if (wasFlow !== workspaceState.flow) $$(".para", els.editor).forEach(el => {
      const paragraph = documentSession.doc.paragraphs.find(p => p.id === el.dataset.id);
      if (paragraph) formatActions.applyParagraphVisuals(el, paragraph);
    });
    els.paper.classList.toggle("paper--flow", workspaceState.flow);
    if (workspaceState.flow) {
      workspaceState.fit = 1;
      applyZoom();
      return;
    }
    const container = workspaceState.mode === "page" ? els.pagePreview : els.paperScroll;
    const available = Math.max(280, (container && container.clientWidth ? container.clientWidth : 900) - 44);
    const base = documentSession.doc.page.width * 96;
    workspaceState.fit = clamp(available / base, 0.34, 1);
    applyZoom();
  }
  function applyZoom() {
    if (workspaceState.flow) {
      els.paper.style.zoom = "1";
      els.zoomLabel.textContent = "Fit";
      els.zoomLabel.title = "Reflowed for this screen";
      return;
    }
    const effective = preferences.zoom * workspaceState.fit;
    els.paper.style.zoom = String(effective);
    $$(".page-card").forEach((card) => {
      card.style.zoom = String(effective);
    });
    els.zoomLabel.textContent = `${Math.round(effective * 100)}%`;
    els.zoomLabel.title = workspaceState.fit < 1 ? "Auto-fit for this window" : "Zoom";
  }
  function setZoom(delta) {
    preferences.zoom = clamp(Math.round((preferences.zoom + delta) * 10) / 10, 0.6, 1.6);
    applyZoom();
    fileActions.persistPrefs();
  }
  // top-level rendering
  function renderAll() {
    document.body.classList.toggle("workspace-typography", preferences.typographyMode === "workspace");
    document.title = `${documentSession.doc.title || "Untitled Screenplay"} — Azkript`;
    els.docTitle.textContent = documentSession.doc.title || "Untitled Screenplay";
    els.scriptTitle.textContent = documentSession.doc.title || "Untitled Screenplay";
    els.documentPill = els.documentPill || $("#documentPill");
    if (els.documentPill) {
      els.documentPill.title = documentSession.filePath
        ? documentSession.filePath
        : isDesktop
          ? "Not yet saved to a file"
          : "Saved in this browser";
    }
    els.titleInput.value = documentSession.doc.title || "";
    els.authorInput.value = documentSession.doc.author || "";
    els.targetPagesInput.value = String(documentSession.doc.settings.targetPages);
    els.sceneNumbersToggle.classList.toggle("is-on", documentSession.doc.settings.sceneNumbers);
    els.sceneNumbersToggle.setAttribute("aria-checked", String(documentSession.doc.settings.sceneNumbers));
    editorActions.renderEditor();
    renderStatus();
    planningViews.renderScenes();
    renderMeta();
    planningViews.renderInspector();
    renderRevisionChrome();
    renderViewChrome();
    editorActions.renderOutlineAndRuler();
    if (workspaceState.splitView.enabled) editorActions.renderSplitPane();
    fileActions.updateSaveState();
    fileActions.updateHistoryButtons();
    if (workspaceState.view === "navigator") planningViews.renderNavigator();
    if (workspaceState.view === "beatboard") planningViews.renderBeatBoard();
    if (workspaceState.view === "characters") planningViews.renderCharacters();
    if (workspaceState.mode === "page") pageActions.renderPagePreview();
    seedStructureMeta();
    ribbonActions.syncRibbon();
    desktopActions.syncDesktopState();
  }
  function scenePageMap() {
    const layout = pageActions.getLayout();
    const map = new Map();
    for (const page of layout.pages) {
      if (page.kind !== "script") continue;
      for (const block of page.blocks) {
        if (block.kind === "paragraph" && block.type === "Scene Heading" && block.scene) {
          map.set(block.scene.id, page.number);
        }
      }
    }
    return map;
  }
  function renderMeta() {
    const layout = pageActions.getLayout();
    const stats = getStats(documentSession.doc);
    const pages = layout.scriptPageCount;
    if (els.documentPill) {
      els.documentPill.title = documentSession.filePath
        ? documentSession.filePath
        : isDesktop
          ? "Not yet saved to a file"
          : "Saved in this browser";
    }
    els.metaScenes.textContent = `${stats.scenes} ${stats.scenes === 1 ? "scene" : "scenes"}`;
    els.metaPages.textContent = `${pages} ${pages === 1 ? "page" : "pages"}`;
    const when = documentSession.dirty
      ? "Unsaved changes"
      : documentSession.lastSaved
        ? `Saved ${formatTime(documentSession.lastSaved)}`
        : isDesktop && !documentSession.filePath
          ? "New draft"
          : "Edited just now";
    els.metaEdited.textContent = when;
  }
  function renderStatus() {
    const layout = pageActions.getLayout();
    const stats = getStats(documentSession.doc);
    const pages = layout.scriptPageCount;
    els.statusWords.textContent = `${stats.words.toLocaleString()} words`;
    els.statusScenes.textContent = `${stats.scenes} ${stats.scenes === 1 ? "scene" : "scenes"}`;
    els.statusPages.textContent = pageActions.getLayoutError() ? "Layout unavailable" : `${pages} ${pages === 1 ? "page" : "pages"}`;
    els.statusRead.textContent = `${stats.readingMinutes} min read`;
    els.statusMode.textContent = workspaceState.mode === "page" ? "Page view" : "Screenplay";
    els.panelPages.textContent = pages;
    const target = Math.max(1, documentSession.doc.settings.targetPages);
    els.panelProgress.style.width = `${clamp((pages / target) * 100, 4, 100)}%`;
    els.panelProgress.title = `${pages} of ${target} target pages`;
    els.panelFootNote.textContent = isDesktop
      ? "Recovery is automatic. Save to write an FDX file."
      : "Autosaved locally. Export to FDX at any time.";    els.paperPage.textContent = documentSession.doc.settings.pageNumbers !== false ? "1." : "";
    els.paperWords.textContent = `${stats.words.toLocaleString()} words`;
    els.statusLocation.innerHTML = `${isDesktop ? "Desktop" : "Local"}${documentSession.fileName ? ` · ${escapeHtml(documentSession.fileName)}` : ""}`;
    const entry = revisionEntry(documentSession.doc, documentSession.doc.revision.current);
    els.statusRevision.textContent = `Rev ${documentSession.doc.revision.current} · ${documentSession.doc.revision.enabled ? "On" : "Off"}`;
    els.statusRevision.style.color = documentSession.doc.revision.enabled ? entry.hex : "";
    pageActions.renderPageDock();
  }
  function renderInsights() {
    const stats = getStats(documentSession.doc);
    const pages = pageActions.pageCount();
    const rows = [
      ["Words", stats.words.toLocaleString()],
      ["Pages", pages],
      ["Scenes", stats.scenes],
      ["Locations", stats.locations],
      ["Speaking roles", stats.characters],
      ["Revised blocks", stats.revised],
      ["Reading time", `${stats.readingMinutes} min`],
    ];
    els.insightList.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="insight-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`,
      )
      .join("");
    const target = Math.max(1, documentSession.doc.settings.targetPages);
    const pace = clamp(Math.round((pages / target) * 100), 4, 100);
    els.paceFill.style.width = `${pace}%`;
    els.paceCopy.textContent =
      pages < Math.max(2, target * 0.25)
        ? "A short read. The story is still finding its rhythm."
        : pages > target * 0.9
          ? "A full draft. Start a revision pass for pace and clarity."
          : "A balanced read. The current draft moves cleanly.";
  }
  function renderViewChrome() {
    $$(".rail__item[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === workspaceState.view);
    });
    $$("#viewSegmented .segmented__item").forEach((button) => {
      const active = button.dataset.mode === workspaceState.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$(".inspector-tab").forEach((button) => {
      const active = button.dataset.tab === workspaceState.inspectorTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    ribbonActions.updateRailIndicator();
    ribbonActions.syncRibbon();
    $$(".inspector-pane").forEach((pane) => {
      const show = pane.dataset.tabPanel === workspaceState.inspectorTab;
      pane.hidden = !show;
      pane.classList.toggle("is-active", show);
    });
  }
  function renderRevisionChrome() {
    const revision = documentSession.doc.revision || { enabled: false, current: 1, history: [] };
    const entry = revisionEntry(documentSession.doc, revision.current);
    const revised = documentSession.doc.paragraphs.filter((paragraph) => paragraph.revision).length;
    document.body.classList.toggle("revision-on", revision.enabled);
    els.revisionSwatch.style.background = entry.hex;
    els.revisionLabel.textContent = `Rev ${revision.current}`;
    els.revisionButton.classList.toggle("is-on", revision.enabled);
    els.revisionButton.style.setProperty("--revision-color", entry.hex);
    els.revisionButton.title = revision.enabled
      ? `${entry.name} revision mode is on. ${revised} revised blocks.`
      : `${entry.name} revision. Revision mode is off.`;
    els.metaRevision.hidden = !revision.enabled && !revised;
    els.metaRevisionText.textContent = revision.enabled
      ? `${entry.name} revision · ${plural(revised, "block")} marked`
      : `${entry.name} revision · hidden`;
    els.metaRevision.style.setProperty("--revision-color", entry.hex);
    if (els.revisionMini) {
      els.revisionMini.innerHTML = `
        <div class="revision-mini__row">
          <span class="revision-mini__swatch" style="background:${entry.hex}"></span>
          <div><strong>Rev ${revision.current} · ${escapeHtml(entry.name)}</strong><span>${revised} revised block${revised === 1 ? "" : "s"} · ${revision.enabled ? "active" : "hidden"}</span></div>
          <button class="switch ${revision.enabled ? "is-on" : ""}" type="button" data-revision-toggle role="switch" aria-label="Revision mode" aria-checked="${revision.enabled}"><span></span></button>
        </div>`;
    }
    if (els.statusRevision) {
      els.statusRevision.style.color = revision.enabled ? entry.hex : "";
    }
  }
  /* ---------- view -------------------------------------------------- */
  function toggleOutlineInScript() {
    preferences.showOutlineInScript = preferences.showOutlineInScript === false;
    editorActions.renderOutlineAndRuler();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Outline in script", preferences.showOutlineInScript ? "Outline timeline is visible inside the script." : "Outline timeline is hidden inside the script.", "info", 2000);
  }
  function toggleStructureLines() {
    preferences.showStructureLines = !preferences.showStructureLines;
    editorActions.decorateEditor();
    seedStructureMeta();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Structure lines", preferences.showStructureLines ? "Scene structure metadata is visible." : "Structure metadata is hidden.", "info", 2000);
  }
  function seedStructureMeta() {
    const scenes = getScenes(documentSession.doc);
    scenes.forEach((scene) => {
      const el = editorActions.paragraphElement(scene.id);
      if (!el) return;
      const parts = [scene.title, scene.synopsis, scene.omit ? "Omitted" : ""].filter(Boolean);
      el.dataset.structure = parts.join("  ·  ") || "Scene structure";
    });
  }
  function toggleAltBadges() {
    editorState.showAlts = !editorState.showAlts;
    editorActions.decorateEditor();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Alt dialogue badges", editorState.showAlts ? "Alternate takes are visible in the script." : "Alternate takes are hidden.", "info", 1800);
  }
  function toggleScriptNoteVisibility() {
    preferences.hideScriptNotes = !preferences.hideScriptNotes;
    editorActions.decorateEditor();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("ScriptNotes", preferences.hideScriptNotes ? "ScriptNote badges are hidden." : "ScriptNote badges are visible.", "info", 1800);
  }
  function toggleInvisibles() {
    preferences.showInvisibles = !preferences.showInvisibles;
    if (els.paper) els.paper.classList.toggle("has-invisibles", preferences.showInvisibles);
    if (els.editor) els.editor.classList.toggle("has-invisibles", preferences.showInvisibles);
    fileActions.persistPrefs();
    syncPrefsUI();
    ribbonActions.syncRibbon();
  }
  function toggleNavigatorPanel() {
    preferences.navigatorVisible = preferences.navigatorVisible === false;
    const panel = els.scenesPanel;
    if (panel) panel.hidden = !preferences.navigatorVisible;
    const workspace = $(".workspace");
    if (workspace) workspace.classList.toggle("no-navigator", !preferences.navigatorVisible);
    requestAnimationFrame(() => fitPaper());
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Navigator", preferences.navigatorVisible ? "Scene navigator shown." : "Scene navigator hidden. Toggle it again in View.", "info", 1800);
  }
  function cycleOutlineZoom() {
    workspaceState.outlineZoom = workspaceState.outlineZoom >= 1.8 ? 1 : workspaceState.outlineZoom >= 1.4 ? 1.8 : 1.4;
    editorActions.renderOutlineAndRuler();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Zoom Outline", `Outline editor at ${Math.round(workspaceState.outlineZoom * 100)}%.`, "info", 1800);
  }
  function openArrangeDocumentsDialog() {
    modalActions.openDialog({
      eyebrow: "View · Window",
      title: "Arrange the workspace",
      body: `
        <p class="dialog-note">Azkript edits one screenplay per window. These arrangements restore the reference layouts you can use while writing.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <button type="button" class="shortcut-row" data-arrange="script" style="border:0;background:transparent;text-align:left"><span>${icon("script")} Script only</span><strong>Focus the page</strong></button>
          <button type="button" class="shortcut-row" data-arrange="vertical" style="border:0;background:transparent;text-align:left"><span>${icon("split")} Script + reference — vertical</span><strong>Side by side</strong></button>
          <button type="button" class="shortcut-row" data-arrange="horizontal" style="border:0;background:transparent;text-align:left"><span>${icon("split-h")} Script + reference — horizontal</span><strong>Stacked</strong></button>
          <button type="button" class="shortcut-row" data-arrange="focus" style="border:0;background:transparent;text-align:left"><span>${icon("focus")} Focus mode</span><strong>Hide the chrome</strong></button>
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-arrange]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.arrange;
        modalActions.closeDialog();
        if (mode === "script") {
          editorActions.toggleSplitView(false);
          setView("script");
        } else if (mode === "vertical") {
          editorActions.toggleSplitView(true, "vertical");
        } else if (mode === "horizontal") {
          editorActions.toggleSplitView(true, "horizontal");
        } else if (mode === "focus") {
          if (!document.body.classList.contains("focus-mode")) toggleFocus();
        }
      });
    });
  }
  async function openOpenDocumentsDialog() {
    const recents = isDesktop && desktop ? await desktop.recent().catch(() => []) : [];
    const rows = (recents || [])
      .map(
        (item) => `<button type="button" class="shortcut-row" data-open-recent="${escapeHtml(item.path)}" style="border:0;background:transparent;text-align:left;width:100%"><span>${icon("file")} ${escapeHtml(item.name || item.path)}</span><strong>${escapeHtml(item.title || "Screenplay")}</strong></button>`,
      )
      .join("");
    modalActions.openDialog({
      eyebrow: "View · Window",
      title: "Open Documents",
      body: rows
        ? `<div class="shortcut-grid" style="grid-template-columns:1fr">${rows}</div>`
        : `<p class="dialog-note">No recent documents yet. Open an FDX file from the File tab, or start from the Start Center.</p>`,
      actions: [
        { label: "Start Center", onClick: () => { modalActions.closeDialog(); desktopActions.showStartCenter(); } },
        { label: "Close", kind: "primary" },
      ],
    });
    $$("[data-open-recent]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", async () => {
        const path = button.dataset.openRecent;
        if (!path || !desktop) return;
        modalActions.closeDialog();
        const file = await desktop.readFile(path);
        if (file && file.contents) {
          await fileActions.handleOpenDocument({ ...file, path: file.path || path });
        }
      });
    });
  }
  function setTypewriterMode(mode) {
    const value =
      typeof mode === "boolean"
        ? mode
          ? "line"
          : "off"
        : ["off", "frame", "line"].includes(mode)
          ? mode
          : "off";
    preferences.typewriterMode = value;
    preferences.typewriterScroll = value !== "off";
    document.body.dataset.typewriter = value;
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast(
      "Typewriter mode",
      value === "off"
        ? "Free scrolling restored."
        : value === "frame"
          ? "The writing frame stays centered while the script scrolls."
          : "The active line stays vertically centered.",
      "info",
      2000,
    );
  }
  function normalizeProfile() {
    const profile = preferences.profile || {};
    const name = String(profile.name || "Local Writer").trim();
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "LW";
    return { name, initials, role: String(profile.role || "Writer") };
  }
  function applyProfile() {
    const profile = normalizeProfile();
    preferences.profile = profile;
    const avatar = els.avatar;
    if (avatar) {
      avatar.textContent = profile.initials;
      avatar.title = `${profile.name} · ${profile.role}`;
    }
    fileActions.persistPrefs();
  }
  // views, panels, focus mode
  const viewTransitionTimers = new WeakMap();
  function setView(view) {
    if (!["script", "sceneview", "navigator", "beatboard", "characters", "reports"].includes(view)) return;
    editorActions.hideSmartType();
    const changed = workspaceState.view !== view;
    if (!changed) return;
    const prevView = workspaceState.view;
    const animate = !prefersReducedMotion();
    workspaceState.view = view;
    $$(".view").forEach((panel) => {
      clearTimeout(viewTransitionTimers.get(panel));
      const active = panel.dataset.viewPanel === view;
      const outgoing = panel.dataset.viewPanel === prevView;
      panel.inert = !active;
      if (active) {
        panel.hidden = false;
        panel.classList.add("is-active");
        panel.classList.remove("is-exiting");
        /* Restart the ONE entrance animation. `is-active` deliberately carries no
         * animation of its own (see the note in styles.css): the transition lives only
         * on `is-entering`, so it runs once and then stops when the class is dropped.
         * Adding a second animated class here is what previously made every view change
         * animate twice, ~350ms apart. */
        panel.classList.remove("is-entering");
        if (animate) {
          void panel.offsetWidth;
          panel.classList.add("is-entering");
          viewTransitionTimers.set(panel, setTimeout(() => panel.classList.remove("is-entering"), 360));
        }
      } else if (outgoing && animate) {
        panel.classList.remove("is-entering");
        panel.classList.add("is-exiting");
        viewTransitionTimers.set(panel, setTimeout(() => {
          if (panel.dataset.viewPanel !== workspaceState.view) {
            panel.hidden = true;
            panel.classList.remove("is-active", "is-exiting");
          }
        }, 140));
      } else {
        panel.hidden = true;
        panel.classList.remove("is-active", "is-entering", "is-exiting");
      }
    });
    if (view === "sceneview") planningViews.renderSceneView();
    if (view === "navigator") planningViews.renderNavigator();
    if (view === "beatboard") planningViews.renderBeatBoard();
    if (view === "characters") planningViews.renderCharacters();
    if (view === "reports") planningViews.renderReports();
    renderViewChrome();
    if (view === "script") {
      requestAnimationFrame(() => {
        fitPaper();
        planningViews.updateActiveSceneFromScroll();
      });
    }
  }
  function setMode(mode) {
    if (!["write", "page", "speed"].includes(mode)) return;
    editorActions.hideSmartType();
    workspaceState.mode = mode;
    const write = mode !== "page";
    els.paperScroll.hidden = !write;
    els.pagePreview.hidden = write;
    els.editorWatermark.textContent = mode === "page" ? "PAGE" : mode === "speed" ? "SPEED" : "WRITE";
    els.paperScroll.parentElement.classList.toggle("is-page-mode", !write);
    document.body.classList.toggle("page-mode", !write);
    if (els.editor) els.editor.classList.toggle("speed-view-on", mode === "speed");
    if (!write) pageActions.renderPagePreview();
    if (write) {
      requestAnimationFrame(() => {
        fitPaper();
        planningViews.updateActiveSceneFromScroll();
      });
    }
    renderViewChrome();
    pageActions.renderPageDock();
    renderStatus();
    fileActions.persistPrefs();
  }
  function toggleInspector(force) {
    const inspector = $(".inspector");
    if (inspector) inspector.inert = false;
    /* Match the CSS breakpoint that turns the inspector into a drawer
     * (styles.css / styles-ribbon.css both switch at 1200px). Using 1080px here
     * meant that between 1080 and 1199px — including the app's own minimum
     * window width — the desktop branch toggled a class on a `display: none`
     * element and the button appeared dead. */
    if (window.matchMedia("(max-width: 1200px)").matches) {
      const open =
        typeof force === "boolean" ? force : !els.workspace.classList.contains("inspector-open");
      els.workspace.classList.toggle("inspector-open", open);
    } else {
      const closed =
        typeof force === "boolean"
          ? !force
          : !els.appShell.classList.contains("inspector-closed");
      els.appShell.classList.toggle("inspector-closed", closed);
    }
    requestAnimationFrame(() => {
      if (workspaceState.mode !== "page") fitPaper();
    });
  }
  function toggleRail() {
    const collapsed = !document.body.classList.contains("rail-collapsed");
    document.body.classList.toggle("rail-collapsed", collapsed);
    if (els.appShell) els.appShell.classList.toggle("rail-collapsed", collapsed);
    requestAnimationFrame(() => {
      if (workspaceState.mode !== "page") fitPaper();
      const activeRail = $(".rail__item[data-view].is-active");
      if (activeRail && els.railIndicator) {
        els.railIndicator.style.transform = `translateX(${activeRail.offsetLeft}px)`;
        els.railIndicator.style.width = `${activeRail.offsetWidth}px`;
      }
    });
  }
  function toggleFocus() {
    const focus = !document.body.classList.contains("focus-mode");
    document.body.classList.toggle("focus-mode", focus);
    els.focusToggle.classList.toggle("is-active", focus);
    let exit = $(".focus-exit");
    if (focus && !exit) {
      exit = document.createElement("button");
      exit.className = "focus-exit";
      exit.type = "button";
      exit.innerHTML = `${icon("arrow-left")} Exit focus`;
      exit.addEventListener("click", toggleFocus);
      document.body.appendChild(exit);
    }
    if (exit) exit.hidden = !focus;
    if (focus) {
      requestAnimationFrame(() => fitPaper());
      modalActions.toast("Focus mode", "Chrome hidden. Press Esc or the exit button to return.", "info", 2400);
    }
  }
  function applyInterfaceScale() {
    const native = Boolean(desktop?.setInterfaceScale);
    const scale = native ? 1 : preferences.uiScale;
    document.documentElement.style.zoom = String(scale);
    document.body.style.setProperty("--interface-scale", String(scale));
    document.body.style.setProperty("--interface-viewport-height", `${window.innerHeight / scale}px`);
    document.body.classList.toggle("scaled-interface", scale !== 1);
    document.body.classList.toggle("scaled-compact", window.innerWidth / scale < 1100 && scale !== 1);
    if (native) desktop.setInterfaceScale(preferences.uiScale).catch(error => modalActions.toast("Interface scale unavailable", error.message, "error"));
  }
  function updateWindowStateSoon() {
    desktopActions.syncDesktopState();
  }
  return {
    SCENE_ANCHOR_FRACTION,
    applyInterfaceScale,
    applyPageMetrics,
    applyProfile,
    applyStudioAppearance,
    applyTheme,
    applyZoom,
    cycleOutlineZoom,
    fitPaper,
    normalizeProfile,
    openArrangeDocumentsDialog,
    openOpenDocumentsDialog,
    renderAll,
    renderInsights,
    renderMeta,
    renderRevisionChrome,
    renderStatus,
    renderViewChrome,
    resolveTheme,
    sceneAnchorOffset,
    scenePageMap,
    seedStructureMeta,
    setMode,
    setTypewriterMode,
    setView,
    setZoom,
    syncPrefsUI,
    finishThemeTransition,
    toggleAltBadges,
    toggleFocus,
    toggleInspector,
    toggleInvisibles,
    toggleNavigatorPanel,
    toggleOutlineInScript,
    toggleRail,
    toggleScriptNoteVisibility,
    toggleStructureLines,
    toggleTheme,
    updateWindowStateSoon
  };
};
