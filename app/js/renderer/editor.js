"use strict";

window.AzkriptRenderer.editorActions = function ({
  documentSession,
  editorState,
  fileActions,
  findActions,
  formatActions,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  ribbonActions,
  ribbonState,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
}) {
  const { $, $$, ELEMENTS, PALETTE, clamp, elementSpec, els, escapeHtml, escapeSelector, getCharacters, getScenes, makeParagraph, markRevision, nextType, paragraphText, prefersReducedMotion, revisionEntry, slug, stripHtml, tabType, uid } = shared;

  // editor
  function renderEditor() {
    const fragment = document.createDocumentFragment();
    for (const block of buildParagraphBlocks(documentSession.doc.paragraphs)) {
      fragment.appendChild(block);
    }
    els.editor.replaceChildren(fragment);
    editorState.composing = null;
    els.editor.classList.toggle("large-script", documentSession.doc.paragraphs.length > 600);
    if (editorState.pendingSelection) {
      const selection = editorState.pendingSelection;
      editorState.pendingSelection = null;
      FDCoreWriting.restoreSelection(els.editor, selection);
    }
    workspaceLayout.applyPageMetrics();
    decorateEditor();
    findActions.applyFindHighlights();
    syncFormatButtons();
  }
  function buildParagraphBlocks(paragraphs) {
    const blocks = [];
    let index = 0;
    while (index < paragraphs.length) {
      const paragraph = paragraphs[index];
      if (paragraph.dualGroup) {
        const group = [];
        while (
          index < paragraphs.length &&
          paragraphs[index].dualGroup === paragraph.dualGroup
        ) {
          group.push(paragraphs[index]);
          index += 1;
        }
        blocks.push(createDualBlock(group));
      } else {
        blocks.push(createParagraphElement(paragraph));
        index += 1;
      }
    }
    return blocks;
  }
  function splitDualColumns(group) {
    const columns = [];
    let current = [];
    for (const paragraph of group) {
      if (paragraph.type === "Character" && current.length) {
        columns.push(current);
        current = [];
      }
      current.push(paragraph);
    }
    if (current.length) columns.push(current);
    return columns;
  }
  function createDualBlock(group) {
    const block = document.createElement("div");
    block.className = "dual-block";
    block.dataset.dualGroup = group[0].dualGroup;
    const geometry = FDPagination.dualGeometry(documentSession.doc, pageActions.layoutOptions());
    block.style.width = `${geometry.widthInches}in`;
    block.style.marginLeft = `${geometry.leftInches}in`;
    const columns = splitDualColumns(group);
    for (const column of columns.slice(0, 2)) {
      const cell = document.createElement("div");
      cell.className = "dual-col";
      for (const paragraph of column) {
        cell.appendChild(createParagraphElement(paragraph));
      }
      block.appendChild(cell);
    }
    return block;
  }
  function createParagraphElement(paragraph) {
    const el = document.createElement("div");
    el.className = `para type-${slug(paragraph.type)}`;
    if (paragraph.dualGroup) {
      el.classList.add("is-dual");
      el.dataset.dualSide = String(paragraph.dualSide ?? 0);
      el.dataset.dualGroup = paragraph.dualGroup;
    }
    el.dataset.id = paragraph.id;
    el.dataset.type = paragraph.type;
    el.dataset.placeholder = elementSpec(paragraph.type).placeholder;
    el.contentEditable = "true";
    el.spellcheck = preferences.spellcheck !== false;
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-label", `${paragraph.type} paragraph`);
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("dir", "auto");
    el.innerHTML = paragraph.html || "";
    el.addEventListener("focus", () => setActiveParagraph(paragraph.id));
    el.addEventListener("click", () => setActiveParagraph(paragraph.id));
    applyRevisionToElement(el, paragraph);
    return el;
  }
  function decorateEditor() {
    const scenes = getScenes(documentSession.doc);
    const paragraphNodes = new Map($$('.para[data-id]',els.editor).map(el=>[el.dataset.id,el]));
    const byIndex = new Map();
    scenes.forEach((scene) => {
      for (let index = scene.startIndex; index < scene.endIndex; index += 1) {
        byIndex.set(index, scene);
      }
    });
    const bookmarksByPara = new Map(
      (documentSession.doc.bookmarks || []).map((bm) => [bm.paragraphId, bm]),
    );
    const highlights = documentSession.doc.characterHighlights || {};
    let currentSpeaker = "";
    documentSession.doc.paragraphs.forEach((paragraph, index) => {
      const el = paragraphNodes.get(paragraph.id);
      if (!el) return;
      if (paragraph.type === "Character") {
        currentSpeaker = paragraphText(paragraph).replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
      } else if (paragraph.type === "Scene Heading" || paragraph.type === "Action" || paragraph.type === "Transition") {
        currentSpeaker = "";
      }
      const scene = byIndex.get(index) || null;
      el.classList.toggle("is-omitted", Boolean(scene && scene.omit));
      el.classList.toggle("has-note", Boolean(paragraph.note && String(paragraph.note).trim()));
      if (paragraph.note && String(paragraph.note).trim()) {
        el.dataset.note = String(paragraph.note).trim();
      } else {
        delete el.dataset.note;
      }
      const bm = bookmarksByPara.get(paragraph.id);
      el.classList.toggle("has-bookmark", Boolean(bm));
      if (bm) el.dataset.bookmark = bm.name;
      else delete el.dataset.bookmark;
      const hasAlts = editorState.showAlts && Array.isArray(paragraph.alts) && paragraph.alts.length > 0;
      el.classList.toggle("has-alts", hasAlts);
      if (hasAlts) {
        el.dataset.altCount = `${(paragraph.activeAlt || 0) + 1}/${paragraph.alts.length + 1} Alts`;
      } else {
        delete el.dataset.altCount;
      }
      const hasTags = Array.isArray(paragraph.tags) && paragraph.tags.length > 0;
      el.classList.toggle("has-tags", hasTags);
      if (hasTags) {
        el.dataset.tagsSummary = paragraph.tags.map((t) => t.label).join(" · ");
      } else {
        delete el.dataset.tagsSummary;
      }
      const hlColor =
        (paragraph.type === "Character" || paragraph.type === "Dialogue" || paragraph.type === "Parenthetical") &&
        currentSpeaker &&
        highlights[currentSpeaker];
      el.classList.toggle("is-char-highlighted", Boolean(hlColor));
      if (hlColor) el.style.setProperty("--char-hl", hlColor);
      else el.style.removeProperty("--char-hl");
      el.classList.toggle("has-page-break", Boolean(paragraph.pageBreakBefore));
      el.classList.toggle("has-track-change", Boolean(editorState.trackChanges && paragraph.changeType));
      const imageInfo = paragraph.image;
      if (imageInfo) {
        el.classList.add("has-image");
        el.dataset.imageCaption =
          typeof imageInfo === "object" ? imageInfo.caption || "Reference image" : String(imageInfo);
      } else {
        el.classList.remove("has-image");
        delete el.dataset.imageCaption;
      }
      formatActions.applyParagraphVisuals(el, paragraph);
      if (scene && paragraph.type === "Scene Heading") {
        el.dataset.sceneNumber = scene.number;
        el.dataset.sceneIndex = String(scene.index);
      } else {
        delete el.dataset.sceneNumber;
        delete el.dataset.sceneIndex;
      }
      applyRevisionToElement(el, paragraph);
    });
    els.editor.classList.toggle("show-scene-numbers", documentSession.doc.settings.sceneNumbers);
    els.editor.classList.toggle("tags-mode-on", Boolean(editorState.tagsMode));
    els.editor.classList.toggle("speed-view-on", workspaceState.mode === "speed");
    els.editor.dataset.sceneNumberSide = documentSession.doc.settings.sceneNumberSide || "both";
    if (els.paper) {
      const wm = documentSession.doc.watermark || {};
      els.paper.classList.toggle("has-watermark", Boolean(wm.enabled && wm.text));
      if (wm.enabled && wm.text) {
        els.paper.dataset.watermark = wm.text;
        els.paper.style.setProperty("--wm-opacity", String((Number(wm.opacity) || 14) / 100));
      } else {
        delete els.paper.dataset.watermark;
      }
    }
  }
  function applyRevisionToElement(el, paragraph) {
    if (!el) return;
    const revision = paragraph && paragraph.revision ? revisionEntry(documentSession.doc, paragraph.revision) : null;
    el.classList.toggle("has-revision", Boolean(revision));
    if (revision) {
      el.style.setProperty("--revision-color", revision.hex);
      el.dataset.revision = String(paragraph.revision);
      el.title = `${revision.name} revision`;
    } else {
      el.style.removeProperty("--revision-color");
      delete el.dataset.revision;
      el.removeAttribute("title");
    }
  }
  function markCurrentRevision(paragraph) {
    if (!paragraph || !documentSession.doc.revision || !documentSession.doc.revision.enabled) return;
    markRevision(documentSession.doc, paragraph);
    applyRevisionToElement(paragraphElement(paragraph.id), paragraph);
    workspaceLayout.renderRevisionChrome();
  }
  function paragraphElement(id) {
    return id ? $(`.para[data-id="${escapeSelector(id)}"]`, els.editor) : null;
  }
  function activeParagraphElement() {
    const selection = window.getSelection();
    let node = selection && selection.anchorNode;
    while (node && node !== els.editor) {
      if (node.nodeType === 1 && node.classList && node.classList.contains("para")) return node;
      node = node.parentNode;
    }
    return paragraphElement(editorState.selectedId) || $(".para", els.editor);
  }
  function activeParagraph() {
    const el = activeParagraphElement();
    return el ? documentSession.doc.paragraphs.find((paragraph) => paragraph.id === el.dataset.id) : null;
  }
  function setActiveParagraph(id) {
    if (editorState.selectedId === id) {
      syncInspectorForParagraph(id);
      return;
    }
    clearTimeout(ribbonState.ribbonSyncTimer);
    ribbonState.ribbonSyncTimer = setTimeout(() => {
      ribbonState.ribbonSyncTimer = null;
      ribbonActions.syncRibbon();
    }, 90);
    editorState.selectedId = id;
    $$(".para.is-active", els.editor).forEach((el) => el.classList.remove("is-active"));
    const el = paragraphElement(id);
    if (el) el.classList.add("is-active");
    syncInspectorForParagraph(id);
    syncFormatButtons();
  }
  function syncInspectorForParagraph(id) {
    const paragraph = documentSession.doc.paragraphs.find((item) => item.id === id);
    if (!paragraph) return;
    const spec = elementSpec(paragraph.type);
    pageActions.syncDocumentFontControls();
    els.elementName.textContent = spec.label;
    els.elementHint.textContent = `Return goes to ${nextType(paragraph.type)}`;
    els.elementSwatch.style.background =
      PALETTE[Math.max(0, documentSession.doc.paragraphs.indexOf(paragraph)) % PALETTE.length];
    els.elementSelect.value = paragraph.type;
    $$(".element-choice", els.elementChoices).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.type === paragraph.type);
    });
    if (els.dualDialogueButton) {
      els.dualDialogueButton.classList.toggle("is-active", Boolean(paragraph.dualGroup));
    }
    if (els.scriptNoteButton) {
      els.scriptNoteButton.classList.toggle("is-active", Boolean(paragraph.note && String(paragraph.note).trim()));
    }
    renderGeometry(spec);
    updateRulerMarkers(spec);
    if (workspaceState.inspectorTab === "scene") planningViews.renderSceneInspector();
  }
  function renderGeometry(spec) {
    const rows = [
      ["Left", `${spec.left.toFixed(2)} in`],
      ["Right", `${spec.right.toFixed(2)} in`],
      ["First", `${spec.first.toFixed(2)} in`],
      ["Before", `${spec.before} pt`],
    ];
    els.geometryGrid.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="geometry-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
  }
  function syncParagraphElement(el, paragraph = documentSession.doc.paragraphs.find(item => item.id === el.dataset.id)) {
    if (!paragraph) return null;
    paragraph.html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    paragraph.type = el.dataset.type;
    if (paragraph.type === "Scene Heading") {
      if (!paragraph.scene) {
        paragraph.scene = {
          synopsis: "",
          notes: "",
          color: "",
          omit: false,
          number: "",
        };
      }
    } else {
      delete paragraph.scene;
    }
    return paragraph;
  }
  function applySmartTypography(el) {
    if (!documentSession.doc.settings.smartQuotes) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== 3 || !el.contains(node)) return;
    const text = node.nodeValue || "";
    const offset = range.startOffset;
    if (offset >= 3 && text.slice(offset - 3, offset) === "...") {
      node.nodeValue = text.slice(0, offset - 3) + "…" + text.slice(offset);
      range.setStart(node, offset - 2);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (offset >= 2 && text.slice(offset - 2, offset) === "--") {
      node.nodeValue = text.slice(0, offset - 2) + "—" + text.slice(offset);
      range.setStart(node, offset - 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function maybeAutoUppercase(el) {
    if (!preferences.autoUppercase || !el) return false;
    if (!["Scene Heading", "Character", "Transition", "Shot"].includes(el.dataset.type)) {
      return false;
    }
    const runs = FDX.htmlToRuns(el.innerHTML);
    if (!runs.length) return false;
    let changed = false;
    const upperRuns = runs.map((run) => {
      const upper = run.text.toUpperCase();
      if (upper !== run.text) changed = true;
      return { ...run, text: upper };
    });
    if (changed) {
      el.innerHTML = FDX.runsToHtml(upperRuns);
      syncParagraphElement(el);
    }
    return changed;
  }
  function onEditorInput(event) {
    // The IME owns the candidate DOM until compositionend. The draft and its
    // autosave must only see committed text.
    if (event.isComposing || editorState.composing) return;
    const el = event.target.closest(".para");
    if (!el) return;
    applySmartTypography(el);
    commitEditorInput(el);
  }
  function commitEditorInput(el, recordImmediately = false) {
    const paragraph = documentSession.doc.paragraphs.find(item => item.id === el.dataset.id);
    if (!paragraph || paragraph.html === (el.innerHTML === "<br>" ? "" : el.innerHTML)) return;
    const originalHtml = paragraph.html;
    syncParagraphElement(el, paragraph);
    if (editorState.trackChanges) {
      if (!editorState.trackedBaseline) editorState.trackedBaseline = {};
      if (editorState.trackedBaseline[paragraph.id] === undefined) {
        editorState.trackedBaseline[paragraph.id] = originalHtml;
      }
      if (!paragraph.changeType) {
        paragraph.changeType = "edit";
        paragraph.trackedOriginal =
          typeof editorState.trackedBaseline[paragraph.id] === "string"
            ? editorState.trackedBaseline[paragraph.id]
            : paragraph.html;
      }
      el.classList.add("has-track-change");
    }
    markCurrentRevision(paragraph);
    fileActions.markDirty();
    if (recordImmediately) documentSession.history.record();
    else documentSession.history.schedule();
    scheduleChrome();
    updateSmartType(el, paragraph);
    if (preferences.typewriterScroll && workspaceState.mode === "write") {
      scrollParagraphIntoView(el, "center", true);
    }
  }
  function onCompositionStart(event) {
    const paragraph = event.target.closest(".para");
    if (!paragraph) return;
    const selection = FDCoreWriting.captureSelection(els.editor);
    const history = documentSession.history;
    history.finishBurst();
    history.selectionCurrent = selection || history.selectionCurrent;
    editorState.composing = { paragraph, html: paragraph.innerHTML, selection };
    hideSmartType();
  }
  function onCompositionEnd(event) {
    const composition = editorState.composing;
    if (!composition || composition.paragraph !== event.target) return;
    editorState.composing = null;
    const { paragraph, html, selection } = composition;
    if (!els.editor.contains(paragraph)) return;
    if (event.data === "") {
      if (paragraph.innerHTML !== html) paragraph.innerHTML = html;
      if (document.activeElement === paragraph) FDCoreWriting.restoreSelection(els.editor, selection);
      return;
    }
    commitEditorInput(paragraph, true);
  }
  function smartSuggestions(paragraph) {
    const text = paragraphText(paragraph);
    if (paragraph.type === "Character") {
      const cue = text.replace(/\s*\([^)]*\)?\s*$/, "").trim().toUpperCase();
      if (!cue || cue.includes(")")) return [];
      const names = new Set(
        getCharacters(documentSession.doc)
          .map((character) => character.name)
          .filter((name) => name !== cue && name.startsWith(cue)),
      );
      return Array.from(names)
        .slice(0, 7)
        .map((name) => ({ value: name, label: name, meta: "Character" }));
    }
    if (paragraph.type === "Scene Heading") {
      const upper = text.toUpperCase();
      if (/[-–—]\s*$/.test(upper)) {
        const base = upper.replace(/[-–—]\s*$/, "").replace(/\s+$/, "");
        return ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MORNING", "EVENING", "DAWN", "DUSK"].map(
          (time) => ({
            value: `${base} - ${time}`,
            label: time,
            meta: "Time of day",
          }),
        );
      }
      if (/^(INT\.?|EXT\.?|I\/E\.?)\s+/.test(upper) && !/\s[-–—]\s/.test(upper)) {
        const prefix = upper.match(/^(INT\.?|EXT\.?|I\/E\.?)\s+/)[0];
        const locations = Array.from(
          new Set(
            getScenes(documentSession.doc)
              .map((scene) => scene.location)
              .filter(
                (location) =>
                  location &&
                  location !== "Unknown" &&
                  `${prefix}${location}`.startsWith(upper.replace(/\s+/g, " ").trim()),
              ),
          ),
        ).slice(0, 5);
        return locations.map((location) => ({
          value: `${prefix}${location} - DAY`,
          label: location,
          meta: "Location",
        }));
      }
      return [];
    }
    if (paragraph.type === "Transition") {
      const prefix = text.trim().toUpperCase();
      if (!prefix) return [];
      return ["CUT TO:", "SMASH CUT TO:", "FADE OUT.", "FADE TO BLACK.", "DISSOLVE TO:"]
        .filter((value) => value.startsWith(prefix) && value !== prefix)
        .slice(0, 6)
        .map((value) => ({ value, label: value, meta: "Transition" }));
    }
    return [];
  }
  function hideSmartType() {
    const owner = editorState.smart.elementId && paragraphElement(editorState.smart.elementId);
    if (owner) {
      owner.removeAttribute("aria-activedescendant");
      owner.removeAttribute("aria-controls");
      owner.removeAttribute("aria-autocomplete");
    }
    editorState.smart.visible = false;
    editorState.smart.items = [];
    editorState.smart.elementId = null;
    if (els.smartType && !els.smartType.hidden) {
      els.smartType.classList.remove("is-visible");
      els.smartType.classList.add("is-closing");
      setTimeout(() => {
        if (!editorState.smart.visible) {
          els.smartType.hidden = true;
          els.smartType.classList.remove("is-closing");
        }
      }, 120);
    }
  }
  function updateSmartType(el, paragraph) {
    if (!el || !paragraph || !preferences.smartTypeEnabled) {
      hideSmartType();
      return;
    }
    if (!["Character", "Scene Heading", "Transition"].includes(paragraph.type)) {
      hideSmartType();
      return;
    }
    const items = smartSuggestions(paragraph);
    if (!items.length) {
      hideSmartType();
      return;
    }
    editorState.smart.visible = true;
    editorState.smart.items = items;
    editorState.smart.index = 0;
    editorState.smart.elementId = el.dataset.id;
    editorState.smart.mode = paragraph.type;
    els.smartType.innerHTML = items
      .map(
        (item, index) =>
          `<button type="button" id="smartType-option-${index}" class="smart-type__item${index === 0 ? " is-active" : ""}" data-smart-index="${index}" role="option" aria-selected="${index === 0}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.meta)}</small></button>`,
      )
      .join("");
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-controls", "smartType");
    el.setAttribute("aria-activedescendant", "smartType-option-0");
    els.smartType.classList.remove("is-closing");
    els.smartType.hidden = false;
    els.smartType.classList.add("is-visible");
    $$(".smart-type__item", els.smartType).forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        acceptSmartType(Number(button.dataset.smartIndex));
      });
    });
    const selection = window.getSelection();
    let rect = null;
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        const rects = range.getClientRects();
        if (rects.length) rect = rects[0];
      }
    }
    if (!rect || (!rect.width && !rect.height)) rect = el.getBoundingClientRect();
    const width = 260;
    const height = Math.min(290, items.length * 36 + 10);
    const left = clamp(rect.left, 12, window.innerWidth - width - 12);
    const top =
      rect.bottom + height + 14 < window.innerHeight
        ? rect.bottom + 7
        : Math.max(12, rect.top - height - 7);
    els.smartType.style.left = `${left}px`;
    els.smartType.style.top = `${top}px`;
    els.smartType.style.width = `${width}px`;
  }
  function moveSmartType(delta) {
    if (!editorState.smart.visible) return;
    editorState.smart.index = clamp(
      editorState.smart.index + delta,
      0,
      Math.max(0, editorState.smart.items.length - 1),
    );
    $$(".smart-type__item", els.smartType).forEach((item, index) => {
      item.classList.toggle("is-active", index === editorState.smart.index);
      item.setAttribute("aria-selected", String(index === editorState.smart.index));
    });
    const owner = paragraphElement(editorState.smart.elementId);
    if (owner) owner.setAttribute("aria-activedescendant", `smartType-option-${editorState.smart.index}`);
  }
  function acceptSmartType(index = editorState.smart.index) {
    if (!editorState.smart.visible) return;
    const item = editorState.smart.items[index];
    const el = paragraphElement(editorState.smart.elementId);
    if (!item || !el) {
      hideSmartType();
      return;
    }
    el.textContent = item.value;
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    fileActions.markDirty();
    documentSession.history.record();
    hideSmartType();
    placeCaret(el, "end");
    scheduleChrome();
  }
  function scheduleChrome() {
    clearTimeout(workspaceState.sceneTimer);
    workspaceState.sceneTimer = setTimeout(() => {
      workspaceState.sceneTimer = null;
      planningViews.renderScenes();
      workspaceLayout.seedStructureMeta();
      renderOutlineAndRuler();
      if (workspaceState.splitView.enabled) renderSplitPane();
      workspaceLayout.renderMeta();
      workspaceLayout.renderStatus();
      workspaceLayout.renderRevisionChrome();
      ribbonActions.syncRibbon();
      if (workspaceState.view === "reports") planningViews.renderReports();
    }, 220);
  }
  function onEditorFocusIn(event) {
    const el = event.target.closest(".para");
    if (!el) return;
    if (editorState.smart.visible && editorState.smart.elementId !== el.dataset.id) hideSmartType();
    setActiveParagraph(el.dataset.id);
    if (editorState.trackChanges) {
      const paragraph = documentSession.doc.paragraphs.find((entry) => entry.id === el.dataset.id);
      if (paragraph) {
        if (!editorState.trackedBaseline) editorState.trackedBaseline = {};
        if (editorState.trackedBaseline[paragraph.id] === undefined) {
          editorState.trackedBaseline[paragraph.id] = paragraph.html;
        }
      }
    }
  }
  function commitStructuralEdit(result) {
    documentSession.history.finishBurst();
    documentSession.replaceContent(result.doc);
    const caret = { start: result.caret, end: result.caret };
    editorState.pendingSelection = caret;
    editorState.selectedId = result.caret.id;
    fileActions.markDirty();
    documentSession.history.record();
    documentSession.history.selectionCurrent = caret;
    hideSmartType();
    workspaceLayout.renderAll();
  }
  function resetDocumentInput() {
    hideSmartType();
    editorState.selectedId = null;
    editorState.pendingSelection = null;
    editorState.composing = null;
    editorState.trackedBaseline = null;
  }
  function onEditorBeforeInput(event) {
    if (event.isComposing || editorState.composing) return;
    const snapshot = FDCoreWriting.captureSelection(els.editor);
    if (snapshot && documentSession.history) documentSession.history.selectionCurrent = snapshot;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault(); event.inputType === "historyUndo" ? fileActions.undo() : fileActions.redo(); return;
    }
    if (!snapshot || snapshot.start.id === snapshot.end.id) return;
    if (event.inputType.startsWith("delete") || (event.inputType === "insertText" && event.data !== null) || event.inputType === "insertParagraph") {
      event.preventDefault();
      commitStructuralEdit(FDCoreWriting.replaceSelection(documentSession.doc, snapshot,
        event.inputType === "insertParagraph" ? "\n" : event.inputType.startsWith("delete") ? "" : event.data));
    }
  }
  function onEditorKeyDown(event) {
    if (event.isComposing || editorState.composing || event.keyCode === 229) return;
    const el = event.target.closest(".para");
    if (!el) return;
    const snapshot = FDCoreWriting.captureSelection(els.editor);
    if (documentSession.history && snapshot) documentSession.history.selectionCurrent = snapshot;
    if (snapshot && snapshot.start.id !== snapshot.end.id && ["Enter", "Backspace", "Delete"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      commitStructuralEdit(FDCoreWriting.replaceSelection(documentSession.doc, snapshot, event.key === "Enter" ? "\n" : ""));
      return;
    }
    if (snapshot && snapshot.start.id === snapshot.end.id && snapshot.start.offset === snapshot.end.offset) {
      const paragraph = activeParagraph();
      const index = paragraph ? documentSession.doc.paragraphs.indexOf(paragraph) : -1;
      const length = paragraph ? paragraphText(paragraph).length : 0;
      if ((event.key === "Delete" && snapshot.start.offset === length && index < documentSession.doc.paragraphs.length - 1) ||
          (event.key === "Backspace" && snapshot.start.offset === 0 && index > 0)) {
        event.preventDefault();
        commitStructuralEdit(FDCoreWriting.deleteAdjacent(documentSession.doc, snapshot.start, event.key === "Delete" ? 1 : -1));
        return;
      }
      if (!event.shiftKey && ((event.key === "ArrowRight" && snapshot.start.offset === length) || (event.key === "ArrowLeft" && snapshot.start.offset === 0))) {
        const next = documentSession.doc.paragraphs[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) { event.preventDefault(); focusParagraph(next.id, event.key === "ArrowRight" ? "start" : "end"); return; }
      }
    }
    if (editorState.smart.visible) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSmartType(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSmartType(-1);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        acceptSmartType();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideSmartType();
        return;
      }
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        hideSmartType();
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const next = tabType(el.dataset.type, event.shiftKey);
      changeElementType(next);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      /* Modifiers must be excluded here. Ctrl+Enter is the global "new scene"
       * shortcut (handled in onGlobalKeyDown); without this guard the editor split
       * the paragraph at the caret AND the global handler inserted a scene, so one
       * keystroke did two unrelated things. Shift+Enter is the soft line break and
       * is handled by the branch below. */
      event.preventDefault();
      documentSession.history.finishBurst();
      splitParagraph(el);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      const paragraph = syncParagraphElement(el);
      markCurrentRevision(paragraph);
      fileActions.markDirty();
      documentSession.history.schedule();
      scheduleChrome();
      return;
    }
    if (event.key === "Backspace") {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const before = range.cloneRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      if (before.toString().length !== 0) return;
      event.preventDefault();
      mergeWithPrevious(el);
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      const selection = window.getSelection();
      if (!selection || !selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const after = range.cloneRange();
      after.selectNodeContents(el);
      after.setStart(range.endContainer, range.endOffset);
      if (after.toString().length !== 0) return;
      const next = el.nextElementSibling;
      if (next && next.classList.contains("para")) {
        event.preventDefault();
        focusParagraph(next.dataset.id, "start");
      }
    }
  }
  function splitParagraph(el) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return;
    if (!range.collapsed) range.deleteContents();
    const after = range.cloneRange();
    after.selectNodeContents(el);
    after.setStart(range.endContainer, range.endOffset);
    const fragment = after.extractContents();
    const temp = document.createElement("div");
    temp.appendChild(fragment);
    const newHtml = temp.innerHTML === "<br>" ? "" : temp.innerHTML;
    el.innerHTML = el.innerHTML === "<br>" ? "" : el.innerHTML;
    maybeAutoUppercase(el);
    syncParagraphElement(el);
    const newParagraph = makeParagraph(nextType(el.dataset.type), "");
    newParagraph.html = newHtml;
    const currentParagraph = documentSession.doc.paragraphs.find((paragraph) => paragraph.id === el.dataset.id);
    newParagraph.dualGroup = currentParagraph ? currentParagraph.dualGroup : null;
    newParagraph.dualSide = currentParagraph ? currentParagraph.dualSide ?? null : null;
    if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, newParagraph);
    const newEl = createParagraphElement(newParagraph);
    el.insertAdjacentElement("afterend", newEl);
    const index = documentSession.doc.paragraphs.findIndex((paragraph) => paragraph.id === el.dataset.id);
    documentSession.doc.paragraphs.splice(index + 1, 0, newParagraph);
    fileActions.markDirty();
    documentSession.history.record();
    decorateEditor();
    scheduleChrome();
    newEl.focus({ preventScroll: true });
    placeCaret(newEl, "start");
    scrollIntoViewIfNeeded(newEl);
  }
  function mergeWithPrevious(el) {
    const previous = el.previousElementSibling;
    if (!previous || !previous.classList.contains("para")) return;
    const currentText = stripHtml(el.innerHTML).trim();
    if (!currentText) {
      el.remove();
      documentSession.doc.paragraphs = documentSession.doc.paragraphs.filter(
        (paragraph) => paragraph.id !== el.dataset.id,
      );
      focusParagraph(previous.dataset.id, "end");
    } else {
      previous.innerHTML += el.innerHTML;
      el.remove();
      documentSession.doc.paragraphs = documentSession.doc.paragraphs.filter(
        (paragraph) => paragraph.id !== el.dataset.id,
      );
      const paragraph = syncParagraphElement(previous);
      markCurrentRevision(paragraph);
      focusParagraph(previous.dataset.id, "end");
    }
    fileActions.markDirty();
    documentSession.history.record();
    decorateEditor();
    scheduleChrome();
  }
  function changeElementType(type) {
    const el = activeParagraphElement();
    if (!el) return;
    if (!ELEMENTS[type]) return;
    const wasActive = editorState.selectedId === el.dataset.id;
    el.dataset.type = type;
    el.setAttribute("aria-label", `${type} paragraph`);
    el.dataset.placeholder = elementSpec(type).placeholder;
    Array.from(el.classList)
      .filter((className) => className.startsWith("type-"))
      .forEach((className) => el.classList.remove(className));
    el.classList.add(`type-${slug(type)}`);
    el.classList.toggle("is-active", wasActive);
    const paragraph = documentSession.doc.paragraphs.find((item) => item.id === el.dataset.id);
    if (paragraph) {
      paragraph.type = type;
      if (type === "Scene Heading") {
        if (!paragraph.scene) {
          paragraph.scene = { synopsis: "", notes: "", color: "", omit: false, number: "" };
        }
      } else {
        delete paragraph.scene;
      }
      markCurrentRevision(paragraph);
    }
    setActiveParagraph(el.dataset.id);
    fileActions.markDirty();
    documentSession.history.record();
    decorateEditor();
    scheduleChrome();
    el.focus({ preventScroll: true });
  }
  function resetShellScroll() {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.documentElement && document.documentElement.scrollTop) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body && document.body.scrollTop) {
      document.body.scrollTop = 0;
    }
    [
      els.appShell,
      els.workspace,
      $("#main"),
      $("#viewStack"),
      $("#scriptView"),
      els.editorStage,
    ].forEach((node) => {
      if (node && node.scrollTop) node.scrollTop = 0;
      if (node && node.scrollLeft) node.scrollLeft = 0;
    });
  }
  function scrollParagraphIntoView(el, mode = "center", smooth = true) {
    if (!el || !els.paperScroll) return;
    resetShellScroll();
    const container = els.paperScroll;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (!cRect.height) return;
    let delta = 0;
    if (mode === "nearest") {
      const pad = 44;
      if (eRect.top < cRect.top + pad) {
        delta = eRect.top - (cRect.top + pad);
      } else if (eRect.bottom > cRect.bottom - pad) {
        delta = eRect.bottom - (cRect.bottom - pad);
      } else {
        return;
      }
    } else {
      /* 0.38 of the viewport, shared with `sceneAnchorOffset()` (see
       * updateActiveSceneFromScroll). These two MUST agree: the scroll puts the heading
       * at this fraction and the scroll handler decides which scene is active by
       * comparing headings against the same fraction. They were 0.38 here and a
       * hard-coded 190px there, which made a click land one scene early on any tall
       * viewport. Expressed as a shared constant so the two cannot drift again. */
      const targetCenter = cRect.top + cRect.height * workspaceLayout.SCENE_ANCHOR_FRACTION;
      const elCenter = eRect.top + eRect.height / 2;
      delta = elCenter - targetCenter;
    }
    const nextTop = Math.max(0, container.scrollTop + delta);
    const useSmooth = smooth && !prefersReducedMotion();
    container.scrollTo({
      top: nextTop,
      behavior: useSmooth ? "smooth" : "auto",
    });
    /* When the requested scroll is clamped — the target is near the start or the end of
     * the document and there is not enough content to move it as far as asked — the
     * element cannot reach the anchor line. The last scene of a script with a short tail
     * is the common case: it sits 264px below the top because the scroll ran out, not
     * because anything misfired.
     *
     * The tracker must know: it decides "which scene am I on" by comparing headings to
     * the anchor line, so a clamped position would leave the PREVIOUS scene as the active
     * one and the highlight would appear to jump backwards even though navigation went
     * to the right place. Recording the scene the caller explicitly navigated to lets
     * the tracker prefer that intent over the clamped geometry. It is cleared on the
     * next user-initiated scroll, so free scrolling goes back to the geometric answer. */
    if (mode === "center" && el.classList.contains("type-scene-heading")) {
      /* `scene.id` IS the id of the scene-heading paragraph (see getScenes in
       * app/js/model.js), and every `.para` carries `data-id`. So the element's own
       * `data-id` is the scene id — no lookup table needed. */
      workspaceState.navigatedSceneId = el.dataset.id || null;
      /* Hold that intent for the WHOLE programmatic scroll, not one frame.
       *
       * A smooth scroll fires ~45 scroll events on the way to the target. The tracker
       * re-derives the scene from geometry on each one, so during the flight it reports
       * the scenes being passed through: click scene 8 and the navigator flashes 6, 7,
       * then 8. The correct value is written first by goToScene, then overwritten, then
       * restored — a visible flicker even though the end state is right.
       *
       * While a navigation is in flight the tracker now trusts the recorded target and
       * only resumes deriving once the scroll has settled. `scrollend` is the precise
       * signal; the scrollTop comparison and the timeout are fallbacks for engines that
       * batch or skip it (Chromium fires it, but a clamped scroll may not move at all). */
      workspaceState.navigationTarget = nextTop;
      workspaceState.navigationInFlight = true;
      if (workspaceState.navigationSettleTimer) clearTimeout(workspaceState.navigationSettleTimer);
      workspaceState.navigationSettleTimer = setTimeout(() => {
        workspaceState.navigationInFlight = false;
        workspaceState.navigationSettleTimer = null;
      }, 700);
    }
    resetShellScroll();
  }
  function placeCaret(el, position) {
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(position !== "end");
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function focusParagraph(id, position) {
    const el = paragraphElement(id);
    if (!el) return;
    placeCaret(el, position);
    setActiveParagraph(id);
    scrollIntoViewIfNeeded(el);
  }
  function scrollIntoViewIfNeeded(el) {
    scrollParagraphIntoView(el, "nearest", true);
  }
  function onPaste(event) {
    const el = event.target.closest(".para");
    if (!el) return;
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text/plain");
    if (!text) return;
    const selectedBlocks = FDCoreWriting.captureSelection(els.editor);
    if (selectedBlocks && selectedBlocks.start.id !== selectedBlocks.end.id) {
      commitStructuralEdit(FDCoreWriting.replaceSelection(documentSession.doc, selectedBlocks, text)); return;
    }
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    let suffix = "";
    if (parts.length > 1) {
      range.deleteContents();
      const after = range.cloneRange();
      after.selectNodeContents(el);
      after.setStart(range.endContainer, range.endOffset);
      const holder = document.createElement("div");
      holder.appendChild(after.extractContents());
      suffix = holder.innerHTML;
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand("insertText", false, parts[0]);
    let last = el;
    for (const part of parts.slice(1)) {
      const paragraph = makeParagraph(nextType(last.dataset.type), part);
      const previous = documentSession.doc.paragraphs.find(item => item.id === last.dataset.id);
      paragraph.dualGroup = previous ? previous.dualGroup : null;
      paragraph.dualSide = previous ? previous.dualSide : null;
      if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, paragraph);
      const newEl = createParagraphElement(paragraph);
      last.insertAdjacentElement("afterend", newEl);
      const index = documentSession.doc.paragraphs.findIndex((item) => item.id === last.dataset.id);
      documentSession.doc.paragraphs.splice(index + 1, 0, paragraph);
      last = newEl;
    }
    if (last !== el && suffix) {
      last.insertAdjacentHTML("beforeend", suffix);
      syncParagraphElement(last);
    }
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    fileActions.markDirty();
    documentSession.history.schedule();
    decorateEditor();
    scheduleChrome();
    if (last !== el) {
      focusParagraph(last.dataset.id, "end");
      const caret = findActions.rangeForOffsets(last, parts[parts.length - 1].length, parts[parts.length - 1].length);
      if (caret) { selection.removeAllRanges(); selection.addRange(caret); }
    }
  }
  function formatSelection(command) {
    const focused = document.activeElement;
    if (!focused || !focused.closest || !focused.closest(".para")) {
      modalActions.toast(
        "Select script text first",
        "Place the caret in a paragraph, then apply formatting.",
        "info",
        2200,
      );
      return;
    }
    const el = focused.closest(".para");
    el.focus({ preventScroll: true });
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, null);
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    syncFormatButtons();
    fileActions.markDirty();
    documentSession.history.schedule();
    scheduleChrome();
  }
  function syncFormatButtons() {
    const focused =
      document.activeElement &&
      document.activeElement.closest &&
      document.activeElement.closest(".para");
    if (!focused) return;
    try {
      $$(".format-btn").forEach((button) => {
        button.classList.toggle("is-active", document.queryCommandState(button.dataset.format));
      });
    } catch {
      /* queryCommandState is best-effort */
    }
  }
  function insertScene() {
    const active = activeParagraph();
    let insertIndex = documentSession.doc.paragraphs.length;
    if (active) {
      const scenes = getScenes(documentSession.doc);
      const index = documentSession.doc.paragraphs.findIndex((paragraph) => paragraph.id === active.id);
      const scene = scenes.find((item) => item.startIndex <= index && index < item.endIndex);
      insertIndex = scene ? scene.endIndex : index + 1;
    }
    const newHeading = makeParagraph("Scene Heading", "INT. NEW SCENE - DAY");
    const newAction = makeParagraph("Action", "");
    if (documentSession.doc.revision.enabled) {
      markRevision(documentSession.doc, newHeading);
      markRevision(documentSession.doc, newAction);
    }
    documentSession.doc.paragraphs.splice(insertIndex, 0, newHeading, newAction);
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    workspaceLayout.setView("script");
    workspaceLayout.setMode("write");
    requestAnimationFrame(() => focusParagraph(newHeading.id, "end"));
  }
  function moveScene(direction) {
    const scenes = getScenes(documentSession.doc);
    if (!scenes.length) return;
    const active = activeParagraph();
    const currentScene = active ? planningViews.sceneForParagraphId(active.id) : null;
    const currentIndex = currentScene
      ? scenes.findIndex((item) => item.id === currentScene.id)
      : workspaceState.activeScene;
    const step = direction < 0 ? -1 : 1;
    const nextIndex = clamp((currentIndex < 0 ? 0 : currentIndex) + step, 0, scenes.length - 1);
    const target = scenes[nextIndex];
    if (target) planningViews.goToScene(target);
  }
  // outline timeline, ruler, split view, dual dialogue, scriptnotes
  function renderOutlineAndRuler() {
    if (!els.outlineLayer) return;
    if (els.outlineBar) els.outlineBar.style.setProperty("--outline-zoom", String(workspaceState.outlineZoom || 1));
    const outlineVisible =
      preferences.showOutline &&
      (workspaceState.view !== "script" || preferences.showOutlineInScript !== false);
    if (els.outlineBar) els.outlineBar.hidden = !outlineVisible;
    if (els.rulerBar) els.rulerBar.hidden = !preferences.showRuler;
    els.outlineLayer.hidden = !outlineVisible && !preferences.showRuler;
    if (els.outlineToggleButton) {
      els.outlineToggleButton.classList.toggle("is-active", preferences.showOutline);
      els.outlineToggleButton.setAttribute("aria-pressed", String(preferences.showOutline));
      els.outlineToggleButton.dataset.subtle = outlineVisible ? "on" : "off";
    }
    if (els.rulerToggleButton) {
      els.rulerToggleButton.classList.toggle("is-active", preferences.showRuler);
      els.rulerToggleButton.setAttribute("aria-pressed", String(preferences.showRuler));
    }
    if (els.outlineTrack && outlineVisible) {
      const scenes = getScenes(documentSession.doc);
      if (!scenes.length) {
        els.outlineTrack.innerHTML = `<span class="subtle" style="padding:0 8px;font-size:9px;align-self:center">No scenes yet</span>`;
      } else {
        const totalWords = Math.max(1, scenes.reduce((sum, s) => sum + Math.max(18, s.wordCount), 0));
        els.outlineTrack.innerHTML = scenes
          .map((scene, index) => {
            const weight = Math.max(4, Math.round((Math.max(18, scene.wordCount) / totalWords) * 100));
            const shortHeading = (scene.heading || `Scene ${scene.number}`)
              .replace(/\s+-\s+(DAY|NIGHT|CONTINUOUS|MORNING|EVENING|DAWN|DUSK|LATER)$/i, "")
              .trim();
            return `<button type="button" class="outline-segment${index === workspaceState.activeScene ? " is-active" : ""}${scene.omit ? " is-omitted" : ""}" data-outline-scene="${escapeHtml(scene.id)}" style="flex:${weight} 1 0%;--scene-color:${escapeHtml(scene.color || "#0f6cbd")}" title="${escapeHtml(`${scene.number}. ${scene.heading} (${scene.wordCount} words)`)}" role="listitem">${escapeHtml(shortHeading)}</button>`;
          })
          .join("");
        $$(".outline-segment", els.outlineTrack).forEach((seg) => {
          seg.addEventListener("click", () => {
            const target = scenes.find((item) => item.id === seg.dataset.outlineScene);
            if (target) planningViews.goToScene(target);
          });
        });
      }
    }
    if (els.rulerTicks && preferences.showRuler) {
      const inches = Math.max(5, Math.min(14, Math.floor(Number(documentSession.doc.page.width) || 8)));
      if (Number(els.rulerTicks.dataset.inches) !== inches) {
        els.rulerTicks.dataset.inches = String(inches);
        els.rulerTicks.innerHTML = Array.from(
          { length: inches },
          (_, idx) => `<div class="ruler-tick"><span>${idx + 1}</span></div>`,
        ).join("");
      }
      const active = activeParagraph() || documentSession.doc.paragraphs[0];
      if (active) updateRulerMarkers(elementSpec(active.type));
    }
  }
  function updateRulerMarkers(spec) {
    if (!els.rulerMarkerLeft || !els.rulerMarkerRight || !els.rulerMarkerFirst || !spec) return;
    const widthIn = Math.max(5, Number(documentSession.doc.page.width) || 8.5);
    const leftPct = clamp((spec.left / widthIn) * 100, 2, 96);
    const firstPct = clamp(((spec.left + (spec.first || 0)) / widthIn) * 100, 2, 96);
    const rightPct = clamp((spec.right / widthIn) * 100, 8, 98);
    els.rulerMarkerLeft.style.left = `${leftPct.toFixed(2)}%`;
    els.rulerMarkerFirst.style.left = `${firstPct.toFixed(2)}%`;
    els.rulerMarkerRight.style.left = `${rightPct.toFixed(2)}%`;
  }
  function toggleOutlineLayer(force) {
    preferences.showOutline = typeof force === "boolean" ? force : !preferences.showOutline;
    renderOutlineAndRuler();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    requestAnimationFrame(() => workspaceLayout.fitPaper());
  }
  function toggleRulerLayer(force) {
    preferences.showRuler = typeof force === "boolean" ? force : !preferences.showRuler;
    renderOutlineAndRuler();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    requestAnimationFrame(() => workspaceLayout.fitPaper());
  }
  function toggleSplitView(force, orientation = null) {
    if (orientation) workspaceState.splitView.orientation = orientation;
    workspaceState.splitView.enabled =
      typeof force === "boolean" ? force : !workspaceState.splitView.enabled;
    if (els.editorStage) {
      els.editorStage.classList.toggle("is-split", workspaceState.splitView.enabled);
      els.editorStage.classList.toggle(
        "is-split-horizontal",
        workspaceState.splitView.enabled && workspaceState.splitView.orientation === "horizontal",
      );
      els.editorStage.classList.toggle(
        "is-split-swapped",
        workspaceState.splitView.enabled && workspaceState.splitView.swapped,
      );
    }
    if (els.splitPane) els.splitPane.hidden = !workspaceState.splitView.enabled;
    if (els.splitViewButton) {
      els.splitViewButton.classList.toggle("is-active", workspaceState.splitView.enabled);
      els.splitViewButton.setAttribute("aria-pressed", String(workspaceState.splitView.enabled));
      els.splitViewButton.title = workspaceState.splitView.enabled
        ? `Split view (${workspaceState.splitView.orientation === "horizontal" ? "Horizontal" : "Vertical"})`
        : "Split view (Reference / Cards beside Script)";
    }
    if (els.splitViewLabel) {
      els.splitViewLabel.textContent = "Split";
    }
    if (workspaceState.splitView.enabled) renderSplitPane();
    ribbonActions.syncRibbon();
    requestAnimationFrame(() => workspaceLayout.fitPaper());
  }
  function swapSplitPanes() {
    if (!workspaceState.splitView.enabled) {
      toggleSplitView(true);
    }
    workspaceState.splitView.swapped = !workspaceState.splitView.swapped;
    if (els.editorStage) {
      els.editorStage.classList.toggle("is-split-swapped", workspaceState.splitView.swapped);
    }
    modalActions.toast("Split panes swapped", "Primary and reference panes swapped positions.", "info", 1800);
  }
  function renderSplitPane() {
    if (!els.splitPaneBody || !workspaceState.splitView.enabled) return;
    const mode = workspaceState.splitView.mode || "cards";
    $$(".split-pane__tab", els.splitPane).forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.splitMode === mode);
    });
    if (mode === "cards") {
      const scenes = getScenes(documentSession.doc);
      if (!scenes.length) {
        els.splitPaneBody.innerHTML = `<p class="subtle">Add a scene heading to populate Index Cards.</p>`;
        return;
      }
      els.splitPaneBody.innerHTML = scenes
        .map(
          (scene) => `
          <button type="button" class="split-card-item" data-split-scene="${escapeHtml(scene.id)}" style="--scene-color:${escapeHtml(scene.color || "#0f6cbd")}">
            <strong>${escapeHtml(scene.number)}. ${escapeHtml(scene.heading || "Untitled scene")}</strong>
            <span>${escapeHtml(scene.synopsis || `${scene.wordCount} words · ${scene.paragraphs} blocks`)}</span>
          </button>`,
        )
        .join("");
      $$("[data-split-scene]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = scenes.find((s) => s.id === btn.dataset.splitScene);
          if (target) planningViews.goToScene(target);
        });
      });
    } else if (mode === "script") {
      els.splitPaneBody.innerHTML = documentSession.doc.paragraphs
        .map((p) => {
          const txt = paragraphText(p);
          return `<div class="split-ref-para${p.type === "Scene Heading" ? " is-heading" : ""}" data-split-para="${escapeHtml(p.id)}">${escapeHtml(txt || `(${p.type})`)}</div>`;
        })
        .join("");
      $$("[data-split-para]", els.splitPaneBody).forEach((row) => {
        row.addEventListener("click", () => focusParagraph(row.dataset.splitPara, "start"));
      });
    } else if (mode === "notes") {
      const noted = documentSession.doc.paragraphs.filter((p) => p.note && String(p.note).trim());
      const sceneNotes = getScenes(documentSession.doc).filter((s) => s.notes && String(s.notes).trim());
      if (!noted.length && !sceneNotes.length) {
        els.splitPaneBody.innerHTML = `<p class="subtle">No ScriptNotes yet. Click <strong>ScriptNote</strong> in the toolbar to attach a note to any paragraph.</p>`;
        return;
      }
      els.splitPaneBody.innerHTML = [
        ...noted.map(
          (p) => `
          <button type="button" class="split-card-item" data-split-note-para="${escapeHtml(p.id)}" style="--scene-color:#ca5010">
            <strong>ScriptNote · ${escapeHtml(p.type)}</strong>
            <span>${escapeHtml(String(p.note))}</span>
          </button>`,
        ),
        ...sceneNotes.map(
          (s) => `
          <button type="button" class="split-card-item" data-split-scene="${escapeHtml(s.id)}" style="--scene-color:${escapeHtml(s.color || "#0f6cbd")}">
            <strong>Scene ${s.index} Note · ${escapeHtml(s.heading)}</strong>
            <span>${escapeHtml(s.notes)}</span>
          </button>`,
        ),
      ].join("");
      $$("[data-split-note-para]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => focusParagraph(btn.dataset.splitNotePara, "start"));
      });
      $$("[data-split-scene]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = getScenes(documentSession.doc).find((s) => s.id === btn.dataset.splitScene);
          if (target) planningViews.goToScene(target);
        });
      });
    }
  }
  function findDialogueExchangeRange(paragraphs, index) {
    if (index < 0 || index >= paragraphs.length) return null;
    const valid = new Set(["Character", "Parenthetical", "Dialogue"]);
    if (!valid.has(paragraphs[index].type)) return null;
    let start = index;
    while (start > 0 && valid.has(paragraphs[start - 1].type)) {
      if (paragraphs[start].type === "Character") break;
      start -= 1;
    }
    if (paragraphs[start].type !== "Character") return null;
    let end = start + 1;
    while (
      end < paragraphs.length &&
      (paragraphs[end].type === "Parenthetical" || paragraphs[end].type === "Dialogue")
    ) {
      end += 1;
    }
    return { start, end };
  }
  function toggleDualDialogue() {
    const active = activeParagraph();
    if (!active) return;
    const paragraphs = documentSession.doc.paragraphs;
    if (active.dualGroup) {
      const group = active.dualGroup;
      paragraphs.forEach((p) => {
        if (p.dualGroup === group) {
          p.dualGroup = null;
          p.dualSide = null;
        }
      });
      fileActions.markDirty();
      documentSession.history.record();
      workspaceLayout.renderAll();
      focusParagraph(active.id, "end");
      modalActions.toast("Dual dialogue removed", "Returned exchange to single-column layout.", "info", 2200);
      return;
    }
    const idx = paragraphs.findIndex((p) => p.id === active.id);
    const currentExchange = findDialogueExchangeRange(paragraphs, idx);
    if (!currentExchange) {
      modalActions.toast(
        "Select a dialogue block",
        "Place the caret in a Character or Dialogue paragraph next to another character exchange.",
        "info",
        2600,
      );
      return;
    }
    let first = null;
    let second = null;
    const prevExchange =
      currentExchange.start > 0
        ? findDialogueExchangeRange(paragraphs, currentExchange.start - 1)
        : null;
    const nextExchange =
      currentExchange.end < paragraphs.length
        ? findDialogueExchangeRange(paragraphs, currentExchange.end)
        : null;
    if (prevExchange && prevExchange.end === currentExchange.start) {
      first = prevExchange;
      second = currentExchange;
    } else if (nextExchange && nextExchange.start === currentExchange.end) {
      first = currentExchange;
      second = nextExchange;
    }
    if (!first || !second) {
      modalActions.toast(
        "Need two adjacent characters",
        "Dual dialogue pairs two consecutive Character + Dialogue exchanges.",
        "info",
        2600,
      );
      return;
    }
    const groupId = uid("dual");
    for (let i = first.start; i < first.end; i += 1) {
      paragraphs[i].dualGroup = groupId;
      paragraphs[i].dualSide = 0;
    }
    for (let i = second.start; i < second.end; i += 1) {
      paragraphs[i].dualGroup = groupId;
      paragraphs[i].dualSide = 1;
    }
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    focusParagraph(active.id, "end");
    modalActions.toast("Dual dialogue enabled", "Paired adjacent exchanges into two columns.", "success", 2200);
  }
  function toTitleCase(str) {
    return String(str).replace(
      /\w\S*/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }
  function cycleCase() {
    const el = activeParagraphElement();
    if (!el) return;
    const runs = FDX.htmlToRuns(el.innerHTML);
    if (!runs.length) return;
    const fullText = runs.map((r) => r.text).join("");
    if (!fullText.trim()) return;
    const isUpper = fullText === fullText.toUpperCase() && fullText !== fullText.toLowerCase();
    const isLower = fullText === fullText.toLowerCase() && fullText !== fullText.toUpperCase();
    const nextMode = isUpper ? "lower" : isLower ? "title" : "upper";
    const transformed = runs.map((run) => ({
      ...run,
      text:
        nextMode === "upper"
          ? run.text.toUpperCase()
          : nextMode === "lower"
            ? run.text.toLowerCase()
            : toTitleCase(run.text),
    }));
    el.innerHTML = FDX.runsToHtml(transformed);
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    fileActions.markDirty();
    documentSession.history.record();
    scheduleChrome();
    placeCaret(el, "end");
    modalActions.toast(
      "Case updated",
      `Converted paragraph to ${nextMode === "upper" ? "UPPERCASE" : nextMode === "lower" ? "lowercase" : "Title Case"}.`,
      "info",
      1800,
    );
  }
  function openScriptNote() {
    const paragraph = activeParagraph() || documentSession.doc.paragraphs[0];
    if (!paragraph) return;
    const existing = String(paragraph.note || "");
    modalActions.openDialog({
      eyebrow: "Insert · ScriptNote",
      title: `ScriptNote on ${paragraph.type}`,
      body: `
        <p class="subtle" style="margin:0 0 8px">“${escapeHtml(speechActions.truncate(paragraphText(paragraph) || "(Empty paragraph)", 110))}”</p>
        <label class="field"><span>Note text</span><textarea id="scriptNoteInput" rows="4" maxlength="1000" placeholder="Add a production note, rewrite reminder, or beat flag…">${escapeHtml(existing)}</textarea></label>
        <div class="dialog-note">ScriptNotes appear as a margin flag in the editor, in the Split View ScriptNotes tab, and export cleanly to FDX <code>&lt;ScriptNotes&gt;</code>.</div>`,
      actions: [
        ...(existing
          ? [
              {
                label: "Remove note",
                kind: "danger",
                onClick: () => {
                  delete paragraph.note;
                  fileActions.markDirty();
                  documentSession.history.record();
                  decorateEditor();
                  syncInspectorForParagraph(paragraph.id);
                  if (workspaceState.splitView.enabled) renderSplitPane();
                  modalActions.toast("ScriptNote removed", "The note marker was cleared.", "info", 1800);
                },
              },
            ]
          : []),
        { label: "Cancel" },
        {
          label: "Save ScriptNote",
          kind: "primary",
          onClick: () => {
            const val = ($("#scriptNoteInput", els.dialogBody)?.value || "").trim();
            if (val) paragraph.note = val;
            else delete paragraph.note;
            fileActions.markDirty();
            documentSession.history.record();
            decorateEditor();
            syncInspectorForParagraph(paragraph.id);
            if (workspaceState.splitView.enabled) renderSplitPane();
            modalActions.toast(
              val ? "ScriptNote saved" : "ScriptNote cleared",
              val ? "Note attached to paragraph." : "Empty note removed.",
              "success",
              2000,
            );
          },
        },
      ],
    });
  }
  function openElementSettings() {
    const currentType = (activeParagraph() || {}).type || "Action";
    const elementTypes = Object.keys(ELEMENTS);
    modalActions.openDialog({
      eyebrow: "Format · Elements",
      title: "Script Elements settings",
      wide: true,
      body: `
        <div class="field-grid">
          <label class="field"><span>Select element</span><select id="elemSpecSelect">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${t === currentType ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Shortcut key</span><input id="elemSpecShortcut" type="text" readonly value="Alt+${escapeHtml(ELEMENTS[currentType].shortcut)}"></label>
        </div>
        <div class="field-grid" style="margin-top:8px">
          <label class="field"><span>Font family</span><input id="elemSpecFont" type="text" maxlength="120" value="${escapeHtml(ELEMENTS[currentType].font || preferences.font)}"></label>
          <label class="field"><span>Font size (pt)</span><input id="elemSpecSize" type="number" min="6" max="72" value="${ELEMENTS[currentType].fontSize || preferences.fontSize}"></label>
          <label class="field"><span>Left indent (in)</span><input id="elemSpecLeft" type="number" step="0.05" min="0.5" max="6.5" value="${ELEMENTS[currentType].left}"></label>
          <label class="field"><span>Right margin (in)</span><input id="elemSpecRight" type="number" step="0.05" min="3.0" max="8.0" value="${ELEMENTS[currentType].right}"></label>
          <label class="field"><span>First-line indent (in)</span><input id="elemSpecFirst" type="number" step="0.05" min="-1.0" max="2.0" value="${ELEMENTS[currentType].first}"></label>
          <label class="field"><span>Space before (pt)</span><input id="elemSpecBefore" type="number" step="2" min="0" max="48" value="${ELEMENTS[currentType].before}"></label>
          <label class="field"><span>Enter / Return goes to</span><select id="elemSpecNext">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${ELEMENTS[currentType].next === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Tab key goes to</span><select id="elemSpecTab">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${ELEMENTS[currentType].tab === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
        </div>
        <div class="dialog-note">Adjusting element geometry updates the live horizontal ruler, inspector specs, and FDX <code>&lt;ElementSettings&gt;</code> export.</div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply element settings",
          kind: "primary",
          keepOpen: true,
          onClick: () => {
            const type = $("#elemSpecSelect", els.dialogBody).value;
            const spec = { ...ELEMENTS[type] };
            if (spec) {
              spec.left = clamp(Number($("#elemSpecLeft", els.dialogBody).value) || spec.left, 0.5, 6.5);
              spec.right = clamp(Number($("#elemSpecRight", els.dialogBody).value) || spec.right, 3.0, 8.0);
              spec.first = clamp(Number($("#elemSpecFirst", els.dialogBody).value) || 0, -1.0, 2.0);
              spec.before = clamp(Number($("#elemSpecBefore", els.dialogBody).value) || 0, 0, 48);
              spec.next = $("#elemSpecNext", els.dialogBody).value || spec.next;
              spec.tab = $("#elemSpecTab", els.dialogBody).value || spec.tab;
              spec.font = $("#elemSpecFont", els.dialogBody).value.trim() || preferences.font;
              spec.fontSize = clamp(Number($("#elemSpecSize", els.dialogBody).value) || preferences.fontSize, 6, 72);
              if (spec.right <= spec.left) { modalActions.toast("Invalid geometry", "The right edge must be after the left indent.", "warning"); return; }
              documentSession.doc.elements ||= {};
              documentSession.doc.elements[type] = spec;
              pageActions.invalidateLayout();
              fileActions.markDirty();
              documentSession.history.record();
              workspaceLayout.renderAll();
              modalActions.closeDialog();
              modalActions.toast("Element updated", `${type} geometry and behavior updated.`, "success", 2200);
            }
          },
        },
      ],
    });
    const sel = $("#elemSpecSelect", els.dialogBody);
    if (sel) {
      sel.addEventListener("change", () => {
        const spec = ELEMENTS[sel.value];
        if (!spec) return;
        $("#elemSpecShortcut", els.dialogBody).value = `Alt+${spec.shortcut}`;
        $("#elemSpecLeft", els.dialogBody).value = String(spec.left);
        $("#elemSpecRight", els.dialogBody).value = String(spec.right);
        $("#elemSpecFirst", els.dialogBody).value = String(spec.first);
        $("#elemSpecBefore", els.dialogBody).value = String(spec.before);
        $("#elemSpecFont", els.dialogBody).value = spec.font || preferences.font;
        $("#elemSpecSize", els.dialogBody).value = String(spec.fontSize || preferences.fontSize);
        $("#elemSpecNext", els.dialogBody).value = spec.next;
        $("#elemSpecTab", els.dialogBody).value = spec.tab;
      });
    }
  }
  const THESAURUS_BANK = {
    look: ["gaze", "stare", "peer", "glance", "scrutinize", "survey", "eye", "watch", "scan", "glare"],
    walk: ["stride", "pace", "stroll", "march", "shuffle", "prowl", "saunter", "trudge", "stalk", "amble"],
    run: ["sprint", "bolt", "dash", "scramble", "charge", "dart", "race", "hurtle", "flee", "tear"],
    say: ["murmur", "whisper", "snap", "mutter", "declare", "bark", "deadpan", "bite out", "exhale", "rasp"],
    quiet: ["silent", "hushed", "still", "muted", "soundless", "noiseless", "stifled", "dormant"],
    dark: ["shadowy", "dim", "murky", "tenebrous", "bleak", "pitch-black", "shrouded", "moonless"],
    light: ["glow", "gleam", "shimmer", "glint", "flare", "radiance", "flicker", "beam", "strobe"],
    fear: ["dread", "panic", "terror", "unease", "tremor", "paranoia", "chill", "foreboding"],
    angry: ["furious", "seething", "livid", "incensed", "bristling", "cold", "volatile", "fierce"],
    hold: ["grip", "clutch", "clasp", "cradle", "clench", "pin", "brandish", "steady"],
    turn: ["pivot", "wheel", "spin", "whirl", "swivel", "twist", "veer", "angle"],
    stop: ["freeze", "halt", "stall", "hesitate", "check", "brake", "Falter", "pause"],
  };
  function openThesaurus() {
    const selection = window.getSelection();
    const selectedWord =
      selection && !selection.isCollapsed
        ? selection.toString().trim().toLowerCase()
        : "";
    const initialQuery = selectedWord || "look";
    modalActions.openDialog({
      eyebrow: "Proofing · Thesaurus",
      title: "Screenwriter's Thesaurus",
      body: `
        <label class="field"><span>Lookup action verb, tone, or word</span><input id="thesaurusInput" type="search" value="${escapeHtml(initialQuery)}" placeholder="e.g. look, walk, run, say, dark, light, fear…"></label>
        <div class="element-choices" id="thesaurusResults" style="margin-top:10px"></div>
        <div class="dialog-note" style="margin-top:10px">Click any synonym chip to insert or replace at the current caret position in the screenplay.</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    const input = $("#thesaurusInput", els.dialogBody);
    const results = $("#thesaurusResults", els.dialogBody);
    const renderSynonyms = (query) => {
      const q = String(query || "").trim().toLowerCase();
      let list = THESAURUS_BANK[q] || [];
      if (!list.length && q) {
        for (const [key, words] of Object.entries(THESAURUS_BANK)) {
          if (key.includes(q) || words.some((w) => w.toLowerCase().includes(q))) {
            list = Array.from(new Set([...list, key, ...words]));
          }
        }
      }
      if (!list.length) {
        list = ["stride", "gaze", "murmur", "sprint", "shimmer", "hesitate", "clutch", "pivot", "seething", "dread"];
      }
      results.innerHTML = list
        .map(
          (word) =>
            `<button type="button" class="element-choice" data-synonym="${escapeHtml(word)}">${escapeHtml(word)}</button>`,
        )
        .join("");
      $$("[data-synonym]", results).forEach((btn) => {
        btn.addEventListener("click", () => {
          const word = btn.dataset.synonym;
          modalActions.closeDialog();
          const el = activeParagraphElement();
          if (el) {
            el.focus({ preventScroll: true });
            document.execCommand("insertText", false, word);
            syncParagraphElement(el);
            fileActions.markDirty();
            documentSession.history.record();
            modalActions.toast("Synonym inserted", `Inserted “${word}” into ${el.dataset.type}.`, "success", 1800);
          }
        });
      });
    };
    renderSynonyms(initialQuery);
    if (input) {
      input.addEventListener("input", () => renderSynonyms(input.value));
    }
  }
  function openSpellcheckDialog() {
    const repeated = [];
    documentSession.doc.paragraphs.forEach((p, idx) => {
      const text = paragraphText(p);
      const match = text.match(/\b([a-zA-Z]{2,})\s+\1\b/i);
      if (match) {
        repeated.push({ id: p.id, type: p.type, index: idx + 1, word: match[1], snippet: speechActions.truncate(text, 70) });
      }
    });
    modalActions.openDialog({
      eyebrow: "Proofing · Spelling",
      title: "Spelling & Proofing check",
      body: `
        <div class="setting-line"><div><strong>Live browser spellcheck</strong><span>Underline misspelled words in the screenplay editor.</span></div><button type="button" class="switch ${preferences.spellcheck ? "is-on" : ""}" id="spellDialogToggle" role="switch" aria-checked="${preferences.spellcheck}"><span></span></button></div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:10px">
          ${
            repeated.length
              ? repeated
                  .map(
                    (item) =>
                      `<div class="shortcut-row"><span>Repeated word “<strong>${escapeHtml(item.word)}</strong>” in ${escapeHtml(item.type)}</span><kbd>Block ${item.index}</kbd></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No repeated words or proofing anomalies detected.</span><kbd>Clean</kbd></div>`
          }
        </div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
    const toggle = $("#spellDialogToggle", els.dialogBody);
    if (toggle) {
      toggle.addEventListener("click", () => {
        preferences.spellcheck = !preferences.spellcheck;
        toggle.classList.toggle("is-on", preferences.spellcheck);
        toggle.setAttribute("aria-checked", String(preferences.spellcheck));
        workspaceLayout.applyStudioAppearance();
        fileActions.persistPrefs();
      });
    }
  }
  /* ================================================================== */
  /* Ribbon feature implementations                                      */
  /* ================================================================== */
  /* Compat helper: several beat/character flows build paragraphs from
     pre-escaped HTML. Kept next to the model helpers. */
  function createParagraph(type, html, extra = {}) {
    const paragraph = makeParagraph(type, "", extra);
    paragraph.html = String(html == null ? "" : html);
    return paragraph;
  }
  /* ---------- editing ---------------------------------------------- */
  function pasteAsPlainText() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      modalActions.toast("Plain-text paste unavailable", "The clipboard API is not available in this build.", "warning", 2600);
      return;
    }
    const el = activeParagraphElement();
    if (!el) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount && el.contains(selection.anchorNode) && el.contains(selection.focusNode)
      ? selection.getRangeAt(0).cloneRange() : null;
    const documentAtPaste = documentSession.doc;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) return;
        if (!el.isConnected || documentSession.doc !== documentAtPaste) return;
        el.focus({ preventScroll: true });
        if (range) { selection.removeAllRanges(); selection.addRange(range); }
        else placeCaret(el, "end");
        onPaste({ target: el, preventDefault() {}, clipboardData: { getData: () => text } });
      })
      .catch(() => modalActions.toast("Plain-text paste unavailable", "Clipboard permission was denied.", "warning", 2600));
  }
  function deleteSelectionAction() {
    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount && !selection.isCollapsed && els.editor.contains(selection.anchorNode);
    if (hasSelection) {
      document.execCommand("delete");
      return;
    }
    const paragraph = activeParagraph();
    if (!paragraph) return;
    if (documentSession.doc.paragraphs.length <= 1) {
      paragraph.html = "";
      workspaceLayout.renderAll();
      fileActions.markDirty();
      return;
    }
    const index = documentSession.doc.paragraphs.indexOf(paragraph);
    documentSession.doc.paragraphs.splice(index, 1);
    pageActions.invalidateLayout();
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Paragraph deleted", "The block was removed from the script.", "info", 1800);
  }
  function selectCurrentScene() {
    const paragraph = activeParagraph();
    if (!paragraph) return;
    const scene = planningViews.sceneForParagraphId(paragraph.id);
    if (!scene) {
      ribbonActions.ribbonToast("No scene selected", "Place the caret inside a scene first.", "info", 2200);
      return;
    }
    const paragraphs = documentSession.doc.paragraphs.slice(scene.startIndex, scene.endIndex);
    const firstEl = paragraphElement(paragraphs[0].id);
    const lastEl = paragraphElement(paragraphs[paragraphs.length - 1].id);
    if (!firstEl || !lastEl) return;
    const range = document.createRange();
    range.setStart(firstEl, 0);
    range.setEnd(lastEl, lastEl.childNodes.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    ribbonActions.ribbonToast("Scene selected", `${scene.heading || "Scene"} · ${paragraphs.length} blocks`, "info", 2000);
  }
  function toggleTrackChanges() {
    editorState.trackChanges = !editorState.trackChanges;
    decorateEditor();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast(
      "Track Changes",
      editorState.trackChanges ? "Edits are now tracked. Accept or reject them from the Edit tab." : "New edits are no longer tracked.",
      "info",
      2600,
    );
  }
  function acceptCurrentChange() {
    const paragraph = activeParagraph();
    if (!paragraph || !paragraph.changeType) {
      ribbonActions.ribbonToast("No tracked change here", "Place the caret in a tracked paragraph first.", "info", 2200);
      return;
    }
    delete paragraph.changeType;
    delete paragraph.trackedOriginal;
    if (editorState.trackedBaseline) delete editorState.trackedBaseline[paragraph.id];
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Change accepted", "The tracked edit is now part of the draft.", "success", 1800);
  }
  function rejectCurrentChange() {
    const paragraph = activeParagraph();
    if (!paragraph || !paragraph.changeType) {
      ribbonActions.ribbonToast("No tracked change here", "Place the caret in a tracked paragraph first.", "info", 2200);
      return;
    }
    if (typeof paragraph.trackedOriginal === "string") {
      paragraph.html = paragraph.trackedOriginal;
    }
    delete paragraph.changeType;
    delete paragraph.trackedOriginal;
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Change rejected", "The paragraph was restored to its previous text.", "info", 2000);
  }
  function jumpToTrackedChange(direction) {
    const paragraphs = documentSession.doc.paragraphs;
    const current = activeParagraph();
    const start = current ? paragraphs.indexOf(current) : -1;
    const count = paragraphs.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (start + direction * step + count * 2) % count;
      const paragraph = paragraphs[index];
      if (paragraph && paragraph.changeType) {
        workspaceLayout.setView("script");
        focusParagraph(paragraph.id, "start");
        ribbonActions.ribbonToast("Tracked change", `${paragraph.type} · ${paragraphText(paragraph).slice(0, 60) || "empty"}`, "info", 2200);
        return;
      }
    }
    ribbonActions.ribbonToast("No tracked changes", "Track Changes is off or the draft has no tracked edits.", "info", 2400);
  }
  function selectionHasCapsStyle() {
    try {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return false;
      let node = selection.anchorNode;
      while (node && node !== els.editor) {
        if (node.nodeType === 1 && node.classList && node.classList.contains("caps-style")) return true;
        node = node.parentNode;
      }
      const paragraph = activeParagraph();
      return Boolean(paragraph && /caps-style/.test(paragraph.html || ""));
    } catch {
      return false;
    }
  }
  function applyAllCapsStyle() {
    if (!ribbonActions.restoreRibbonSelection()) {
      ribbonActions.ribbonToast("Select text first", "Highlight the words you want to set in capitals.", "info", 2400);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      ribbonActions.ribbonToast("Select text first", "Highlight the words you want to set in capitals.", "info", 2400);
      return;
    }
    let node = selection.anchorNode;
    while (node && node !== els.editor) {
      if (node.nodeType === 1 && node.classList && node.classList.contains("caps-style")) {
        const parent = node.parentNode;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        const paragraph = activeParagraph();
        if (paragraph) {
          const el = paragraphElement(paragraph.id);
          if (el) syncParagraphElement(el);
        }
        fileActions.markDirty();
        documentSession.history.record();
        ribbonActions.syncRibbon();
        return;
      }
      node = node.parentNode;
    }
    const text = selection.toString();
    if (!text) return;
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(
      "insertHTML",
      false,
      '<span class="caps-style" style="text-transform: uppercase">' + escapeHtml(text) + "</span>",
    );
    const paragraph = activeParagraph();
    if (paragraph) {
      const el = paragraphElement(paragraph.id);
      if (el) syncParagraphElement(el);
    }
    fileActions.markDirty();
    documentSession.history.record();
    ribbonActions.syncRibbon();
  }
  return {
    resetDocumentInput,
    acceptCurrentChange,
    activeParagraph,
    activeParagraphElement,
    applyAllCapsStyle,
    applyRevisionToElement,
    changeElementType,
    createParagraph,
    cycleCase,
    decorateEditor,
    deleteSelectionAction,
    focusParagraph,
    formatSelection,
    hideSmartType,
    insertScene,
    jumpToTrackedChange,
    markCurrentRevision,
    maybeAutoUppercase,
    moveScene,
    onCompositionEnd,
    onCompositionStart,
    onEditorBeforeInput,
    onEditorFocusIn,
    onEditorInput,
    onEditorKeyDown,
    onPaste,
    openElementSettings,
    openScriptNote,
    openSpellcheckDialog,
    openThesaurus,
    paragraphElement,
    pasteAsPlainText,
    placeCaret,
    rejectCurrentChange,
    renderEditor,
    renderOutlineAndRuler,
    renderSplitPane,
    scheduleChrome,
    scrollParagraphIntoView,
    selectCurrentScene,
    selectionHasCapsStyle,
    setActiveParagraph,
    swapSplitPanes,
    syncFormatButtons,
    syncInspectorForParagraph,
    toggleDualDialogue,
    toggleOutlineLayer,
    toggleRulerLayer,
    toggleSplitView,
    toggleTrackChanges
  };
};
