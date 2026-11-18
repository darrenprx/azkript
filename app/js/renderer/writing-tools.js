"use strict";

window.AzkriptRenderer.writingTools = function ({
  documentSession,
  editorActions,
  fileActions,
  interfaceState,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  productionActions,
  ribbonActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
}) {
  const { TAG_CATEGORIES, DEFAULT_MACROS } = FDModel;
  const { $, $$, ELEMENTS, els, escapeHtml, getCharacters, getScenes, getStats, icon, makeParagraph, paragraphText, sampleDocument, uid, validateDocument } = shared;

  function openAltDialogueDialog() {
    const active = editorActions.activeParagraph() || documentSession.doc.paragraphs.find((p) => p.type === "Dialogue") || documentSession.doc.paragraphs[0];
    if (!active) return;
    if (!Array.isArray(active.alts)) active.alts = [];
    const currentText = paragraphText(active);
    const allTakes = [currentText, ...active.alts];
    modalActions.openDialog({
      eyebrow: "Dialogue · Alternate Takes",
      title: "Alt Dialogue Manager",
      body: `
        <p class="dialog-note" style="margin-top:0">Store multiple alternate takes inside a single Dialogue paragraph and cycle through them anytime.</p>
        <div class="field">
          <span>Active Line (${escapeHtml(active.type)})</span>
          <input id="altPrimaryInput" type="text" value="${escapeHtml(currentText)}">
        </div>
        <div class="field">
          <span>Alternate Takes (one take per line)</span>
          <textarea id="altTakesInput" rows="4" placeholder="Enter alternate dialogue lines, one per line…">${escapeHtml(active.alts.join("\n"))}</textarea>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${allTakes
            .map(
              (take, idx) =>
                `<div class="shortcut-row"><span><strong>Take ${idx + 1}:</strong> ${escapeHtml(take || "(empty)")}</span><button type="button" class="pill-btn" data-use-take="${idx}">Make Active</button></div>`,
            )
            .join("")}
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Alts",
          kind: "primary",
          onClick: () => {
            const primary = $("#altPrimaryInput", els.dialogBody).value.trim();
            const takes = $("#altTakesInput", els.dialogBody)
              .value.split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            active.html = escapeHtml(primary);
            active.alts = takes;
            active.activeAlt = 0;
            const el = editorActions.paragraphElement(active.id);
            if (el) el.innerHTML = active.html;
            fileActions.markDirty();
            documentSession.history.record();
            editorActions.decorateEditor();
            modalActions.toast("Alt Dialogue saved", `${takes.length} alternate take${takes.length === 1 ? "" : "s"} stored on this line.`, "success");
          },
        },
      ],
    });
    $$("[data-use-take]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.useTake);
        if (idx === 0) return;
        const altText = active.alts[idx - 1];
        if (!altText) return;
        active.alts[idx - 1] = currentText;
        active.html = escapeHtml(altText);
        const el = editorActions.paragraphElement(active.id);
        if (el) el.innerHTML = active.html;
        modalActions.closeDialog();
        fileActions.markDirty();
        documentSession.history.record();
        editorActions.decorateEditor();
        modalActions.toast("Switched Alt Take", `Take ${idx + 1} is now active in the script.`, "success", 2000);
      });
    });
  }
  function cycleParagraphAlt(paragraphId) {
    const p = documentSession.doc.paragraphs.find((item) => item.id === paragraphId);
    if (!p || !Array.isArray(p.alts) || !p.alts.length) return;
    const current = paragraphText(p);
    const nextAlt = p.alts.shift();
    p.alts.push(current);
    p.html = escapeHtml(nextAlt);
    p.activeAlt = ((p.activeAlt || 0) + 1) % (p.alts.length + 1);
    const el = editorActions.paragraphElement(p.id);
    if (el) el.innerHTML = p.html;
    fileActions.markDirty();
    documentSession.history.record();
    editorActions.decorateEditor();
    modalActions.toast("Alt Take Cycled", `Switched to take ${p.activeAlt + 1} of ${p.alts.length + 1}.`, "info", 1800);
  }
  function openTagsDialog() {
    const active = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    if (!active) return;
    if (!Array.isArray(active.tags)) active.tags = [];
    const selectedText = (() => {
      const sel = window.getSelection();
      return sel && !sel.isCollapsed ? sel.toString().trim() : "";
    })();
    const defaultLabel = selectedText || speechActions.truncate(paragraphText(active), 36) || "Production Item";
    modalActions.openDialog({
      eyebrow: "Production · Breakdown Tags",
      title: "Tags & Production Breakdown",
      body: `
        <div class="field-grid">
          <label class="field"><span>Item Label</span><input id="tagLabelInput" type="text" maxlength="100" value="${escapeHtml(defaultLabel)}"></label>
          <label class="field"><span>Category</span><select id="tagCategorySelect">${TAG_CATEGORIES.map(
            (cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</option>`,
          ).join("")}</select></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            active.tags.length
              ? active.tags
                  .map(
                    (t, idx) =>
                      `<div class="shortcut-row"><span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(t.color)}"></span><strong>${escapeHtml(t.label)}</strong> · ${escapeHtml(t.category)}</span><button type="button" class="pill-btn" data-remove-tag="${idx}">Remove</button></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No tags attached to this paragraph yet.</span><kbd>Empty</kbd></div>`
          }
        </div>`,
      actions: [
        {
          label: "Tag All Characters",
          onClick: tagAllCharacters,
        },
        { label: "Close" },
        {
          label: "Add Tag",
          kind: "primary",
          onClick: () => {
            const label = $("#tagLabelInput", els.dialogBody).value.trim() || "Tagged Item";
            const catId = $("#tagCategorySelect", els.dialogBody).value;
            const cat = TAG_CATEGORIES.find((c) => c.id === catId) || TAG_CATEGORIES[0];
            active.tags.push({
              id: uid("tag"),
              category: cat.id,
              label,
              color: cat.color,
            });
            fileActions.markDirty();
            documentSession.history.record();
            editorActions.decorateEditor();
            planningViews.renderNavigatorSubTabs();
            modalActions.toast("Tag added", `${label} tagged under ${cat.label}.`, "success", 2000);
          },
        },
      ],
    });
    $$("[data-remove-tag]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.removeTag);
        active.tags.splice(idx, 1);
        fileActions.markDirty();
        documentSession.history.record();
        editorActions.decorateEditor();
        planningViews.renderNavigatorSubTabs();
        openTagsDialog();
      });
    });
  }
  function tagAllCharacters() {
    const chars = getCharacters(documentSession.doc);
    let added = 0;
    documentSession.doc.paragraphs.forEach((p) => {
      if (p.type !== "Character") return;
      const name = paragraphText(p).replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (!name) return;
      if (!Array.isArray(p.tags)) p.tags = [];
      if (!p.tags.some((t) => t.category === "cast" && t.label.toUpperCase() === name.toUpperCase())) {
        p.tags.push({ id: uid("tag"), category: "cast", label: name, color: "#0f6cbd" });
        added += 1;
      }
    });
    fileActions.markDirty();
    documentSession.history.record();
    editorActions.decorateEditor();
    planningViews.renderNavigatorSubTabs();
    modalActions.toast("Cast Tagged", `${added} character cues tagged for production breakdown (${chars.length} cast roles).`, "success");
  }
  function openBookmarksDialog(addDirect = false) {
    if (!Array.isArray(documentSession.doc.bookmarks)) documentSession.doc.bookmarks = [];
    const active = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    if (addDirect && active) {
      const label = `${active.type}: ${speechActions.truncate(paragraphText(active) || "Bookmark", 40)}`;
      documentSession.doc.bookmarks.push({ id: uid("bm"), paragraphId: active.id, label });
      fileActions.markDirty();
      documentSession.history.record();
      editorActions.decorateEditor();
      modalActions.toast("Bookmark added", label, "success", 2000);
      return;
    }
    modalActions.openDialog({
      eyebrow: "Navigation · Bookmarks",
      title: "Script Bookmarks",
      body: `
        <div class="field-grid">
          <label class="field" style="grid-column:1 / -1"><span>Bookmark Label for Current Line</span><input id="bmLabelInput" type="text" maxlength="100" value="${escapeHtml(active ? `${active.type} — ${speechActions.truncate(paragraphText(active), 34)}` : "Act Break")}"></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            documentSession.doc.bookmarks.length
              ? documentSession.doc.bookmarks
                  .map(
                    (bm, idx) =>
                      `<div class="shortcut-row"><span>${icon("bookmark")} <strong>${escapeHtml(bm.name || bm.label || "Bookmark")}</strong></span><span style="display:flex;gap:6px"><button type="button" class="pill-btn" data-bm-jump="${escapeHtml(bm.paragraphId)}">Go To</button><button type="button" class="pill-btn" data-bm-del="${idx}">Remove</button></span></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No bookmarks in this screenplay yet.</span><kbd>None</kbd></div>`
          }
        </div>`,
      actions: [
        { label: "Close" },
        {
          label: "Add Bookmark Here",
          kind: "primary",
          onClick: () => {
            if (!active) return;
            const label = $("#bmLabelInput", els.dialogBody).value.trim() || "Bookmark";
            documentSession.doc.bookmarks.push({ id: uid("bm"), paragraphId: active.id, label });
            fileActions.markDirty();
            documentSession.history.record();
            editorActions.decorateEditor();
            modalActions.toast("Bookmark saved", label, "success", 2000);
          },
        },
      ],
    });
    $$("[data-bm-jump]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        modalActions.closeDialog();
        workspaceLayout.setView("script");
        editorActions.focusParagraph(btn.dataset.bmJump, "start");
      });
    });
    $$("[data-bm-del]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        documentSession.doc.bookmarks.splice(Number(btn.dataset.bmDel), 1);
        fileActions.markDirty();
        editorActions.decorateEditor();
        openBookmarksDialog(false);
      });
    });
  }
  function openGoToDialog() {
    const scenes = getScenes(documentSession.doc);
    const totalPages = pageActions.pageCount();
    modalActions.openDialog({
      eyebrow: "Edit · Go To",
      title: "Jump to Page, Scene, or Paragraph",
      body: `
        <div class="field-grid">
          <label class="field"><span>Page Number (1–${totalPages})</span><input id="gotoPageInput" type="number" min="1" max="${totalPages}" placeholder="1"></label>
          <label class="field"><span>Scene (1–${scenes.length})</span><select id="gotoSceneSelect"><option value="">Select scene…</option>${scenes
            .map((s) => `<option value="${escapeHtml(s.id)}">${s.index}. ${escapeHtml(s.heading)}</option>`)
            .join("")}</select></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Go To",
          kind: "primary",
          onClick: () => {
            const sceneId = $("#gotoSceneSelect", els.dialogBody).value;
            const pageNum = Number($("#gotoPageInput", els.dialogBody).value);
            if (sceneId) {
              const targetScene = scenes.find((s) => s.id === sceneId);
              if (targetScene) planningViews.goToScene(targetScene);
              return;
            }
            if (pageNum > 0) {
              if (workspaceState.mode === "page") {
                // layout.pages may carry a title page at index 0, while the
                // dialog and the dock both speak in script page numbers.
                const titleOffset = documentSession.doc.titlePage && documentSession.doc.titlePage.enabled ? 1 : 0;
                pageActions.goToPage(pageNum - 1 + titleOffset);
              } else {
                // Use real pagination rather than the words/180 estimate on
                // scene.startPage, which disagrees with page view.
                const pageForScene = workspaceLayout.scenePageMap();
                const targetScene =
                  scenes.find((scene) => (pageForScene.get(scene.id) || Infinity) >= pageNum) ||
                  scenes[scenes.length - 1];
                if (targetScene) planningViews.goToScene(targetScene);
              }
            }
          },
        },
      ],
    });
  }
  function openSmartTypeDialog() {
    const st = documentSession.doc.smartType || (documentSession.doc.smartType = {
      characters: [],
      extensions: ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)", "(SUBTITLED)"],
      sceneIntros: ["INT.", "EXT.", "INT./EXT.", "I/E."],
      locations: [],
      times: ["DAY", "NIGHT", "DAWN", "DUSK", "LATER", "CONTINUOUS", "MOMENTS LATER", "SAME TIME"],
      transitions: ["CUT TO:", "SMASH CUT TO:", "MATCH CUT TO:", "DISSOLVE TO:", "FADE IN:", "FADE OUT.", "FADE TO BLACK."],
    });
    const autoChars = getCharacters(documentSession.doc).map((c) => c.name);
    const mergedChars = Array.from(new Set([...autoChars, ...(st.characters || [])]));
    modalActions.openDialog({
      eyebrow: "Document · SmartType Lists",
      title: "SmartType Autocomplete Lists",
      wide: true,
      body: `
        <div class="setting-line"><div><strong>SmartType Autocomplete</strong><span>Automatically suggest characters, extensions, scene intros, locations, times, and transitions.</span></div><button type="button" class="switch ${preferences.smartTypeEnabled ? "is-on" : ""}" id="stToggleSwitch" role="switch" aria-checked="${preferences.smartTypeEnabled}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Characters (one per line)</span><textarea id="stChars" rows="4">${escapeHtml(mergedChars.join("\n"))}</textarea></label>
          <label class="field"><span>Extensions</span><textarea id="stExts" rows="4">${escapeHtml((st.extensions || []).join("\n"))}</textarea></label>
          <label class="field"><span>Scene Intros</span><textarea id="stIntros" rows="4">${escapeHtml((st.sceneIntros || []).join("\n"))}</textarea></label>
          <label class="field"><span>Times of Day</span><textarea id="stTimes" rows="4">${escapeHtml((st.times || []).join("\n"))}</textarea></label>
          <label class="field" style="grid-column:1 / -1"><span>Transitions</span><textarea id="stTrans" rows="3">${escapeHtml((st.transitions || []).join("\n"))}</textarea></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save SmartType Lists",
          kind: "primary",
          onClick: () => {
            preferences.smartTypeEnabled = $("#stToggleSwitch", els.dialogBody).classList.contains("is-on");
            const splitLines = (id) =>
              $(`#${id}`, els.dialogBody)
                .value.split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
            st.characters = splitLines("stChars");
            st.extensions = splitLines("stExts");
            st.sceneIntros = splitLines("stIntros");
            st.times = splitLines("stTimes");
            st.transitions = splitLines("stTrans");
            fileActions.markDirty();
            fileActions.persistPrefs();
            modalActions.toast("SmartType updated", "Autocomplete dictionaries saved.", "success");
          },
        },
      ],
    });
    modalActions.bindDialogSwitch("stToggleSwitch");  }
  function openMacrosDialog() {
    const macros = documentSession.doc.macros || DEFAULT_MACROS;
    modalActions.openDialog({
      eyebrow: "Document · Macros",
      title: "Keyboard Macros",
      body: `
        <p class="dialog-note" style="margin-top:0">Click any macro to insert its text and switch to its target element immediately.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${macros
            .map(
              (m, idx) =>
                `<div class="shortcut-row"><span><strong>${escapeHtml(m.name)}</strong> → <code>${escapeHtml(m.text)}</code> (${escapeHtml(m.element)})</span><span style="display:flex;gap:6px"><kbd>${escapeHtml(m.key)}</kbd><button type="button" class="pill-btn" data-run-macro="${idx}">Insert</button></span></div>`,
            )
            .join("")}
        </div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
    $$("[data-run-macro]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = macros[Number(btn.dataset.runMacro)];
        if (!m) return;
        modalActions.closeDialog();
        editorActions.changeElementType(m.element || "Scene Heading");
        const active = editorActions.activeParagraph();
        if (active) {
          active.html = escapeHtml(m.text);
          const el = editorActions.paragraphElement(active.id);
          if (el) {
            el.innerHTML = active.html;
            editorActions.focusParagraph(active.id, "end");
          }
          fileActions.markDirty();
          documentSession.history.record();
          editorActions.scheduleChrome();
        }
      });
    });
  }
  function openNamesDatabaseDialog() {
    const names = [
      { name: "ELENA VANCE", category: "Female · Sci-Fi / Thriller" },
      { name: "MARCUS COLE", category: "Male · Drama / Noir" },
      { name: "SORA TAKAHASHI", category: "Unisex · Contemporary" },
      { name: "JULIAN MERCER", category: "Male · Prestige Drama" },
      { name: "CLARA VOSS", category: "Female · Mystery / Period" },
      { name: "DEVON REYES", category: "Unisex · Action / Ensemble" },
      { name: "NADIA KORzh", category: "Female · Espionage" },
      { name: "ARTHUR PENDLETON", category: "Male · Comedy / Historical" },
      { name: "ZARA AL-MANSOUR", category: "Female · Global Thriller" },
      { name: "JONAH STERLING", category: "Male · Western / Neo-Noir" },
      { name: "MAEUM PARK", category: "Unisex · Indie / Drama" },
      { name: "VICTOR KANE", category: "Male · Antagonist / Noir" },
    ];
    modalActions.openDialog({
      eyebrow: "Tools · Character Names Database",
      title: "Character Names Database",
      body: `
        <label class="field"><span>Filter character names</span><input id="namesFilterInput" type="search" placeholder="Search by name, style, or genre…"></label>
        <div class="shortcut-grid" id="namesDbList" style="grid-template-columns:1fr;max-height:300px;overflow:auto">
          ${names
            .map(
              (n) =>
                `<div class="shortcut-row" data-name-row="${escapeHtml(n.name.toLowerCase())} ${escapeHtml(n.category.toLowerCase())}"><span><strong>${escapeHtml(n.name)}</strong> · <small>${escapeHtml(n.category)}</small></span><button type="button" class="pill-btn" data-insert-name="${escapeHtml(n.name)}">Insert as Character</button></div>`,
            )
            .join("")}
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    const filterInput = $("#namesFilterInput", els.dialogBody);
    if (filterInput) {
      filterInput.addEventListener("input", () => {
        const q = filterInput.value.trim().toLowerCase();
        $$("[data-name-row]", els.dialogBody).forEach((row) => {
          row.hidden = Boolean(q && !row.dataset.nameRow.includes(q));
        });
      });
    }
    $$("[data-insert-name]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.insertName;
        modalActions.closeDialog();
        workspaceLayout.setView("script");
        const active = editorActions.activeParagraph();
        const index = active ? documentSession.doc.paragraphs.indexOf(active) + 1 : documentSession.doc.paragraphs.length;
        const p = editorActions.createParagraph("Character", escapeHtml(name));
        documentSession.doc.paragraphs.splice(index, 0, p);
        fileActions.markDirty();
        documentSession.history.record();
        workspaceLayout.renderAll();
        requestAnimationFrame(() => editorActions.focusParagraph(p.id, "end"));
        modalActions.toast("Character inserted", `${name} added to script.`, "success", 1800);
      });
    });
  }
  function openReformatDialog() {
    const active = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    modalActions.openDialog({
      eyebrow: "Tools · Reformat Tool",
      title: "Batch Reformat Elements",
      body: `
        <p class="dialog-note" style="margin-top:0">Convert the current paragraph or batch-convert matching paragraphs across the screenplay.</p>
        <div class="field-grid">
          <label class="field"><span>Current Element</span><input type="text" readonly value="${escapeHtml(active ? active.type : "Action")}"></label>
          <label class="field"><span>Convert To Element</span><select id="reformatTargetSelect">${Object.keys(ELEMENTS)
            .map((t) => `<option value="${escapeHtml(t)}"${active && active.type === t ? " selected" : ""}>${escapeHtml(t)}</option>`)
            .join("")}</select></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Reformat Current Block",
          kind: "primary",
          onClick: () => {
            const target = $("#reformatTargetSelect", els.dialogBody).value;
            editorActions.changeElementType(target);
            modalActions.toast("Paragraph reformatted", `Changed to ${target}.`, "success", 1800);
          },
        },
      ],
    });
  }
  function openScriptCompareDialog() {
    const sample = sampleDocument();
    const currentLines = documentSession.doc.paragraphs.map((p) => `[${p.type}] ${paragraphText(p)}`);
    const baselineLines = sample.paragraphs.map((p) => `[${p.type}] ${paragraphText(p)}`);
    const added = currentLines.filter((l) => !baselineLines.includes(l));
    const removed = baselineLines.filter((l) => !currentLines.includes(l));
    modalActions.openDialog({
      eyebrow: "Tools · ScriptCompare",
      title: "ScriptCompare — Draft Diff Analysis",
      wide: true,
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:repeat(3,1fr);margin-bottom:12px">
          <div class="stat-card"><strong>${documentSession.doc.paragraphs.length}</strong><span>Current Blocks</span></div>
          <div class="stat-card"><strong>+${added.length}</strong><span>Added / Modified</span></div>
          <div class="stat-card"><strong>-${removed.length}</strong><span>Removed vs Baseline</span></div>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;max-height:280px;overflow:auto">
          ${added
            .slice(0, 12)
            .map((line) => `<div class="shortcut-row" style="border-left:3px solid #107c41"><span>${escapeHtml(speechActions.truncate(line, 86))}</span><kbd>ADDED</kbd></div>`)
            .join("")}
          ${removed
            .slice(0, 12)
            .map((line) => `<div class="shortcut-row" style="border-left:3px solid #c50f1f"><span>${escapeHtml(speechActions.truncate(line, 86))}</span><kbd>REMOVED</kbd></div>`)
            .join("")}
          ${!added.length && !removed.length ? `<div class="shortcut-row"><span>Current script matches the baseline reference draft identically.</span><kbd>Identical</kbd></div>` : ""}
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
  }
  function openWritingStatsDialog() {
    const stats = getStats(documentSession.doc);
    const pages = pageActions.pageCount();
    const chars = getCharacters(documentSession.doc);
    modalActions.openDialog({
      eyebrow: "Tools · Productivity Analytics",
      title: "Writing Tracker & Session Statistics",
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:repeat(2,1fr);margin-bottom:14px">
          <div class="stat-card"><strong>${stats.words.toLocaleString()}</strong><span>Total Words</span></div>
          <div class="stat-card"><strong>${pages} / ${documentSession.doc.settings.targetPages}</strong><span>Page Progress</span></div>
          <div class="stat-card"><strong>${stats.scenes}</strong><span>Total Scenes</span></div>
          <div class="stat-card"><strong>${chars.length}</strong><span>Speaking Cast</span></div>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Estimated Screen Time</span><kbd>~${stats.readingMinutes} min</kbd></div>
          <div class="shortcut-row"><span>Dialogue vs Action Balance</span><kbd>${Math.round((stats.dialogueWords / Math.max(1, stats.words)) * 100)}% Dialogue</kbd></div>
          <div class="shortcut-row"><span>Revised Blocks</span><kbd>${stats.revised}</kbd></div>
        </div>`,
      actions: [
        {
          label: "Launch Sprint Timer",
          onClick: () => toggleSprintWidget(true),
        },
        { label: "Done", kind: "primary" },
      ],
    });
  }
  function openAskFdDialog() {
    modalActions.openDialog({
      eyebrow: "Help · Screenplay Help",      title: "Screenwriting & Formatting Assistant",
      body: `
        <label class="field"><span>Ask a question about screenplay format or Azkript tools</span><input id="askFdQuery" type="search" placeholder="e.g. How do I write a montage, dual dialogue, or intercut?"></label>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          <div class="shortcut-row"><span><strong>Dual Dialogue:</strong> Select a Character or Dialogue block and click Dual Dialogue (Ctrl+D) to place two speakers side by side.</span><kbd>Ctrl+D</kbd></div>
          <div class="shortcut-row"><span><strong>Alternate Dialogue:</strong> Click Alt Dialogue (+ Alt) in the Ribbon to store multiple takes inside any Dialogue block.</span><kbd>Alt Takes</kbd></div>
          <div class="shortcut-row"><span><strong>Beat Board → Script:</strong> Double-click anywhere on the Beat Board to create a beat, then click Send to Script to generate scenes.</span><kbd>Beat Board</kbd></div>
          <div class="shortcut-row"><span><strong>Production Tags:</strong> Open the Production tab or Navigator → Tags to tag Props, VFX, Stunts, Wardrobe, and Cast.</span><kbd>Breakdown</kbd></div>
          <div class="shortcut-row"><span><strong>Revision Mode:</strong> Turn on Revision Mode (Ctrl+Alt+V) to mark edited lines with industry-standard revision colors and asterisks.</span><kbd>Ctrl+Alt+V</kbd></div>
        </div>`,
      actions: [{ label: "Got it", kind: "primary" }],
    });
  }
  function openHighlightCharactersDialog() {
    const chars = getCharacters(documentSession.doc);
    if (!documentSession.doc.characterHighlights) documentSession.doc.characterHighlights = {};
    modalActions.openDialog({
      eyebrow: "View · Character Highlighting",
      title: "Highlight Characters in Script",
      body: `
        <p class="dialog-note" style="margin-top:0">Highlight specific characters' dialogue and cues directly on the screenplay page for table reads or dialogue polish.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${
            chars.length
              ? chars
                  .map((c) => {
                    const activeColor = documentSession.doc.characterHighlights[c.name] || "";
                    return `<div class="shortcut-row">
                      <span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color)}"></span><strong>${escapeHtml(c.name)}</strong> (${c.speeches} speeches)</span>
                      <button type="button" class="switch ${activeColor ? "is-on" : ""}" data-hl-char="${escapeHtml(c.name)}" data-hl-color="${escapeHtml(c.color)}" role="switch" aria-checked="${Boolean(activeColor)}"><span></span></button>
                    </div>`;
                  })
                  .join("")
              : `<div class="shortcut-row"><span>No speaking characters found yet.</span></div>`
          }
        </div>`,
      actions: [
        {
          label: "Clear All Highlights",
          onClick: () => {
            documentSession.doc.characterHighlights = {};
            fileActions.markDirty();
            editorActions.decorateEditor();
            modalActions.toast("Highlights cleared", "All character highlights removed.", "info", 1800);
          },
        },
        { label: "Done", kind: "primary" },
      ],
    });
    $$("[data-hl-char]", els.dialogBody).forEach((sw) => {
      sw.addEventListener("click", () => {
        const name = sw.dataset.hlChar;
        const color = sw.dataset.hlColor || "#0f6cbd";
        if (documentSession.doc.characterHighlights[name]) {
          delete documentSession.doc.characterHighlights[name];
          sw.classList.remove("is-on");
        } else {
          documentSession.doc.characterHighlights[name] = color;
          sw.classList.add("is-on");
        }
        fileActions.markDirty();
        editorActions.decorateEditor();
      });
    });
  }
  function openRenameCharacterDialog() {
    const chars = getCharacters(documentSession.doc);
    modalActions.openDialog({
      eyebrow: "Tools · Rename Character",
      title: "Batch Rename Character Across Script",
      body: `
        <div class="field-grid">
          <label class="field"><span>Existing Character</span><select id="renameFromSelect">${chars
            .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.speeches} speeches)</option>`)
            .join("")}</select></label>
          <label class="field"><span>New Character Name</span><input id="renameToInput" type="text" maxlength="80" placeholder="NEW NAME"></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Rename Everywhere",
          kind: "primary",
          onClick: () => {
            const fromName = $("#renameFromSelect", els.dialogBody)?.value;
            const toName = ($("#renameToInput", els.dialogBody)?.value || "").trim().toUpperCase();
            if (!fromName || !toName) return;
            let count = 0;
            documentSession.doc.paragraphs.forEach((p) => {
              if (p.type === "Character") {
                const raw = paragraphText(p);
                const clean = raw.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
                if (clean === fromName.toUpperCase()) {
                  const extMatch = raw.match(/(\s*\([^)]*\)\s*)$/);
                  p.html = escapeHtml(toName + (extMatch ? extMatch[1] : ""));
                  count += 1;
                }
              }
            });
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Character renamed", `Updated ${count} cues from ${fromName} to ${toName}.`, "success");
          },
        },
      ],
    });
  }
  function openNonSpeakingDialog() {
    if (!Array.isArray(documentSession.doc.nonSpeaking)) documentSession.doc.nonSpeaking = [];
    modalActions.openDialog({
      eyebrow: "Cast · Non-Speaking Characters",
      title: "Non-Speaking Cast & Background Roles",
      body: `
        <div class="field-grid">
          <label class="field"><span>Character Name</span><input id="nsNameInput" type="text" placeholder="GUARD #1"></label>
          <label class="field"><span>Role / Description</span><input id="nsRoleInput" type="text" placeholder="Silent sentry at gate"></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            documentSession.doc.nonSpeaking.length
              ? documentSession.doc.nonSpeaking
                  .map(
                    (ns, idx) =>
                      `<div class="shortcut-row"><span><strong>${escapeHtml(ns.name)}</strong> · ${escapeHtml(ns.notes || "Non-speaking")}</span><button type="button" class="pill-btn" data-del-ns="${idx}">Remove</button></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No non-speaking characters added yet.</span><kbd>0</kbd></div>`
          }
        </div>`,
      actions: [
        { label: "Close" },
        {
          label: "Add Non-Speaking Role",
          kind: "primary",
          onClick: () => {
            const name = ($("#nsNameInput", els.dialogBody).value || "").trim().toUpperCase();
            const notes = ($("#nsRoleInput", els.dialogBody).value || "").trim();
            if (!name) return;
            documentSession.doc.nonSpeaking.push({ id: uid("ns"), name, notes, scenes: [1] });
            fileActions.markDirty();
            documentSession.history.record();
            planningViews.renderCharacters();
            modalActions.toast("Non-speaking role added", `${name} added to Cast list.`, "success");
          },
        },
      ],
    });
    $$("[data-del-ns]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        documentSession.doc.nonSpeaking.splice(Number(btn.dataset.delNs), 1);
        fileActions.markDirty();
        planningViews.renderCharacters();
        openNonSpeakingDialog();
      });
    });
  }
  function openEmojiDialog() {
    const symbols = ["🎬", "🎥", "⭐", "🔥", "⚡", "💡", "📌", "🎵", "☎️", "✉️", "🔒", "⏱️", "✓", "✗", "—", "…", "§", "©", "®", "™"];
    modalActions.openDialog({
      eyebrow: "Insert · Emoji & Symbols",
      title: "Insert Symbol or Emoji",
      body: `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${symbols
        .map(
          (sym) =>
            `<button type="button" class="pill-btn" data-insert-sym="${escapeHtml(sym)}" style="justify-content:center;font-size:18px;padding:10px">${escapeHtml(sym)}</button>`,
        )
        .join("")}</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-insert-sym]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const sym = btn.dataset.insertSym;
        modalActions.closeDialog();
        const active = editorActions.activeParagraph();
        if (active) {
          active.html = `${active.html || ""}${escapeHtml(sym)}`;
          const el = editorActions.paragraphElement(active.id);
          if (el) el.innerHTML = active.html;
          fileActions.markDirty();
          documentSession.history.record();
        }
      });
    });
  }
  function insertPageBreak() {
    const active = editorActions.activeParagraph();
    if (!active) return;
    active.pageBreakBefore = !active.pageBreakBefore;
    pageActions.invalidateLayout();
    fileActions.markDirty();
    documentSession.history.record();
    editorActions.decorateEditor();
    modalActions.toast(
      active.pageBreakBefore ? "Page Break inserted" : "Page Break removed",
      active.pageBreakBefore ? "This paragraph will begin on a new page." : "Automatic page flow restored.",
      "info",
      2000,
    );
  }
  function insertImageMarker() {
    modalActions.openDialog({
      eyebrow: "Insert · Script Image",
      title: "Insert Storyboard / Reference Image",
      body: `
        <label class="field"><span>Image Caption / Visual Reference</span><input id="imgCaptionInput" type="text" placeholder="Storyboard Frame 14 — Beacon Array"></label>
        <label class="field"><span>Image URL or Local Asset Path (optional)</span><input id="imgUrlInput" type="text" placeholder="https://…"></label>
        <p class="dialog-note">This adds a caption and file reference. To embed an image, use Story studio → Storyboard and animatic.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Insert Image Block",
          kind: "primary",
          onClick: () => {
            const caption = $("#imgCaptionInput", els.dialogBody).value.trim() || "Visual Reference";
            const active = editorActions.activeParagraph();
            const index = active ? documentSession.doc.paragraphs.indexOf(active) + 1 : documentSession.doc.paragraphs.length;
            const p = editorActions.createParagraph("Action", escapeHtml(`[IMAGE: ${caption}]`), {
              image: { caption, url: $("#imgUrlInput", els.dialogBody).value.trim() },
            });
            documentSession.doc.paragraphs.splice(index, 0, p);
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Image reference inserted", caption, "success", 2000);
          },
        },
      ],
    });
  }
  function exportFountainOrText(format = "txt") {
    const lines = [];
    lines.push(`Title: ${documentSession.doc.title || "Untitled Screenplay"}`);
    lines.push(`Author: ${documentSession.doc.author || ""}`);
    lines.push("");
    documentSession.doc.paragraphs.forEach((p) => {
      const text = paragraphText(p);
      if (format === "fountain") {
        if (p.type === "Scene Heading") lines.push(`\n.${text.toUpperCase()}`);
        else if (p.type === "Character") lines.push(`\n@${text.toUpperCase()}`);
        else if (p.type === "Transition") lines.push(`\n> ${text.toUpperCase()}`);
        else lines.push(text);
      } else {
        lines.push(p.type === "Character" || p.type === "Dialogue" ? `    ${text}` : text);
      }
    });
    const ext = format === "fountain" ? "fountain" : "txt";
    const filename = `${(documentSession.doc.title || "screenplay").replace(/[<>:"/\\|?*]/g, "").trim() || "screenplay"}.${ext}`;
    FDX.download(filename, lines.join("\n"), "text/plain;charset=utf-8");
    modalActions.toast(`Exported .${ext.toUpperCase()}`, `${filename} downloaded.`, "success");
  }
  function toggleSprintWidget(force) {
    const widget = $("#sprintWidget");
    if (!widget) return;
    const open = typeof force === "boolean" ? force : widget.hidden;
    widget.hidden = !open;
    /* Track real visibility in state. The ribbon button's active state is
     * `state.sprint.open || state.sprint.running`, and `sprint.open` was never
     * assigned anywhere, so closing the panel during a run left the button lit
     * with the timer still counting — and clicking that lit button reopened the
     * panel instead of stopping the sprint. */
    interfaceState.sprint.open = open;
    if (open) updateSprintUI();
    ribbonActions.syncRibbon();
  }
  function updateSprintUI() {
    const clock = $("#sprintClock");
    const toggleBtn = $("#sprintToggleBtn");
    const deltaEl = $("#sprintWordDelta");
    if (clock) {
      const m = Math.floor(interfaceState.sprint.remainingSec / 60);
      const s = interfaceState.sprint.remainingSec % 60;
      clock.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if (toggleBtn) {
      toggleBtn.textContent = interfaceState.sprint.running ? "Pause" : "Start";
    }
    /* The word delta is the panel's main feedback signal; it had no writer at
     * all, so it read "+0 words this sprint" no matter how much was typed.
     * Before a sprint has ever run, startWords is 0 and the delta would show
     * the whole document's word count, which is meaningless — show nothing
     * until the sprint actually begins. */
    if (deltaEl) {
      if (!interfaceState.sprint.startWords) {
        deltaEl.textContent = interfaceState.sprint.running ? "Counting words…" : "Words written this sprint";
      } else {
        const written = Math.max(0, getStats(documentSession.doc).words - interfaceState.sprint.startWords);
        deltaEl.textContent = `+${written.toLocaleString()} ${written === 1 ? "word" : "words"} this sprint`;
      }
    }
    ribbonActions.syncRibbon();
  }
  function startOrPauseSprint() {
    if (interfaceState.sprint.running) {
      clearInterval(interfaceState.sprint.timer);
      interfaceState.sprint.running = false;
      updateSprintUI();
      return;
    }
    const stats = getStats(documentSession.doc);
    if (!interfaceState.sprint.startWords) interfaceState.sprint.startWords = stats.words;
    interfaceState.sprint.running = true;
    updateSprintUI();
    interfaceState.sprint.timer = setInterval(() => {
      interfaceState.sprint.remainingSec = Math.max(0, interfaceState.sprint.remainingSec - 1);
      updateSprintUI();
      if (interfaceState.sprint.remainingSec <= 0) {
        clearInterval(interfaceState.sprint.timer);
        interfaceState.sprint.running = false;
        updateSprintUI();
        const delta = Math.max(0, getStats(documentSession.doc).words - interfaceState.sprint.startWords);
        modalActions.toast("Writing Sprint Complete!", `You wrote ${delta} new words during this sprint.`, "success", 5000);
      }
    }, 1000);
  }
  function resetSprint() {
    clearInterval(interfaceState.sprint.timer);
    interfaceState.sprint.running = false;
    const durSelect = $("#sprintDurationSelect");
    const mins = Number(durSelect?.value) || 25;
    interfaceState.sprint.durationSec = mins * 60;
    interfaceState.sprint.remainingSec = mins * 60;
    interfaceState.sprint.startWords = getStats(documentSession.doc).words;
    updateSprintUI();
  }
  /* ---------- insert ----------------------------------------------- */
  function insertLabelDialog() {
    modalActions.openDialog({
      eyebrow: "Insert · Label",
      title: "Insert a production label",
      body: `
        <label class="field"><span>Label text</span><input id="labelTextInput" type="text" maxlength="80" placeholder="INSERT - CLOSE ON THE TELESCOPE"></label>
        <label class="field"><span>Color</span><select id="labelColorInput">
          <option value="#0f6cbd">Cobalt</option>
          <option value="#6b48a8">Violet</option>
          <option value="#03787c">Teal</option>
          <option value="#c2500e">Amber</option>
          <option value="#b8252a">Crimson</option>
        </select></label>
        <p class="dialog-note">Labels are production markers that stand apart from action and dialogue.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Insert label",
          kind: "primary",
          onClick: () => {
            const text = $("#labelTextInput", els.dialogBody).value.trim() || "PRODUCTION LABEL";
            const color = $("#labelColorInput", els.dialogBody).value;
            const active = editorActions.activeParagraph();
            const index = active ? documentSession.doc.paragraphs.indexOf(active) + 1 : documentSession.doc.paragraphs.length;
            const paragraph = makeParagraph("General", "", {});
            paragraph.html = `<span class="script-label" style="--label-color:${escapeHtml(color)}">${escapeHtml(text.toUpperCase())}</span>`;
            documentSession.doc.paragraphs.splice(index, 0, paragraph);
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            setTimeout(() => editorActions.focusParagraph(paragraph.id, "end"), 30);
            modalActions.toast("Label inserted", text, "success", 2000);
          },
        },
      ],
    });
  }
  function removeAlternateTake() {
    const paragraph = editorActions.activeParagraph();
    if (!paragraph || !Array.isArray(paragraph.alts) || !paragraph.alts.length) {
      ribbonActions.ribbonToast("No alternate takes", "Select a dialogue paragraph with an alternate take.", "info", 2200);
      return;
    }
    const index = Number(paragraph.activeAlt) || 0;
    paragraph.alts.splice(index, 1);
    paragraph.activeAlt = Math.max(0, Math.min(index, paragraph.alts.length - 1));
    if (!paragraph.alts.length) {
      delete paragraph.alts;
      delete paragraph.activeAlt;
    }
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Alternate removed", "The active take was deleted.", "info", 1800);
  }
  function openFormatAssistantDialog() {
    const issues = validateDocument(documentSession.doc);
    const extra = [];
    documentSession.doc.paragraphs.forEach((paragraph, index) => {
      const text = paragraphText(paragraph).trim();
      if (!text) return;
      if (paragraph.type === "Scene Heading" && !/^(INT|EXT|I\/E|EST)[.\s]/i.test(text) && !/^(ACT|END OF ACT)/i.test(text)) {
        extra.push({ code: "SCENE_HEADING", message: `Scene heading “${text.slice(0, 48)}” does not start with INT./EXT.`, index });
      }
      if (paragraph.type === "Character" && text !== text.toUpperCase()) {
        extra.push({ code: "CHARACTER_CASE", message: `Character cue “${text.slice(0, 48)}” should be uppercase.`, index });
      }
    });
    const all = [...issues, ...extra];
    modalActions.openDialog({
      eyebrow: "Tools · Format Assistant",
      title: all.length ? `${all.length} formatting note${all.length === 1 ? "" : "s"}` : "Formatting looks clean",
      body: all.length
        ? `<div class="shortcut-grid" style="grid-template-columns:1fr">${all
            .slice(0, 30)
            .map(
              (issue) =>
                `<button type="button" class="shortcut-row" data-format-jump="${issue.index != null ? issue.index : ""}" style="border:0;background:transparent;text-align:left;width:100%"><span><strong>${escapeHtml(issue.code)}</strong><br>${escapeHtml(issue.message)}</span><kbd>${escapeHtml(issue.severity || "note")}</kbd></button>`,
            )
            .join("")}</div><p class="dialog-note">Click a note to jump to the paragraph in the script.</p>`
        : `<p class="dialog-note">No scene-heading or character-cue problems were found. The document also passed the structural validation check.</p>`,
      actions: [
        { label: "Run document check", onClick: () => { modalActions.closeDialog(); productionActions.validateDocumentAction(); } },
        { label: "Done", kind: "primary" },
      ],
    });
    $$("[data-format-jump]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const target = documentSession.doc.paragraphs[Number(button.dataset.formatJump)];
        if (!target) return;
        modalActions.closeDialog();
        workspaceLayout.setView("script");
        editorActions.focusParagraph(target.id, "start");
      });
    });
  }
  function openWritingReliability() {
    const fonts = [...new Set([preferences.font, ...Object.values(documentSession.doc.elements || {}).map(spec => spec.font).filter(Boolean)])];
    const diagnostics = fonts.map(font => FDCoreWriting.typography(font, preferences.fontSize));
    modalActions.openDialog({ eyebrow: "Writing environment", title: "Typography and accessibility", wide: true,
      body: `<label class="field">Typography<select id="typographyMode" class="input"><option value="document" ${preferences.typographyMode === 'document' ? 'selected' : ''}>Document fonts and geometry</option><option value="workspace" ${preferences.typographyMode === 'workspace' ? 'selected' : ''}>Workspace font override</option></select></label>
        <label class="field">Interface scale<select id="interfaceScale" class="input">${[1, 1.25, 1.5, 2].map(scale => `<option value="${scale}" ${preferences.uiScale === scale ? 'selected' : ''}>${scale * 100}%</option>`).join('')}</select></label>
        <div class="safety-facts">${diagnostics.map(item => `<p><strong>${escapeHtml(item.family)}</strong> — ${item.available ? 'Available' : 'Not detected; a fallback font will be used'}</p>`).join('')}</div>
        <div class="dialog-note">Measured font advances feed the shared page engine. Font substitution can change wrapping. Pagination equivalence with another editor is not certified.</div>
        <p>Workspace overrides affect the editor and PDF/print. FDX keeps the document's font requests. Use Elements Settings to change fonts saved in the document.</p>
        <p>Tab and Shift+Tab navigate dialogs. Arrow keys move between ribbon tabs. Escape closes menus and dialogs. System high contrast is supported.</p>`,
      actions: [{ label: "Apply", kind: "primary", onClick: () => {
        preferences.typographyMode = $("#typographyMode").value;
        preferences.uiScale = Number($("#interfaceScale").value);
        workspaceLayout.applyInterfaceScale();
        pageActions.invalidateLayout(); fileActions.persistPrefs(); workspaceLayout.renderAll();
      } }, { label: "Cancel" }],
    });
  }
  async function copyText(text, title, message) {
    try {
      await navigator.clipboard.writeText(text);
      modalActions.toast(title, message, "success");
    } catch {
      modalActions.openDialog({
        eyebrow: "Clipboard",
        title,
        body: `<textarea class="outline-copy" readonly>${escapeHtml(text)}</textarea>`,
        actions: [{ label: "Close", kind: "primary" }],
      });
      requestAnimationFrame(() => {
        const textarea = $(".outline-copy", els.dialogBody);
        if (textarea) textarea.select();
      });
    }
  }
  return {
    copyText,
    cycleParagraphAlt,
    exportFountainOrText,
    insertImageMarker,
    insertLabelDialog,
    insertPageBreak,
    openAltDialogueDialog,
    openAskFdDialog,
    openBookmarksDialog,
    openEmojiDialog,
    openFormatAssistantDialog,
    openGoToDialog,
    openHighlightCharactersDialog,
    openMacrosDialog,
    openNamesDatabaseDialog,
    openNonSpeakingDialog,
    openReformatDialog,
    openRenameCharacterDialog,
    openScriptCompareDialog,
    openSmartTypeDialog,
    openTagsDialog,
    openWritingReliability,
    openWritingStatsDialog,
    removeAlternateTake,
    resetSprint,
    startOrPauseSprint,
    tagAllCharacters,
    toggleSprintWidget,
    updateSprintUI
  };
};
