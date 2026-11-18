"use strict";

window.AzkriptRenderer.formatActions = function ({
  documentSession,
  editorActions,
  editorState,
  fileActions,
  modalActions,
  pageActions,
  preferences,
  ribbonActions,
  shared,
  workspaceLayout,
}) {
  const { $, els } = shared;

  function openParagraphFormatDialog() {
    const active = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    if (!active) return;
    modalActions.openDialog({
      eyebrow: "Format · Alignment & Spacing",
      title: `Format Paragraph (${active.type})`,
      body: `
        <div class="field-grid">
          <label class="field"><span>Alignment</span><select id="pfAlign"><option value="">Element Default</option><option value="left"${active.alignment === "left" ? " selected" : ""}>Left</option><option value="center"${active.alignment === "center" ? " selected" : ""}>Center</option><option value="right"${active.alignment === "right" ? " selected" : ""}>Right</option></select></label>
          <label class="field"><span>Line Spacing</span><select id="pfSpacing"><option value="1"${active.spacing === "1" ? " selected" : ""}>Single (1.0)</option><option value="1.5"${active.spacing === "1.5" ? " selected" : ""}>1.5 Lines</option><option value="2"${active.spacing === "2" ? " selected" : ""}>Double (2.0)</option></select></label>
        </div>
        <div class="setting-line"><div><strong>Force Page Break Before</strong><span>Start this paragraph at the top of a new page.</span></div><button type="button" class="switch ${active.pageBreakBefore ? "is-on" : ""}" id="pfPageBreak" role="switch" aria-checked="${Boolean(active.pageBreakBefore)}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            active.alignment = $("#pfAlign", els.dialogBody).value;
            active.spacing = $("#pfSpacing", els.dialogBody).value;
            active.pageBreakBefore = $("#pfPageBreak", els.dialogBody).classList.contains("is-on");
            const el = editorActions.paragraphElement(active.id);
            if (el) {
              el.style.textAlign = active.alignment || "";
            }
            pageActions.invalidateLayout();
            fileActions.markDirty();
            documentSession.history.record();
            editorActions.decorateEditor();
            modalActions.toast("Paragraph formatted", "Custom alignment and spacing applied.", "success", 1800);
          },
        },
      ],
    });
    modalActions.bindDialogSwitch("pfPageBreak");  }
  /* ---------- paragraph + text formatting --------------------------- */
  function computeParagraphLineHeight(paragraph) {
    const base = paragraph.spacing === "2" ? 1.72 : paragraph.spacing === "1.5" ? 1.36 : null;
    if (paragraph.leading === "Tight") return base ? String(base * 0.9) : "1.02";
    if (paragraph.leading === "Loose") return base ? String(base * 1.12) : "1.32";
    return base ? String(base) : "";
  }
  function applyParagraphVisuals(el, paragraph) {
    if (!el || !paragraph) return;
    el.style.textAlign = paragraph.alignment || "";
    el.style.marginTop = paragraph.spaceBefore ? `${Number(paragraph.spaceBefore) || 0}pt` : "";
    const lineHeight = computeParagraphLineHeight(paragraph);
    el.style.lineHeight = lineHeight;
    el.classList.toggle("has-page-break", Boolean(paragraph.pageBreakBefore));
    el.classList.toggle("has-track-change", Boolean(editorState.trackChanges && paragraph.changeType));
    pageActions.applyDocumentTypography(el, paragraph);
  }
  function activeRibbonParagraphForFormatting() {
    const paragraph = editorActions.activeParagraph();
    if (!paragraph) {
      ribbonActions.ribbonToast("No paragraph selected", "Place the caret in the script, then apply the format.", "info", 2200);
      return null;
    }
    return paragraph;
  }
  function commitParagraphFormatting(paragraph) {
    const el = editorActions.paragraphElement(paragraph.id);
    if (el) applyParagraphVisuals(el, paragraph);
    pageActions.invalidateLayout();
    fileActions.markDirty();
    documentSession.history.record();
    ribbonActions.syncRibbon();
  }
  function applyParagraphAlignment(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.alignment = value;
    else delete paragraph.alignment;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphSpacing(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.spacing = value;
    else delete paragraph.spacing;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphSpaceBefore(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.spaceBefore = value;
    else delete paragraph.spaceBefore;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphLeading(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value && value !== "Regular") paragraph.leading = value;
    else delete paragraph.leading;
    commitParagraphFormatting(paragraph);
  }
  function revertParagraphFormatting() {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    delete paragraph.alignment;
    delete paragraph.spacing;
    delete paragraph.spaceBefore;
    delete paragraph.leading;
    delete paragraph.pageBreakBefore;
    const el = editorActions.paragraphElement(paragraph.id);
    if (el) {
      el.style.textAlign = "";
      el.style.marginTop = "";
      el.style.lineHeight = "";
      el.classList.remove("has-page-break");
    }
    pageActions.invalidateLayout();
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    ribbonActions.ribbonToast("Paragraph reset", "Element defaults restored for this block.", "info", 1800);
  }
  function applyTextColor(color) {
    preferences.textColor = color;
    fileActions.persistPrefs();
    if (!ribbonActions.restoreRibbonSelection()) {
      ribbonActions.ribbonToast("Select text first", "Highlight the words you want to color.", "info", 2400);
      return;
    }
    els.editor.focus();
    try {
      document.execCommand("styleWithCSS", false, true);
      if (color) document.execCommand("foreColor", false, color);
      else document.execCommand("removeFormat", false, null);
    } catch (error) {
      ribbonActions.ribbonToast("Color unavailable", error.message || String(error), "warning");
    }
    fileActions.markDirty();
    documentSession.history.record();
    ribbonActions.syncRibbon();
  }
  function applyHighlighter(color) {
    preferences.highlightColor = color;
    fileActions.persistPrefs();
    if (!ribbonActions.restoreRibbonSelection()) {
      ribbonActions.ribbonToast("Select text first", "Highlight the words you want to mark.", "info", 2400);
      return;
    }
    els.editor.focus();
    try {
      document.execCommand("styleWithCSS", false, true);
      if (color) document.execCommand("hiliteColor", false, color);
      else document.execCommand("hiliteColor", false, "transparent");
    } catch (error) {
      ribbonActions.ribbonToast("Highlighter unavailable", error.message || String(error), "warning");
    }
    fileActions.markDirty();
    documentSession.history.record();
    ribbonActions.syncRibbon();
  }
  return {
    applyHighlighter,
    applyParagraphAlignment,
    applyParagraphLeading,
    applyParagraphSpaceBefore,
    applyParagraphSpacing,
    applyParagraphVisuals,
    applyTextColor,
    revertParagraphFormatting
  };
};
