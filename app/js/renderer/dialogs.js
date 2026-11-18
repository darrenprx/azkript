"use strict";

window.AzkriptRenderer.modalActions = function ({
  desktopActions,
  documentSession,
  editorActions,
  featurePanels,
  fileActions,
  findActions,
  interfaceState,
  pageActions,
  planningViews,
  preferences,
  productionActions,
  ribbonActions,
  settingsActions,
  shared,
  speechActions,
  workspaceLayout,
  writingTools,
}) {
  const { $, $$, clamp, els, escapeHtml, getScenes, icon, isDesktop, prefersReducedMotion } = shared;

  // dialogs, toasts, command palette
  const modalCloseTokens = new WeakMap();
  function invalidateModalClose(dialog) { modalCloseTokens.set(dialog, (modalCloseTokens.get(dialog) || 0) + 1); }
  function closeModalAnimated(dialog, callback) {
    if (!dialog || !dialog.open) {
      if (callback) callback();
      return;
    }
    const token = (modalCloseTokens.get(dialog) || 0) + 1;
    modalCloseTokens.set(dialog, token);
    /* An interrupted close used to latch here forever: `is-closing` stayed on
     * the element, every later close returned early, and the dialog became
     * impossible to dismiss from the UI. Rather than bailing out, finish the
     * close immediately — it is always safer to let the user out. */
    if (dialog.classList.contains("is-closing")) {
      dialog.classList.remove("is-closing");
      try {
        dialog.close();
      } catch (_) {}
      if (callback) callback();
      return;
    }
    if (prefersReducedMotion()) {
      dialog.close();
      if (callback) callback();
      return;
    }
    dialog.classList.add("is-closing");
    const duration = 180;
    setTimeout(() => {
      if (modalCloseTokens.get(dialog) !== token) return;
      dialog.classList.remove("is-closing");
      try {
        dialog.close();
      } catch (_) {}
      if (callback) callback();
    }, duration);
  }
  function closeDialog(callback) {
    closeModalAnimated(els.dialog, callback);
  }
  /* Wire a dialog switch so its visual state and its ARIA state move together.
  *
  * Six dialogs had a hand-rolled `sw.classList.toggle("is-on")` listener that
  * flipped the class but never touched `aria-checked`, so screen readers
  * announced the pre-click state forever (verified desync in Header/Footer and
  * Watermark). Routing every dialog switch through this helper makes the two
  * states impossible to separate.
  */  function bindDialogSwitch(id) {
    const sw = $(`#${id}`, els.dialogBody);
    if (!sw) return null;
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("is-on");
      sw.classList.toggle("is-on", next);
      sw.setAttribute("aria-checked", String(next));
    });
    return sw;
  }
  function closeCommandDialog(callback) {
    closeModalAnimated(els.commandDialog, callback);
  }
  /* Every openDialog() bumps this counter. An action handler that replaces the
   * dialog content (e.g. a confirm prompt opened from a settings dialog) is
   * detected by the generation changing underneath it, so the outer handler
   * must not close the dialog the inner one just opened. Before this, "Clear
   * local data" showed its confirmation for one frame and closed it again. */
  let dialogGeneration = 0;
  function getDialogGeneration() { return dialogGeneration; }
  function openDialog({ eyebrow, title, body, actions = [], wide = false }) {
    invalidateModalClose(els.dialog);
    editorActions.hideSmartType();
    dialogGeneration += 1;
    els.dialog.classList.remove("is-closing");
    els.dialog.classList.toggle("app-dialog--wide", Boolean(wide));
    els.dialogEyebrow.textContent = eyebrow || "Azkript";
    els.dialogTitle.textContent = title || "Dialog";
    els.dialogBody.innerHTML = body || "";
    // A switch's adjacent visible heading is not an accessible name. Bind
    // it explicitly before the dialog enters the platform accessibility tree.
    $$("[role='switch']", els.dialogBody).forEach((control, index) => {
      if (control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
      const row = control.closest(".setting-line, .toggle-row, .shortcut-row, .field");
      const label = row && (row.querySelector("strong") || row.querySelector(":scope > span"));
      if (!label || !label.textContent.trim()) return;
      if (!label.id) label.id = `dialog-switch-label-${dialogGeneration}-${index}`;
      control.setAttribute("aria-labelledby", label.id);
    });
    els.dialogActions.innerHTML = "";
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn${action.kind ? ` btn--${action.kind}` : ""}`;
      button.textContent = action.label;
      const generation = dialogGeneration;
      button.addEventListener("click", async () => {
        try {
          const result = action.onClick?.();
          /* The handler may have opened a follow-up dialog in this same
           * element. Only close if nothing replaced it. */
          if (!action.keepOpen && dialogGeneration === generation) closeDialog();
          if (result?.then) {
            button.disabled = true;
            try { await result; }
            finally { button.disabled = false; }
          }
        } catch (error) {
          toast("Action failed", error.message || String(error), "error");
        }
      });
      els.dialogActions.appendChild(button);
    });
    if (!els.dialog.open) els.dialog.showModal();
    requestAnimationFrame(() => {
      const first = els.dialogBody.querySelector("input, select, textarea, button");
      if (first) first.focus();
    });
  }
  function confirmAction(title, message, confirmLabel, onConfirm) {
    openDialog({
      eyebrow: "Please confirm",
      title,
      body: `<p>${escapeHtml(message)}</p><div class="dialog-note">${isDesktop ? "A recovery copy is kept while this window is open." : "Your current draft is autosaved in this browser."}</div>`,
      actions: [
        { label: "Cancel" },
        { label: confirmLabel, kind: "danger", onClick: onConfirm },
      ],
    });
  }
  function toast(title, message, type = "info", duration = 3800) {
    /* Cap the stack, removing overflow synchronously: dismissToast animates
       asynchronously, so a plain while-loop would spin forever. */
    while (els.toastStack.children.length >= 4) {
      const oldest = els.toastStack.firstElementChild;
      if (!oldest) break;
      oldest.remove();
    }
    const toastEl = document.createElement("div");
    toastEl.className = `toast toast--${type}`;
    toastEl.style.setProperty("--toast-duration", `${duration}ms`);
    const iconName =
      type === "success" ? "check" : type === "warning" || type === "error" ? "warning" : "sparkle";
    toastEl.innerHTML = `<span class="toast__icon">${icon(iconName)}</span><div class="toast__body"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div><span class="toast__progress"></span>`;
    toastEl.addEventListener("click", () => dismissToast(toastEl));
    els.toastStack.appendChild(toastEl);
    setTimeout(() => dismissToast(toastEl), duration);
  }
  function dismissToast(el) {
    if (!el || !el.isConnected || el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 260);
  }
  function commandActions() {
    const scenes = getScenes(documentSession.doc);
    const base = [
      { id: "compatibility", label: "Review FDX compatibility", group: "File", icon: "check-circle", run: fileActions.openCompatibilityInspector },
      { id: "native-metadata", label: "Edit native FDX metadata", group: "File", icon: "sliders", run: fileActions.openNativeMetadataEditor },
      { id: "history", label: "Version history and restore", group: "File", icon: "backup", run: fileActions.openVersionHistory },
      { id: "file-status", label: "Compare external file changes", group: "File", icon: "folder", run: fileActions.openFileStatus },
      { id: "writing-reliability", label: "Typography and accessibility", group: "View", icon: "sliders", run: writingTools.openWritingReliability },
      { id: "start", label: "Open Start Center", group: "File", icon: "sparkle", shortcut: "Ctrl Shift O", run: desktopActions.showStartCenter },
      { id: "new", label: "New screenplay", group: "File", icon: "plus", shortcut: "Ctrl N", run: fileActions.newDocument },
      { id: "open", label: "Open FDX file", group: "File", icon: "folder", shortcut: "Ctrl O", run: fileActions.openFilePicker },
      { id: "save", label: isDesktop ? "Save screenplay" : "Save locally", group: "File", icon: "save", shortcut: "Ctrl S", run: () => fileActions.saveDocument() },
      { id: "saveas", label: "Save as…", group: "File", icon: "save", shortcut: "Ctrl Shift S", run: () => fileActions.saveDocument({ saveAs: true }) },
      { id: "export", label: "Export as FDX", group: "File", icon: "download", shortcut: "", run: fileActions.exportFDX },
      { id: "pdf", label: "Export as PDF", group: "File", icon: "download", shortcut: "Ctrl Shift E", run: pageActions.exportPDF },
      { id: "print", label: "Print screenplay", group: "File", icon: "page", shortcut: "Ctrl P", run: pageActions.printDocument },
      { id: "undo", label: "Undo", group: "Edit", icon: "undo", shortcut: "Ctrl Z", run: fileActions.undo },
      { id: "redo", label: "Redo", group: "Edit", icon: "redo", shortcut: "Ctrl Y", run: fileActions.redo },
      { id: "find", label: "Find in screenplay", group: "Edit", icon: "search", shortcut: "Ctrl F", run: () => findActions.openFind("find") },
      { id: "replace", label: "Find and replace", group: "Edit", icon: "replace", shortcut: "Ctrl H", run: () => findActions.openFind("replace") },
      { id: "titlepage", label: "Edit title page", group: "Document", icon: "title", shortcut: "", run: productionActions.openTitlePage },
      { id: "pagesetup", label: "Page setup", group: "Document", icon: "page", shortcut: "", run: settingsActions.openPageSetup },
      { id: "revision", label: "Revision manager", group: "Document", icon: "revision", shortcut: "", run: productionActions.openRevisionManager },
      { id: "revision-toggle", label: documentSession.doc.revision.enabled ? "Turn off revision marks" : "Turn on revision marks", group: "Document", icon: "revision", shortcut: "Ctrl Alt V", run: productionActions.toggleRevisionMode },
      { id: "revision-next", label: "Start next revision", group: "Document", icon: "revision", shortcut: "Ctrl Alt N", run: productionActions.startNextRevision },
      { id: "read", label: "Start table read", group: "Tools", icon: "headphones", shortcut: "Ctrl Alt R", run: () => speechActions.openReadDock(false) },
      { id: "read-here", label: "Read from here", group: "Tools", icon: "headphones", shortcut: "", run: () => speechActions.openReadDock(true) },
      { id: "theme", label: `Switch to ${workspaceLayout.resolveTheme(preferences.theme) === "light" ? "dark" : "light"} theme`, group: "View", icon: workspaceLayout.resolveTheme(preferences.theme) === "light" ? "moon" : "sun", shortcut: "", run: workspaceLayout.toggleTheme },
      { id: "focus", label: "Toggle focus mode", group: "View", icon: "focus", shortcut: "Esc exits", run: workspaceLayout.toggleFocus },
      { id: "view-script", label: "Open script editor", group: "View", icon: "script", shortcut: "Ctrl 1", run: () => workspaceLayout.setView("script") },
      { id: "view-sceneview", label: "Open Scene View table", group: "View", icon: "table", shortcut: "", run: () => workspaceLayout.setView("sceneview") },
      { id: "view-cards", label: "Open index cards", group: "View", icon: "grid", shortcut: "Ctrl 2", run: () => workspaceLayout.setView("navigator") },
      { id: "view-beatboard", label: "Open Beat Board", group: "View", icon: "board", shortcut: "", run: () => workspaceLayout.setView("beatboard") },
      { id: "view-cast", label: "Open characters", group: "View", icon: "users", shortcut: "Ctrl 3", run: () => workspaceLayout.setView("characters") },
      { id: "view-reports", label: "Open reports", group: "View", icon: "chart", shortcut: "Ctrl 4", run: () => workspaceLayout.setView("reports") },
      { id: "write", label: "Switch to Normal / Write view", group: "View", icon: "script", shortcut: "", run: () => { workspaceLayout.setView("script"); workspaceLayout.setMode("write"); } },
      { id: "page", label: "Switch to Page preview", group: "View", icon: "page", shortcut: "Ctrl Alt P", run: () => { workspaceLayout.setView("script"); workspaceLayout.setMode("page"); } },
      { id: "speed", label: "Switch to Speed View", group: "View", icon: "eye", shortcut: "", run: () => { workspaceLayout.setView("script"); workspaceLayout.setMode("speed"); } },
      { id: "midnight", label: "Toggle Midnight Mode", group: "View", icon: "moon", shortcut: "", run: () => workspaceLayout.applyTheme(workspaceLayout.resolveTheme(preferences.theme) === "midnight" ? "light" : "midnight") },
      { id: "scene", label: "Add a new scene", group: "Script", icon: "scene", shortcut: "Ctrl Enter", run: editorActions.insertScene },
      { id: "scene-prev", label: "Previous scene", group: "Script", icon: "scene", shortcut: "Ctrl Alt ↑", run: () => editorActions.moveScene(-1) },
      { id: "scene-next", label: "Next scene", group: "Script", icon: "scene", shortcut: "Ctrl Alt ↓", run: () => editorActions.moveScene(1) },
      { id: "scene-details", label: "Edit current scene card", group: "Script", icon: "grid", shortcut: "Ctrl Shift D", run: productionActions.openSceneDetails },
      { id: "dual-dialogue", label: "Toggle dual dialogue", group: "Format", icon: "dual", shortcut: "Ctrl D", run: editorActions.toggleDualDialogue },
      { id: "alt-dialogue", label: "Manage Alt Dialogue takes", group: "Format", icon: "dual", shortcut: "", run: writingTools.openAltDialogueDialog },
      { id: "case-cycle", label: "Change paragraph case", group: "Format", icon: "case", shortcut: "", run: editorActions.cycleCase },
      { id: "element-settings", label: "Script Elements settings", group: "Format", icon: "sliders", shortcut: "", run: editorActions.openElementSettings },
      { id: "header-footer", label: "Header and Footer setup", group: "Document", icon: "page", shortcut: "", run: productionActions.openHeaderFooterDialog },
      { id: "mores", label: "Mores and Continueds", group: "Document", icon: "align", shortcut: "", run: productionActions.openMoresDialog },
      { id: "smarttype", label: "SmartType autocomplete lists", group: "Document", icon: "sparkle", shortcut: "", run: writingTools.openSmartTypeDialog },
      { id: "macros", label: "Keyboard Macros", group: "Document", icon: "macros", shortcut: "", run: writingTools.openMacrosDialog },
      { id: "bookmarks", label: "Bookmarks manager", group: "Document", icon: "bookmark", shortcut: "", run: () => writingTools.openBookmarksDialog(false) },
      { id: "watermark", label: "Page Watermark", group: "Document", icon: "water", shortcut: "", run: productionActions.openWatermarkDialog },
      { id: "script-note", label: "Insert or edit ScriptNote", group: "Insert", icon: "note", shortcut: "Ctrl Shift N", run: editorActions.openScriptNote },
      { id: "thesaurus", label: "Open Thesaurus", group: "Tools", icon: "book", shortcut: "Shift F7", run: editorActions.openThesaurus },
      { id: "spellcheck", label: "Spelling and proofing check", group: "Tools", icon: "check-circle", shortcut: "F7", run: editorActions.openSpellcheckDialog },
      { id: "names-db", label: "Character Names Database", group: "Tools", icon: "users", shortcut: "", run: writingTools.openNamesDatabaseDialog },
      { id: "highlight-chars", label: "Highlight Characters in Script", group: "Tools", icon: "highlight", shortcut: "", run: writingTools.openHighlightCharactersDialog },
      { id: "rename-char", label: "Rename Character Everywhere", group: "Tools", icon: "replace", shortcut: "", run: writingTools.openRenameCharacterDialog },
      { id: "script-compare", label: "ScriptCompare Draft Diff", group: "Tools", icon: "compare", shortcut: "", run: writingTools.openScriptCompareDialog },
      { id: "writing-stats", label: "Writing Tracker & Statistics", group: "Tools", icon: "chart", shortcut: "", run: writingTools.openWritingStatsDialog },
      { id: "sprint-timer", label: "Toggle Writing Sprint Timer", group: "Tools", icon: "timer", shortcut: "", run: () => writingTools.toggleSprintWidget() },
      { id: "tags-mode", label: "Production Breakdown Tags", group: "Production", icon: "tag", shortcut: "", run: writingTools.openTagsDialog },
      { id: "lock-pages", label: "Lock Pages / A-Pages", group: "Production", icon: "lock", shortcut: "", run: productionActions.openLockPagesDialog },
      { id: "outline-toggle", label: "Toggle Outline Editor timeline", group: "View", icon: "scene", shortcut: "", run: () => editorActions.toggleOutlineLayer() },
      { id: "ruler-toggle", label: "Toggle horizontal ruler", group: "View", icon: "ruler", shortcut: "", run: () => editorActions.toggleRulerLayer() },
      { id: "split-toggle", label: "Toggle split view", group: "View", icon: "split", shortcut: "", run: () => editorActions.toggleSplitView() },
      { id: "validate", label: "Run document check", group: "Tools", icon: "check", shortcut: "", run: productionActions.validateDocumentAction },
      { id: "outline", label: "Copy scene outline", group: "Tools", icon: "grid", shortcut: "", run: planningViews.copyOutline },
      { id: "report", label: "Copy full script report", group: "Tools", icon: "chart", shortcut: "", run: planningViews.copyReport },
      { id: "settings", label: "Open settings", group: "Tools", icon: "settings", shortcut: "", run: settingsActions.openSettings },
      { id: "help", label: "Keyboard shortcuts", group: "Tools", icon: "help", shortcut: "F1", run: settingsActions.openHelp },
    ];
    const sceneActions = scenes.map((scene, index) => ({
      id: `scene-${index}`,
      label: `Go to scene ${scene.number}: ${scene.heading}${scene.omit ? " (omitted)" : ""}`,
      group: "Scenes",
      icon: "scene",
      shortcut: `p.${scene.startPage}`,
      run: () => planningViews.goToScene(scene),
    }));
    const ribbonPalette = [];
    const seenLabels = new Set(base.map((command) => command.label.toLowerCase()));
    const walkRibbon = (items) => {
      (items || []).forEach((item) => {
        if (!item) return;
        if (item.kind === "col") {
          walkRibbon(item.items);
          return;
        }
        if (!item.command || !item.label) return;
        if (seenLabels.has(item.label.toLowerCase())) return;
        seenLabels.add(item.label.toLowerCase());
        ribbonPalette.push({
          id: `ribbon-${item.command}`,
          label: item.label,
          group: "Ribbon",
          icon: item.icon || "sparkle",
          shortcut: "",
          run: () => ribbonActions.runRibbonCommand(item.command),
        });
      });
    };
    ribbonActions.RIBBON_TAB_DEFS.forEach((tab) => {
      (ribbonActions.RIBBON_MODEL[tab.id] || []).forEach((group) => {
        (group.rows || []).forEach((row) => walkRibbon(row));
      });
    });
    return [...(featurePanels.storyUI?.commands() || []), ...(featurePanels.productionUI?.commands() || []), ...(featurePanels.workspaceUI?.commands() || []), ...base, ...ribbonPalette, ...sceneActions];
  }
  function openCommandPalette() {
    invalidateModalClose(els.commandDialog);
    interfaceState.commands = commandActions();
    interfaceState.commandIndex = 0;
    els.commandInput.value = "";
    renderCommandList("");
    els.commandDialog.classList.remove("is-closing");
    if (!els.commandDialog.open) els.commandDialog.showModal();
    requestAnimationFrame(() => els.commandInput.focus());
  }
  function renderCommandList(query) {
    const q = query.trim().toLowerCase();
    const filtered = interfaceState.commands
      .filter((command) => `${command.label} ${command.group}`.toLowerCase().includes(q))
      .slice(0, 20);
    interfaceState.commandListItems = filtered;
    interfaceState.commandIndex = clamp(interfaceState.commandIndex, 0, Math.max(0, filtered.length - 1));
    els.commandList.innerHTML = "";
    if (!filtered.length) {
      els.commandInput.removeAttribute("aria-activedescendant");
      els.commandList.innerHTML = `<div class="scene-list__empty">${icon("search")}<span>No commands match “${escapeHtml(query)}”.</span></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `command-item${index === interfaceState.commandIndex ? " is-selected" : ""}`;
      button.setAttribute("role", "option");
      button.id = `command-option-${index}`;
      button.setAttribute("aria-selected", String(index === interfaceState.commandIndex));
      button.style.setProperty("--i", String(index));
      button.innerHTML = `${icon(command.icon || "sparkle")}<span>${escapeHtml(command.label)}</span>${command.shortcut ? `<small>${escapeHtml(command.shortcut)}</small>` : ""}`;
      button.addEventListener("click", () => runCommand(command));
      button.addEventListener("pointermove", () => {
        if (interfaceState.commandIndex === index) return;
        selectCommand(index);
      });
      fragment.appendChild(button);
    });
    els.commandList.appendChild(fragment);
    els.commandInput.setAttribute("aria-activedescendant", `command-option-${interfaceState.commandIndex}`);
  }
  function selectCommand(index, scroll = false) {
    const items = els.commandList.children;
    const count = (interfaceState.commandListItems || []).length;
    if (!count) return;
    const previous = items[interfaceState.commandIndex];
    interfaceState.commandIndex = clamp(index, 0, count - 1);
    const selected = items[interfaceState.commandIndex];
    if (previous !== selected) {
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-selected", "false");
      selected.classList.add("is-selected");
      selected.setAttribute("aria-selected", "true");
    }
    els.commandInput.setAttribute("aria-activedescendant", selected.id);
    if (scroll) selected.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  function runCommand(command) {
    if (!command) return;
    closeCommandDialog(() => {
      command.run();
    });
  }
  function onCommandKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectCommand(interfaceState.commandIndex + 1, true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectCommand(interfaceState.commandIndex - 1, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand((interfaceState.commandListItems || [])[interfaceState.commandIndex]);
    }
  }
  // tooltip portal
  /* Tooltips are delegated from a single fixed-position layer rather than
   * drawn with ::after on each trigger. A pseudo-element is confined to its
   * trigger's overflow context, so every tooltip inside the ribbon deck, the
   * navigator or the inspector was clipped by that container's `overflow:
   * hidden` — the ribbon cut the text in half. A portal cannot be clipped.
   *
   * Placement prefers below the trigger and flips above when there is no room,
   * then clamps horizontally so a tooltip near a window edge stays on screen. */
  const TOOLTIP_OFFSET = 8;
  const TOOLTIP_EDGE = 8;
  function ensureTooltipLayer() {
    let layer = document.getElementById("tooltipLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "tooltipLayer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    return layer;
  }
  function hideTooltip() {
    clearTimeout(interfaceState.tooltipTimer);
    interfaceState.tooltipTimer = null;
    if (interfaceState.tooltipEl) {
      interfaceState.tooltipEl.classList.remove("is-visible");
    }
    interfaceState.tooltipTrigger = null;
  }
  function placeTooltip(trigger, text) {
    const layer = ensureTooltipLayer();
    let tip = interfaceState.tooltipEl;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "app-tooltip";
      tip.setAttribute("role", "tooltip");
      layer.appendChild(tip);
      interfaceState.tooltipEl = tip;
    }
    tip.textContent = text;
    tip.classList.remove("is-visible");
    /* Measure after content is set but before positioning, so a long label can
     * wrap (up to max-width) and still be placed correctly. */
    const rect = trigger.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const side = spaceBelow < th + TOOLTIP_OFFSET + TOOLTIP_EDGE && rect.top > th + TOOLTIP_OFFSET
      ? "above"
      : "below";
    tip.dataset.side = side;
    let top = side === "above" ? rect.top - th - TOOLTIP_OFFSET : rect.bottom + TOOLTIP_OFFSET;
    top = Math.max(TOOLTIP_EDGE, Math.min(top, window.innerHeight - th - TOOLTIP_EDGE));
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(TOOLTIP_EDGE, Math.min(left, window.innerWidth - tw - TOOLTIP_EDGE));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    interfaceState.tooltipTrigger = trigger;
    /* Force a reflow so the transition runs from the hidden state. */
    void tip.offsetWidth;
    tip.classList.add("is-visible");
  }
  function initTooltips() {
    /* A tooltip must never outlive its trigger's visibility. */
    const hideIfStale = () => {
      if (interfaceState.tooltipTrigger && !interfaceState.tooltipTrigger.isConnected) hideTooltip();
    };
    document.addEventListener("pointerover", (event) => {
      const trigger = event.target.closest ? event.target.closest("[data-tooltip]") : null;
      if (!trigger) return;
      const text = trigger.getAttribute("data-tooltip");
      if (!text || trigger === interfaceState.tooltipTrigger) return;
      clearTimeout(interfaceState.tooltipTimer);
      /* Small delay so sweeping across a toolbar does not flash tooltips. */
      interfaceState.tooltipTimer = setTimeout(() => {
        hideIfStale();
        if (!trigger.isConnected) return;
        placeTooltip(trigger, text);
      }, 320);
    });
    document.addEventListener("pointerout", (event) => {
      const trigger = interfaceState.tooltipTrigger;
      if (!trigger) return;
      if (trigger.contains(event.target) && !trigger.contains(event.relatedTarget)) {
        hideTooltip();
      }
    });
    /* Any interaction or navigation dismisses the tooltip immediately. */
    document.addEventListener("pointerdown", hideTooltip, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTooltip();
    }, true);
    document.addEventListener("focusin", (event) => {
      const trigger = event.target.closest ? event.target.closest("[data-tooltip]") : null;
      if (!trigger) hideTooltip();
    });
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("blur", hideTooltip);
    window.addEventListener("resize", hideTooltip);
  }
  return {
    bindDialogSwitch,
    closeCommandDialog,
    closeDialog,
    closeModalAnimated,
    confirmAction,
    getDialogGeneration,
    initTooltips,
    invalidateModalClose,
    onCommandKeyDown,
    openCommandPalette,
    openDialog,
    renderCommandList,
    toast
  };
};
