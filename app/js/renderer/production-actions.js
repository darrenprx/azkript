"use strict";

window.AzkriptRenderer.productionActions = function ({
  documentSession,
  editorActions,
  editorState,
  featurePanels,
  fileActions,
  modalActions,
  pageActions,
  planningViews,
  ribbonActions,
  shared,
  workspaceLayout,
}) {
  const { $, $$, PALETTE, clamp, els, escapeHtml, getScenes, getStats, markRevision, nextRevision, revisionEntry, validateDocument } = shared;

  function openHeaderFooterDialog() {
    const hf = documentSession.doc.headerFooter || (documentSession.doc.headerFooter = {
      enabled: true,
      left: "",
      center: "",
      right: "{PAGE}.",
      footerLeft: "",
      footerRight: "",
      showOnFirstPage: false,
      startingPageNumber: 1,
    });
    modalActions.openDialog({
      eyebrow: "Document · Header & Footer",
      title: "Header and Footer Setup",
      body: `
        <div class="setting-line"><div><strong>Show Header Bar</strong><span>Display running header on script pages.</span></div><button type="button" class="switch ${hf.enabled !== false ? "is-on" : ""}" id="hfEnabledSwitch" role="switch" aria-checked="${hf.enabled !== false}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Header Left</span><input id="hfLeft" type="text" value="${escapeHtml(hf.left || "")}" placeholder="Title / Draft"></label>
          <label class="field"><span>Header Center</span><input id="hfCenter" type="text" value="${escapeHtml(hf.center || "")}" placeholder="Revision / Date"></label>
          <label class="field"><span>Header Right</span><input id="hfRight" type="text" value="${escapeHtml(hf.right || "{PAGE}.")}" placeholder="{PAGE}."></label>
          <label class="field"><span>Starting Page #</span><input id="hfStartPage" type="number" min="1" max="999" value="${hf.startingPageNumber || 1}"></label>
          <label class="field"><span>Footer Left</span><input id="hfFooterLeft" type="text" value="${escapeHtml(hf.footerLeft || "")}" placeholder="Confidential"></label>
          <label class="field"><span>Footer Right</span><input id="hfFooterRight" type="text" value="${escapeHtml(hf.footerRight || "")}" placeholder="Azkript"></label>
        </div>
        <div class="setting-line"><div><strong>Show Header on First Page</strong><span>Print header on Page 1 of the screenplay.</span></div><button type="button" class="switch ${hf.showOnFirstPage ? "is-on" : ""}" id="hfFirstPageSwitch" role="switch" aria-checked="${Boolean(hf.showOnFirstPage)}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Header & Footer",
          kind: "primary",
          onClick: () => {
            hf.enabled = $("#hfEnabledSwitch", els.dialogBody).classList.contains("is-on");
            hf.left = $("#hfLeft", els.dialogBody).value.trim();
            hf.center = $("#hfCenter", els.dialogBody).value.trim();
            hf.right = $("#hfRight", els.dialogBody).value.trim();
            hf.startingPageNumber = clamp(Number($("#hfStartPage", els.dialogBody).value) || 1, 1, 999);
            hf.footerLeft = $("#hfFooterLeft", els.dialogBody).value.trim();
            hf.footerRight = $("#hfFooterRight", els.dialogBody).value.trim();
            hf.showOnFirstPage = $("#hfFirstPageSwitch", els.dialogBody).classList.contains("is-on");
            hf.showHeader = hf.enabled !== false;
            hf.showFooter = Boolean(hf.footerLeft || hf.footerRight || hf.footerText);
            hf.headerText = [hf.left, hf.center, hf.right].filter(Boolean).join("    ");
            hf.footerText = [hf.footerLeft, hf.footerRight].filter(Boolean).join("    ");
            hf.startingPage = hf.startingPageNumber;
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Header & Footer updated", "Running page headers and footers saved.", "success");
          },
        },
      ],
    });
    ["hfEnabledSwitch", "hfFirstPageSwitch"].forEach((id) => modalActions.bindDialogSwitch(id));  }
  function openMoresDialog() {
    /* normalizeDocument always supplies moresContinueds using the model's own
     * key names (dialogueCont / sceneContTop / sceneContBottom /
     * autoCharacterCont). The dialog previously read a parallel set of names
     * that never existed, so the inputs rendered the literal text "undefined". */
    const mc = documentSession.doc.moresContinueds || (documentSession.doc.moresContinueds = {
      dialogueMore: "(MORE)",
      dialogueCont: "(CONT'D)",
      sceneContTop: "CONTINUED:",
      sceneContBottom: "(CONTINUED)",
      autoCharacterCont: true,
      includeSceneNumber: true,
    });
    const mcDialogueCont = mc.dialogueCont != null ? mc.dialogueCont : mc.dialogueContinued;
    const mcSceneBottom = mc.sceneContBottom != null ? mc.sceneContBottom : mc.sceneContinuedBottom;
    const mcSceneTop = mc.sceneContTop != null ? mc.sceneContTop : mc.sceneContinuedTop;
    const mcAutoChar = mc.autoCharacterCont != null ? mc.autoCharacterCont : mc.autoCharacterContinued;
    modalActions.openDialog({
      eyebrow: "Document · Mores & Continueds",
      title: "Mores and Continueds",
      body: `
        <div class="field-grid">
          <label class="field"><span>Dialogue Bottom</span><input id="mcMore" type="text" value="${escapeHtml(mc.dialogueMore)}"></label>
          <label class="field"><span>Dialogue Top</span><input id="mcContd" type="text" value="${escapeHtml(mcDialogueCont)}"></label>
          <label class="field"><span>Scene Bottom</span><input id="mcSceneBot" type="text" value="${escapeHtml(mcSceneBottom)}"></label>
          <label class="field"><span>Scene Top</span><input id="mcSceneTop" type="text" value="${escapeHtml(mcSceneTop)}"></label>
        </div>
        <div class="setting-line"><div><strong>Automatic Character (CONT'D)</strong><span>Append (CONT'D) when the same character speaks again without interruption.</span></div><button type="button" class="switch ${mcAutoChar ? "is-on" : ""}" id="mcAutoChar" role="switch" aria-checked="${mcAutoChar}"><span></span></button></div>
        <div class="setting-line"><div><strong>Dialogue page-break (MORE) / (CONT'D)</strong><span>Mark split speeches across page breaks.</span></div><button type="button" class="switch ${documentSession.doc.settings.showMore !== false ? "is-on" : ""}" id="mcShowMore" role="switch" aria-checked="${documentSession.doc.settings.showMore !== false}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            mc.dialogueMore = $("#mcMore", els.dialogBody).value.trim() || "(MORE)";
            mc.dialogueCont = $("#mcContd", els.dialogBody).value.trim() || "(CONT'D)";
            mc.sceneContBottom = $("#mcSceneBot", els.dialogBody).value.trim() || "(CONTINUED)";
            mc.sceneContTop = $("#mcSceneTop", els.dialogBody).value.trim() || "CONTINUED:";
            mc.autoCharacterCont = $("#mcAutoChar", els.dialogBody).classList.contains("is-on");
            documentSession.doc.settings.showMore = $("#mcShowMore", els.dialogBody).classList.contains("is-on");
            pageActions.invalidateLayout();
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Mores & Continueds updated", "Page continuation markers updated.", "success");
          },
        },
      ],
    });
    ["mcAutoChar", "mcShowMore"].forEach((id) => modalActions.bindDialogSwitch(id));  }
  function openWatermarkDialog() {
    const wm = documentSession.doc.watermark || (documentSession.doc.watermark = { enabled: false, text: "CONFIDENTIAL", opacity: 14 });
    modalActions.openDialog({
      eyebrow: "Document · Security Watermark",
      title: "Page Watermark",
      body: `
        <div class="setting-line"><div><strong>Enable Watermark</strong><span>Stamp diagonal security text across script pages and PDF exports.</span></div><button type="button" class="switch ${wm.enabled ? "is-on" : ""}" id="wmEnabledSwitch" role="switch" aria-checked="${wm.enabled}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Watermark Text</span><input id="wmTextInput" type="text" maxlength="60" value="${escapeHtml(wm.text || "CONFIDENTIAL")}"></label>
          <label class="field"><span>Opacity (%)</span><input id="wmOpacityInput" type="number" min="2" max="35" value="${Math.round(wm.opacity || 14)}"></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply Watermark",
          kind: "primary",
          onClick: () => {
            wm.enabled = $("#wmEnabledSwitch", els.dialogBody).classList.contains("is-on");
            wm.text = $("#wmTextInput", els.dialogBody).value.trim() || "CONFIDENTIAL";
            wm.opacity = clamp(Number($("#wmOpacityInput", els.dialogBody).value) || 14, 2, 35);
            fileActions.markDirty();
            documentSession.history.record();
            editorActions.decorateEditor();
            modalActions.toast("Watermark updated", wm.enabled ? `Watermark “${wm.text}” enabled.` : "Watermark turned off.", "success");
          },
        },
      ],
    });
    modalActions.bindDialogSwitch("wmEnabledSwitch");  }
  function openLockPagesDialog() { return featurePanels.productionUI?.locking(); }
  /* ---------- document / production -------------------------------- */
  function openTargetLengthDialog() {
    modalActions.openDialog({
      eyebrow: "Document · Length",
      title: "Target Script Length",
      body: `
        <div class="field-grid">
          <label class="field"><span>Target pages</span><input id="targetLengthInput" type="number" min="1" max="999" value="${escapeHtml(String(documentSession.doc.settings.targetPages))}"></label>
          <label class="field"><span>Current length</span><input type="text" value="${pageActions.pageCount()} pages · ${getStats(documentSession.doc).words.toLocaleString()} words" readonly></label>
        </div>
        <p class="dialog-note">Progress appears in the navigator footer, reports and the status bar.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Set target",
          kind: "primary",
          onClick: () => {
            documentSession.doc.settings.targetPages = clamp(Number($("#targetLengthInput", els.dialogBody).value) || 120, 1, 999);
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Target updated", `${documentSession.doc.settings.targetPages} pages.`, "success", 2000);
          },
        },
      ],
    });
  }
  function editSceneNumberDialog() {
    const paragraph = editorActions.activeParagraph();
    const scene = paragraph ? planningViews.sceneForParagraphId(paragraph.id) : null;
    if (!scene) {
      ribbonActions.ribbonToast("No scene selected", "Place the caret inside a scene first.", "info", 2400);
      return;
    }
    modalActions.openDialog({
      eyebrow: "Production · Scene Numbers",
      title: "Edit Scene Number",
      body: `
        <label class="field"><span>Scene number override</span><input id="dialogSceneNumber" type="text" maxlength="12" value="${escapeHtml(scene.paragraph.scene?.number || "")}" placeholder="${escapeHtml(scene.automaticNumber)}"></label>
        <p class="dialog-note">Leave blank to use ${escapeHtml(scene.automaticNumber)}.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            const target = documentSession.doc.paragraphs.find(entry => entry.id === scene.id);
            const number = $("#dialogSceneNumber", els.dialogBody).value.trim();
            if (target?.type !== "Scene Heading" || number === (target.scene?.number || "")) return;
            documentSession.history.finishBurst();
            target.scene = { ...target.scene, number };
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Scene number updated", number || "Automatic numbering restored.", "success", 2000);
          },
        },
      ],
    });
  }
  function resetSceneNumbersDialog() {
    if (documentSession.doc.production.lock) {
      ribbonActions.ribbonToast("Pages are locked", "Unlock pagination before resetting scene numbers.", "info", 3500);
      return;
    }
    modalActions.openDialog({
      eyebrow: "Production · Scene Numbers",
      title: "Reset Scene Numbers",
      body: "<p>Remove scene number overrides and number scenes in script order, starting at 1.</p>",
      actions: [
        { label: "Cancel" },
        {
          label: "Reset Scene Numbers",
          kind: "primary",
          onClick: () => {
            documentSession.history.finishBurst();
            delete documentSession.doc.production.sceneNumbers;
            for (const paragraph of documentSession.doc.paragraphs) {
              if (paragraph.type === "Scene Heading" && paragraph.scene?.number) paragraph.scene.number = "";
            }
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
          },
        },
      ],
    });
  }
  function omitCurrentScene() {
    const paragraph = editorActions.activeParagraph();
    const scene = paragraph ? planningViews.sceneForParagraphId(paragraph.id) : null;
    if (!scene) {
      ribbonActions.ribbonToast("No scene selected", "Place the caret inside a scene first.", "info", 2200);
      return;
    }
    planningViews.toggleSceneOmit(scene.id);
  }
  function goToPreviousRevision() {
    const revision = documentSession.doc.revision;
    const ordered = (revision.history || []).slice().sort((a, b) => a.id - b.id);
    const currentIndex = ordered.findIndex((entry) => entry.id === revision.current);
    const previous = currentIndex > 0 ? ordered[currentIndex - 1] : null;
    if (!previous) {
      ribbonActions.ribbonToast("First revision", "This is already the earliest revision set.", "info", 2400);
      return;
    }
    revision.current = previous.id;
    fileActions.markDirty();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast(`Rev ${previous.id} · ${previous.name}`, "Revision color is now used for new marks.", "info", 2400);
  }
  function lockAllPages() {
    const next = FDProduction.lock(documentSession.doc, pageActions.layoutOptions());
    const lockedPages = (next.lockedPages = next.lockedPages || {});
    lockedPages.enabled = true;
    lockedPages.lockedAt = new Date().toISOString();
    lockedPages.lockedPageCount = pageActions.pageCount();
    fileActions.applyDocumentEdit(next);
    ribbonActions.ribbonToast("Pages locked", `Production page lock recorded at ${pageActions.pageCount()} pages.`, "success", 2600);
  }
  function unlockAPages() { return featurePanels.productionUI?.locking(); }
  function unlockAllPages() {
    documentSession.history.finishBurst();
    delete documentSession.doc.production.lock;
    const lockedPages = (documentSession.doc.lockedPages = documentSession.doc.lockedPages || {});
    lockedPages.enabled = false;
    lockedPages.lockedAt = null;
    lockedPages.lockedPageCount = 0;
    lockedPages.aPages = [];
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Pages unlocked", "Dynamic pagination restored.", "success", 2400);
  }
  function toggleTagsMode() {
    editorState.tagsMode = !editorState.tagsMode;
    document.body.classList.toggle("tags-mode", Boolean(editorState.tagsMode));
    if (editorState.tagsMode) {
      workspaceLayout.setView("script");
      document.body.classList.add("tags-mode");
    }
    workspaceLayout.renderAll();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Tags mode", editorState.tagsMode ? "Production tags are highlighted in the navigator." : "Tags mode off.", "info", 2200);
  }
  function openLockedPageNumberDialog() { return featurePanels.productionUI?.locking(); }
  function validateDocumentAction() {
    fileActions.persistWorkspace();
    const issues = validateDocument(documentSession.doc);
    if (!issues.length) {
      modalActions.toast("Document check passed", "No structural issues found in this draft.", "success");
      return;
    }
    const rows = issues
      .map(
        (issue) =>
          `<div class="shortcut-row"><span><strong>${escapeHtml(issue.code)}</strong><br>${escapeHtml(issue.message)}</span><kbd>${escapeHtml(issue.severity)}</kbd></div>`,
      )
      .join("");
    modalActions.openDialog({
      eyebrow: "Document check",
      title: `${issues.length} note${issues.length === 1 ? "" : "s"}`,
      body: `<div class="shortcut-grid" style="grid-template-columns:1fr">${rows}</div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
  }
  // scene details, title page, revisions, cast profiles
  function openSceneDetails(sceneId) {
    const scene =
      (sceneId && getScenes(documentSession.doc).find((item) => item.id === sceneId)) ||
      planningViews.sceneForParagraphId((editorActions.activeParagraph() || {}).id);
    if (!scene) {
      modalActions.toast("No scene selected", "Place the caret in a scene or click a card first.", "info", 2200);
      return;
    }
    const meta = scene.paragraph.scene || {};
    const displayPage = workspaceLayout.scenePageMap().get(scene.id) || scene.startPage;
    modalActions.openDialog({
      eyebrow: "Index card",
      title: scene.heading || "Untitled scene",
      body: `
        <div class="scene-dialog-grid">
          <div class="scene-dialog-form">
            <label class="field"><span>Scene heading</span><input id="cardHeading" type="text" maxlength="160" value="${escapeHtml(scene.heading)}"></label>
            <label class="field"><span>Synopsis</span><textarea id="cardSynopsis" rows="3" maxlength="600" placeholder="What changes?">${escapeHtml(meta.synopsis || "")}</textarea></label>
            <label class="field"><span>Notes</span><textarea id="cardNotes" rows="3" maxlength="600" placeholder="Production notes, props, continuity…">${escapeHtml(meta.notes || "")}</textarea></label>
            <div class="field-grid">
              <label class="field"><span>Number</span><input id="cardNumber" type="text" maxlength="12" value="${escapeHtml(meta.number || "")}" placeholder="Auto"></label>
              <div class="field"><span>Status</span><button type="button" class="switch ${scene.omit ? "is-on" : ""}" id="cardOmit" role="switch" aria-checked="${scene.omit}"><span></span></button></div>
            </div>
            <div class="field"><span>Card color</span><div class="scene-color-row" id="cardColors">${["", ...PALETTE.slice(0, 6)]
              .map(
                (color, index) =>
                  `<button type="button" class="scene-color${index === 0 ? " scene-color--none" : ""}${(meta.color || "") === color ? " is-active" : ""}" data-color="${escapeHtml(color)}" style="${color ? `--scene-color:${color}` : ""}">${index === 0 ? "None" : ""}</button>`,
              )
              .join("")}</div></div>
          </div>
          <aside class="scene-dialog-preview" style="--scene-color:${scene.color}">
            <span class="eyebrow">Scene ${escapeHtml(scene.number)} · Page ${displayPage}</span>
            <h3>${escapeHtml(scene.heading)}</h3>
            <p id="cardPreviewSynopsis">${escapeHtml(meta.synopsis || "A scene card synopsis will appear here.")}</p>
            <dl><div><dt>Words</dt><dd>${scene.wordCount}</dd></div><div><dt>Blocks</dt><dd>${scene.paragraphs}</dd></div><div><dt>Revisions</dt><dd>${scene.revisionCount}</dd></div></dl>
          </aside>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save card",
          kind: "primary",
          onClick: () => {
            const heading = $("#cardHeading", els.dialogBody).value.trim() || "UNTITLED SCENE";
            scene.paragraph.html = escapeHtml(heading);
            scene.paragraph.scene = {
              ...(scene.paragraph.scene || {}),
              synopsis: $("#cardSynopsis", els.dialogBody).value,
              notes: $("#cardNotes", els.dialogBody).value,
              number: $("#cardNumber", els.dialogBody).value.trim(),
              omit: $("#cardOmit", els.dialogBody).classList.contains("is-on"),
              color: $("#cardColors .is-active", els.dialogBody)?.dataset.color || "",
            };
            if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, scene.paragraph);
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Scene card updated", `${heading} is ready.`, "success", 2200);
          },
        },
      ],
    });
    const preview = $("#cardPreviewSynopsis", els.dialogBody);
    const synopsis = $("#cardSynopsis", els.dialogBody);
    synopsis.addEventListener("input", () => {
      preview.textContent = synopsis.value || "A scene card synopsis will appear here.";
    });
    $("#cardOmit", els.dialogBody).addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.classList.toggle("is-on");
      button.setAttribute("aria-checked", String(button.classList.contains("is-on")));
    });
    $$("#cardColors .scene-color", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        $$("#cardColors .scene-color", els.dialogBody).forEach((item) =>
          item.classList.remove("is-active"),
        );
        button.classList.add("is-active");
        $(".scene-dialog-preview", els.dialogBody).style.setProperty(
          "--scene-color",
          button.dataset.color || "var(--brand)",
        );
      });
    });
  }
  function openTitlePage() {
    const draft = { ...documentSession.doc.titlePage };
    modalActions.openDialog({
      eyebrow: "Front matter",
      title: "Title page",
      body: `
        <div class="title-page-dialog">
          <div class="title-page-form">
            <div class="setting-line"><div><strong>Include title page</strong><span>Adds an unnumbered first page to the PDF and preview.</span></div><button type="button" class="switch ${draft.enabled ? "is-on" : ""}" id="titleEnabled" role="switch" aria-checked="${draft.enabled}"><span></span></button></div>
            <label class="field"><span>Title</span><input id="tpTitle" type="text" maxlength="120" value="${escapeHtml(draft.title || documentSession.doc.title)}"></label>
            <label class="field"><span>Credit</span><input id="tpCredit" type="text" maxlength="80" value="${escapeHtml(draft.credit || "Written by")}"></label>
            <label class="field"><span>Author</span><input id="tpAuthor" type="text" maxlength="120" value="${escapeHtml(draft.author || documentSession.doc.author)}"></label>
            <label class="field"><span>Source</span><input id="tpSource" type="text" maxlength="160" value="${escapeHtml(draft.source || "")}" placeholder="Based on…"></label>
            <label class="field"><span>Draft / date</span><input id="tpDate" type="text" maxlength="80" value="${escapeHtml(draft.draftDate || "")}" placeholder="First Draft · October 2026"></label>
            <label class="field"><span>Contact</span><input id="tpContact" type="text" maxlength="160" value="${escapeHtml(draft.contact || "")}" placeholder="Email or representation"></label>
            <label class="field"><span>Notes</span><textarea id="tpNotes" rows="2" maxlength="200" placeholder="Optional">${escapeHtml(draft.notes || "")}</textarea></label>
          </div>
          <div class="title-page-preview-wrap"><span class="eyebrow">Preview</span><div class="title-page-preview" id="titlePagePreview">${pageActions.titlePageMarkup(draft, true)}</div></div>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save title page",
          kind: "primary",
          onClick: () => {
            const enabled = $("#titleEnabled", els.dialogBody).classList.contains("is-on");
            const title = $("#tpTitle", els.dialogBody).value.trim() || documentSession.doc.title;
            documentSession.doc.titlePage = {
              ...documentSession.doc.titlePage,
              enabled,
              title,
              credit: $("#tpCredit", els.dialogBody).value.trim(),
              author: $("#tpAuthor", els.dialogBody).value.trim(),
              source: $("#tpSource", els.dialogBody).value.trim(),
              draftDate: $("#tpDate", els.dialogBody).value.trim(),
              contact: $("#tpContact", els.dialogBody).value.trim(),
              notes: $("#tpNotes", els.dialogBody).value.trim(),
            };
            if (title !== documentSession.doc.title) {
              documentSession.doc.title = title;
              els.titleInput.value = title;
            }
            if (documentSession.doc.titlePage.author) {
              documentSession.doc.author = documentSession.doc.titlePage.author;
              els.authorInput.value = documentSession.doc.author;
            }
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Title page updated", "The front matter is ready for print and FDX.", "success");
          },
        },
      ],
    });
    const refresh = () => {
      const preview = $("#titlePagePreview", els.dialogBody);
      if (!preview) return;
      preview.innerHTML = pageActions.titlePageMarkup(
        {
          enabled: $("#titleEnabled", els.dialogBody).classList.contains("is-on"),
          title: $("#tpTitle", els.dialogBody).value,
          credit: $("#tpCredit", els.dialogBody).value,
          author: $("#tpAuthor", els.dialogBody).value,
          source: $("#tpSource", els.dialogBody).value,
          draftDate: $("#tpDate", els.dialogBody).value,
          contact: $("#tpContact", els.dialogBody).value,
          notes: $("#tpNotes", els.dialogBody).value,
        },
        true,
      );
    };
    $$("#tpTitle, #tpCredit, #tpAuthor, #tpSource, #tpDate, #tpContact, #tpNotes", els.dialogBody).forEach(
      (input) => input.addEventListener("input", refresh),
    );
    $("#titleEnabled", els.dialogBody).addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("is-on");
      event.currentTarget.setAttribute(
        "aria-checked",
        String(event.currentTarget.classList.contains("is-on")),
      );
      refresh();
    });
  }
  function openRevisionManager() {
    const revision = documentSession.doc.revision;
    const current = revisionEntry(documentSession.doc, revision.current);
    const counts = new Map();
    for (const paragraph of documentSession.doc.paragraphs) {
      if (!paragraph.revision) continue;
      counts.set(paragraph.revision, (counts.get(paragraph.revision) || 0) + 1);
    }
    const rows = revision.history
      .slice()
      .sort((a, b) => b.id - a.id)
      .map(
        (entry) => `
        <div class="revision-row">
          <span class="revision-row__swatch" style="background:${entry.hex}"></span>
          <div><strong>Rev ${entry.id} · ${escapeHtml(entry.name)}</strong><span>${counts.get(entry.id) || 0} marked blocks</span></div>
          ${entry.id === revision.current ? `<span class="revision-row__current">Current</span>` : ""}
        </div>`,
      )
      .join("");
    modalActions.openDialog({
      eyebrow: "Revision control",
      title: "Revision manager",
      body: `
        <div class="revision-hero" style="--revision-color:${current.hex}">
          <span class="revision-hero__swatch"></span>
          <div><span class="eyebrow">Active set</span><strong>Rev ${revision.current} · ${escapeHtml(current.name)}</strong><p>${revision.enabled ? "Every edit is marked in the current revision color." : "Revision marks are preserved but hidden."}</p></div>
          <button type="button" class="switch ${revision.enabled ? "is-on" : ""}" id="revisionModeSwitch" role="switch" aria-label="Revision mode" aria-checked="${revision.enabled}"><span></span></button>
        </div>
        <div class="revision-list">${rows || `<p class="subtle">No marked revisions yet.</p>`}</div>
        <div class="dialog-note">Page view, PDF export, and FDX each carry the active revision color and paragraph marks.</div>`,
      actions: [
        { label: "Start next revision", kind: "primary", onClick: startNextRevision },
        {
          label: "Clear marks",
          kind: "danger",
          onClick: () =>
            modalActions.confirmAction(
              "Clear all revision marks?",
              "Paragraphs stay intact; only revision IDs and colors are cleared.",
              "Clear revisions",
              () => {
                documentSession.doc.revision = {
                  enabled: false,
                  current: 1,
                  history: [],
                };
                documentSession.doc.paragraphs.forEach((paragraph) => {
                  paragraph.revision = null;
                });
                fileActions.markDirty();
                documentSession.history.record();
                workspaceLayout.renderAll();
                modalActions.toast("Revisions cleared", "The draft is clean for a new pass.", "success");
              },
            ),
        },
        { label: "Done" },
      ],
    });
    $("#revisionModeSwitch", els.dialogBody).addEventListener("click", (event) => {
      toggleRevisionMode();
      const button = event.currentTarget;
      button.classList.toggle("is-on");
      button.setAttribute("aria-checked", String(button.classList.contains("is-on")));
      /* The hero paragraph describes what the switch means, so it has to follow
       * the toggle: it kept saying "marks are preserved but hidden" while the
       * status bar already read "Rev 1 · On". */
      const caption = els.dialogBody.querySelector(".revision-hero p");
      if (caption) {
        caption.textContent = documentSession.doc.revision.enabled
          ? "Every edit is marked in the current revision color."
          : "Revision marks are preserved but hidden.";
      }
    });
  }
  function startNextRevision() {
    const entry = nextRevision(documentSession.doc);
    documentSession.doc.revision.enabled = true;
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    document.body.classList.add("revision-flash");
    setTimeout(() => document.body.classList.remove("revision-flash"), 900);
    modalActions.toast(
      `Rev ${entry.id} · ${entry.name}`,
      "Revision mode is on. New edits are now marked in this color.",
      "success",
    );
  }
  function toggleRevisionMode() {
    documentSession.doc.revision.enabled = !documentSession.doc.revision.enabled;
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    modalActions.toast(
      documentSession.doc.revision.enabled ? "Revision mode on" : "Revision mode off",
      documentSession.doc.revision.enabled
        ? "New edits will be marked in the active revision color."
        : "Existing revision marks stay in the document, but are hidden.",
      "info",
      2400,
    );
  }
  return {
    editSceneNumberDialog,
    goToPreviousRevision,
    lockAllPages,
    omitCurrentScene,
    openHeaderFooterDialog,
    openLockPagesDialog,
    openLockedPageNumberDialog,
    openMoresDialog,
    openRevisionManager,
    openSceneDetails,
    openTargetLengthDialog,
    openTitlePage,
    openWatermarkDialog,
    resetSceneNumbersDialog,
    startNextRevision,
    toggleRevisionMode,
    toggleTagsMode,
    unlockAPages,
    unlockAllPages,
    validateDocumentAction
  };
};
