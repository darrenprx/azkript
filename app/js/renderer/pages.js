"use strict";

window.AzkriptRenderer.pageActions = function ({
  documentSession,
  editorActions,
  modalActions,
  preferences,
  shared,
  workspaceLayout,
  workspaceState,
}) {
  const { $, $$, LINE_SPACING_OPTIONS, clamp, desktop, elementSpec, els, escapeHtml, getScenes, isDesktop, normalizeScriptFont, prefersReducedMotion, revisionEntry, scriptFontStack, slug } = shared;

  const paginationClient = FDCoreWriting.createPaginationClient(new URL("js/pagination-worker.js", location.href), { source: window.FDPaginationWorkerSource });
  let paginationTimer = null;
  let paginationSequence = 0;
  let pagePreviewObserver = null;
  let previewGeneration = 0;
  const pageState = { layout: null, layoutDirty: true, layoutError: null, pageIndex: 0, paginationRunningSignature: null };

  function invalidateLayout() { pageState.layoutDirty = true; }
  function getLayoutError() { return pageState.layoutError; }
  function stepPage(offset) { goToPage(pageState.pageIndex + offset); }
  function resetDocumentLayout({ preservePage = false } = {}) {
    paginationSequence++;
    previewGeneration++;
    paginationClient.cancel();
    clearTimeout(paginationTimer);
    paginationTimer = null;
    pagePreviewObserver?.disconnect();
    pagePreviewObserver = null;
    pageState.layout = null;
    pageState.layoutDirty = true;
    pageState.layoutError = null;
    pageState.paginationRunningSignature = null;
    if (!preservePage) pageState.pageIndex = 0;
  }
  function getLayout(force = false) {
    if (force || pageState.layoutDirty || !pageState.layout) {
      if (!force && pageState.layout && documentSession.doc.paragraphs.length > 600) {
        scheduleBackgroundPagination(); return pageState.layout;
      }
      try {
        pageState.layout = FDPagination.layout(documentSession.doc, layoutOptions());
        pageState.layoutError = null;
      } catch (error) {
        if (pageState.layoutError !== error.message) modalActions.toast("Pagination unavailable", "Your text is intact. Review document fonts and geometry before exporting pages.", "warning", 7000);
        pageState.layoutError = error.message;
        pageState.layout = { pages: [], scriptPageCount: 0, totalPageCount: 0,
          contentHeight: 648, lineHeight: preferences.fontSize, scenes: getScenes(documentSession.doc), normalized: documentSession.doc };
      }
      pageState.layoutDirty = false;
    }
    return pageState.layout;
  }
  function layoutOptions() {
    const spacing = LINE_SPACING_OPTIONS[preferences.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    return { fontSize: preferences.fontSize, fontFamily: preferences.font,
      lineHeight: Math.round(preferences.fontSize * spacing.multiplier * 100) / 100,
      charWidthRatio: 0.6, showMore: documentSession.doc.settings.showMore !== false,
      useDocumentTypography: preferences.typographyMode === "document", measureText: measureForLayout(), measuredTypography: true };
  }
  function scheduleBackgroundPagination() {
    const signature = () => `${documentSession.doc.documentId}:${documentSession.editVersion}:${preferences.font}:${preferences.fontSize}:${preferences.lineSpacing}:${preferences.typographyMode}`;
    if (paginationTimer || pageState.paginationRunningSignature === signature()) return;
    const sequence = ++paginationSequence;
    paginationTimer = setTimeout(async () => {
      paginationTimer = null;
      const requestedSignature = signature();
      pageState.paginationRunningSignature = requestedSignature;
      try {
        const result = await paginationClient.layout(documentSession.doc, layoutOptions());
        if (sequence !== paginationSequence || requestedSignature !== signature()) return;
        pageState.layout = { ...result, normalized: documentSession.doc };
        pageState.layoutDirty = false;
        workspaceLayout.renderMeta(); workspaceLayout.renderStatus();
        if (workspaceState.mode === "page") renderPagePreview();
      } catch (error) {
        if (error.code !== "PAGINATION_CANCELLED" && sequence === paginationSequence) {
          // Page and export commands can still compute layout synchronously.
          console.warn("Background pagination was unavailable.", error.message);
        }
      } finally {
        if (sequence === paginationSequence) pageState.paginationRunningSignature = null;
        if (sequence === paginationSequence && requestedSignature !== signature() && pageState.layoutDirty) scheduleBackgroundPagination();
      }
    }, 120);
  }
  function pageCount() {
    return getLayout().scriptPageCount;
  }
  // pagination, page dock, print
  function renderPageDock() {
    if (!els.pageDock) return;
    const layout = getLayout();
    const pages = layout.pages;
    const show = workspaceState.mode === "page" && pages.length > 0;
    els.pageDock.hidden = !show;
    if (!show) return;
    pageState.pageIndex = clamp(pageState.pageIndex, 0, pages.length - 1);
    const current = pages[pageState.pageIndex];
    const scriptPages = getLayout().scriptPageCount;
    els.pageDockLabel.textContent =
      current && current.kind === "title"
        ? `Title · ${scriptPages} ${scriptPages === 1 ? "page" : "pages"}`
        : `${current ? current.label || current.number : pageState.pageIndex + 1} / ${scriptPages}`;
    els.pagePrev.disabled = pageState.pageIndex <= 0;
    els.pageNext.disabled = pageState.pageIndex >= pages.length - 1;
    if (els.pageDots) {
      if (pages.length <= 18) {
        els.pageDots.innerHTML = pages
          .map(
            (page, index) =>
              `<button type="button" class="page-dot${index === pageState.pageIndex ? " is-active" : ""}" data-page-index="${index}" aria-label="Page ${index + 1}"></button>`,
          )
          .join("");
        $$(".page-dot", els.pageDots).forEach((dot) => {
          dot.addEventListener("click", () => goToPage(Number(dot.dataset.pageIndex)));
        });
      } else {
        els.pageDots.innerHTML = "";
      }
    }
    $$(".page-card", els.pagePreview).forEach((card, index) => {
      card.classList.toggle("is-current", index === pageState.pageIndex);
    });
  }
  function scrollToPage(index, smooth = true) {
    const cards = $$(".page-card", els.pagePreview);
    const card = cards[index];
    if (!card) return;
    const top = card.offsetTop - 10;
    if (smooth && !prefersReducedMotion()) {
      els.pagePreview.scrollTo({ top, behavior: "smooth" });
      card.classList.remove("is-turning");
      void card.offsetWidth;
      card.classList.add("is-turning");
      setTimeout(() => card.classList.remove("is-turning"), 700);
    } else {
      els.pagePreview.scrollTop = top;
    }
    pageState.pageIndex = index;
    renderPageDock();
  }
  function goToPage(index) {
    const pages = getLayout().pages;
    pageState.pageIndex = clamp(index, 0, pages.length - 1);
    scrollToPage(pageState.pageIndex, true);
  }
  function updatePageFromScroll() {
    if (workspaceState.mode !== "page" || workspaceState.scrollTick) return;
    workspaceState.scrollTick = true;
    requestAnimationFrame(() => {
      workspaceState.scrollTick = false;
      const cards = $$(".page-card", els.pagePreview);
      if (!cards.length) return;
      const top = els.pagePreview.scrollTop + 30;
      let active = 0;
      cards.forEach((card, index) => {
        if (card.offsetTop <= top) active = index;
      });
      if (active !== pageState.pageIndex) {
        pageState.pageIndex = active;
        renderPageDock();
      }
    });
  }
  function renderPagePreview() {
    if (workspaceState.mode !== "page") return;
    const generation = ++previewGeneration;
    const layout = getLayout();
    const previousIndex = pageState.pageIndex;
    pagePreviewObserver?.disconnect();
    pagePreviewObserver = null;
    els.pagePreview.innerHTML = "";
    const lazy = layout.pages.length > 24 && "IntersectionObserver" in window;
    const makePlaceholder = (page, index) => {
      const card = document.createElement("article"); card.className = "page-card page-lazy";
      card.dataset.pageIndex = String(index); card.dataset.page = String(page.number || "");
      card.style.setProperty("--page-w", `${documentSession.doc.page.width}in`);
      card.style.setProperty("--page-h", `${documentSession.doc.page.height}in`);
      card.style.zoom = String(preferences.zoom * workspaceState.fit);
      card.setAttribute("aria-label", `${page.kind === "title" ? "Title page" : `Page ${page.number}`} preview`);
      card.textContent = page.kind === "title" ? "Title page" : `Page ${page.number}`;
      return card;
    };
    if (lazy) pagePreviewObserver = new IntersectionObserver(entries => {
      if (generation !== previewGeneration || workspaceState.mode !== "page") return;
      for (const entry of entries) {
        const old = entry.target;
        if (!old.isConnected) continue;
        const index = Number(old.dataset.pageIndex), page = layout.pages[index];
        if (entry.isIntersecting && old.classList.contains("page-lazy")) {
          const card = buildPageCard(page, false); card.dataset.pageIndex = String(index);
          card.style.zoom = String(preferences.zoom * workspaceState.fit);
          pagePreviewObserver.unobserve(old); old.replaceWith(card); pagePreviewObserver.observe(card);
        } else if (!entry.isIntersecting && !old.classList.contains("page-lazy")) {
          const card = makePlaceholder(page, index);
          pagePreviewObserver.unobserve(old); old.replaceWith(card); pagePreviewObserver.observe(card);
        }
      }
    }, { root: els.pagePreview, rootMargin: "1000px 0px" });
    layout.pages.forEach((page, index) => {
      const card = lazy ? makePlaceholder(page, index) : buildPageCard(page, false);
      card.style.setProperty("--i", String(index));
      if (index === previousIndex) card.classList.add("is-current");
      els.pagePreview.appendChild(card);
      if (lazy) pagePreviewObserver.observe(card);
    });
    workspaceLayout.applyZoom();
    const max = Math.max(0, layout.pages.length - 1);
    pageState.pageIndex = clamp(previousIndex, 0, max);
    requestAnimationFrame(() => {
      if (generation !== previewGeneration || workspaceState.mode !== "page") return;
      workspaceLayout.fitPaper();
      const cards = $$(".page-card", els.pagePreview);
      if (cards[pageState.pageIndex]) {
        els.pagePreview.scrollTop = cards[pageState.pageIndex].offsetTop - 10;
      }
      renderPageDock();
    });
  }
  function buildPageCard(page, forPrint) {
    const spacing = LINE_SPACING_OPTIONS[preferences.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    const card = document.createElement("article");
    card.className = `page-card${page.kind === "title" ? " page-card--title" : ""}${forPrint ? " print-page" : ""}`;
    card.dataset.page = String(page.number || "");
    card.style.setProperty("--page-w", `${documentSession.doc.page.width}in`);
    card.style.setProperty("--page-h", `${documentSession.doc.page.height}in`);
    card.style.setProperty("--page-top", `${documentSession.doc.page.top}in`);
    card.style.setProperty("--page-bottom", `${documentSession.doc.page.bottom}in`);
    card.style.setProperty("--script-font", scriptFontStack(preferences.font));    card.style.setProperty("--script-size", `${preferences.fontSize}pt`);
    card.style.setProperty("--script-line-height", spacing.css);
    const applyCardWatermark = (target) => {
      const wm = documentSession.doc.watermark || {};
      if (wm.enabled && wm.text) {
        target.classList.add("has-watermark");
        target.dataset.watermark = wm.text;
        target.style.setProperty("--wm-opacity", String((Number(wm.opacity) || 14) / 100));
      }
    };
    if (page.kind === "title") {
      card.innerHTML = titlePageMarkup(page.titlePage, false);
      applyCardWatermark(card);
      return card;
    }
    const title = (documentSession.doc.title || "Untitled Screenplay").toUpperCase();
    const revision = documentSession.doc.revision.enabled
      ? revisionEntry(documentSession.doc, documentSession.doc.revision.current)
      : null;
    const hf = documentSession.doc.headerFooter || {};
    const startPage = Math.max(1, Number(hf.startingPageNumber || hf.startingPage || 1));
    const pageNumber = page.label || ((Number(page.number) || 1) + startPage - 1);
    const folio = documentSession.doc.settings.pageNumbers !== false ? `${escapeHtml(String(pageNumber))}.` : "";
    const headerText =
      hf.headerText ||
      [hf.left, hf.center, hf.right].filter(Boolean).join("    ");
    const showHeader =
      hf.showHeader !== false &&
      hf.enabled !== false &&
      (page.number > 1 || hf.showOnFirstPage);
    const header = document.createElement("div");
    header.className = "page-card__header";
    const headerLabel = showHeader && headerText ? headerText.replace(/\{PAGE\}/g, String(pageNumber)) : title;
    header.innerHTML = `<span class="page-card__title">${escapeHtml(headerLabel)}</span><span class="page-card__folio">${folio}</span>`;
    const body = document.createElement("div");
    body.className = "page-card__body screenplay-editor";
    body.style.height = `${(documentSession.doc.page.height - documentSession.doc.page.top - documentSession.doc.page.bottom).toFixed(3)}in`;
    for (const block of page.blocks) {
      body.appendChild(buildPublishedBlock(block));
    }
    if (page.omitted) { const notice = document.createElement('p'); notice.textContent='OMITTED'; body.appendChild(notice); }
    const footer = document.createElement("div");
    footer.className = "page-card__footer";
    const revisedCount = page.blocks.reduce(
      (count, block) =>
        count +
        (block.kind === "paragraph" && block.paragraph && block.paragraph.revision ? 1 : 0),
      0,
    );
    const footerText =
      hf.footerText ||
      [hf.footerLeft, hf.footerRight].filter(Boolean).join("    ");
    const footerLeft = hf.showFooter && footerText ? footerText.replace(/\{PAGE\}/g, String(pageNumber)) : documentSession.doc.title || "";
    footer.innerHTML = `<span>${escapeHtml(footerLeft)}</span><span>${revision ? `${escapeHtml(revision.name)} revision${revisedCount ? ` · ${revisedCount} marks` : ""}` : "AZKRIPT"}</span>`;
    card.append(header, body, footer);
    applyCardWatermark(card);
    card.addEventListener("click", (event) => {
      const target = event.target.closest(".pub-para[data-id]");
      if (!target) return;
      workspaceLayout.setMode("write");
      workspaceLayout.setView("script");
      requestAnimationFrame(() => editorActions.focusParagraph(target.dataset.id, "start"));
    });
    return card;
  }
  function buildPublishedBlock(block) {
    if (block.kind === "more") {
      const more = document.createElement("div");
      more.className = "pub-more";
      more.textContent = block.text || (documentSession.doc.moresContinueds && documentSession.doc.moresContinueds.dialogueMore) || "(MORE)";
      return more;
    }
    if (block.kind === "dual") {
      const wrapper = document.createElement("div");
      wrapper.className = "dual-block pub-dual";
      const geometry = block.geometry || FDPagination.dualGeometry(documentSession.doc, layoutOptions());
      wrapper.style.width = `${geometry.widthInches}in`;
      wrapper.style.marginLeft = `${geometry.leftInches}in`;
      for (const column of block.columns || []) {
        const cell = document.createElement("div");
        cell.className = "dual-col";
        for (const item of column.blocks) {
          cell.appendChild(publishedParagraph(item));
        }
        wrapper.appendChild(cell);
      }
      return wrapper;
    }
    return publishedParagraph(block);
  }
  function publishedParagraph(block) {
    const paragraph = block.paragraph;
    const el = document.createElement("div");
    el.className = `para pub-para type-${slug(block.type)}${block.isContinuation ? " is-continued" : ""}`;
    el.dataset.id = paragraph ? paragraph.id : "";
    el.dataset.type = block.type;
    el.dataset.placeholder = "";
    if (paragraph) applyDocumentTypography(el, paragraph, true);
    if (block.font) {
      el.style.fontFamily = `${JSON.stringify(block.font.font)}, "Courier New", monospace`;
      el.style.fontSize = `${block.font.size}pt`;
    }
    if (block.lineHeight) el.style.lineHeight = `${block.lineHeight}pt`;
    if (block.geometry) {
      el.style.marginLeft = `${block.geometry.left}in`;
      el.style.marginRight = `${documentSession.doc.page.width - block.geometry.right}in`;
      el.style.textIndent = `${block.geometry.first}in`;
    }
    // A continuation block always has its own sliced HTML; only fall back to the
    // full paragraph HTML for blocks that begin the paragraph.
    el.innerHTML = block.html != null
      ? block.html
      : !block.isContinuation && paragraph
        ? paragraph.html
        : "";
    if (block.revision) {
      const revision = revisionEntry(documentSession.doc, block.revision);
      el.classList.add("has-revision");
      el.style.setProperty("--revision-color", revision.hex);
    }
    if (block.sceneNumber && documentSession.doc.settings.sceneNumbers) {
      const side = documentSession.doc.settings.sceneNumberSide || "both";
      if (side === "both" || side === "left") {
        const left = document.createElement("span");
        left.className = "scene-number scene-number--left";
        left.textContent = block.sceneNumber;
        el.appendChild(left);
      }
      if (side === "both" || side === "right") {
        const right = document.createElement("span");
        right.className = "scene-number scene-number--right";
        right.textContent = block.sceneNumber;
        el.appendChild(right);
      }
    }
    return el;
  }
  function titlePageMarkup(titlePage, compact) {
    if (!titlePage) return "";
    const values = titlePage;
    return `
      <div class="title-page${compact ? " title-page--compact" : ""}">
        <div class="title-page__top">${values.notes ? `<span>${escapeHtml(values.notes)}</span>` : ""}</div>
        <div class="title-page__center">
          <h1>${escapeHtml(values.title || documentSession.doc.title || "Untitled Screenplay")}</h1>
          <span class="title-page__rule"></span>
          <p class="title-page__credit">${escapeHtml(values.credit || "Written by")}</p>
          <p class="title-page__author">${escapeHtml(values.author || documentSession.doc.author || "")}</p>
          ${values.source ? `<p class="title-page__source">${escapeHtml(values.source)}</p>` : ""}
        </div>
        <div class="title-page__bottom">
          ${values.draftDate ? `<p>${escapeHtml(values.draftDate)}</p>` : ""}
          ${values.contact ? `<p>${escapeHtml(values.contact)}</p>` : ""}
        </div>
      </div>`;
  }
  function renderPrintRoot(selectedPages) {
    const layout = getLayout(true);
    if (pageState.layoutError) throw new Error(pageState.layoutError);
    els.printRoot.innerHTML = "";
    (selectedPages || layout.pages).forEach((page) => {
      const card = buildPageCard(page, true);
      els.printRoot.appendChild(card);
    });
    els.printStyle.textContent = `@page { size: ${documentSession.doc.page.width}in ${documentSession.doc.page.height}in; margin: 0; }`;
    document.body.classList.add("is-printing");
    return layout;
  }
  function cleanupPrint() {
    document.body.classList.remove("is-printing");
    els.printRoot.innerHTML = "";
  }
  let printBusy = false;
  async function withPrintRoot(selectedPages, operation) {
    if (printBusy) throw new Error("Finish the current print or export first.");
    printBusy = true;
    try {
      const version = documentSession.editVersion;
      const layout = renderPrintRoot(selectedPages);
      await document.fonts.ready;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if (documentSession.editVersion !== version) throw new Error("The draft changed while preparing the pages. Try again.");
      return await operation(layout);
    } finally {
      cleanupPrint();
      printBusy = false;
    }
  }
  function inspectPrintRoot(layout) {
    const options = layoutOptions();
    const fonts = new Set(documentSession.doc.paragraphs.map(p => FDPagination.paragraphTypography(documentSession.doc, p, options).font));
    const missingFonts = [...fonts].filter(font => FDCoreWriting.typography(font, preferences.fontSize).available !== true);
    const domIssues = [...els.printRoot.querySelectorAll('.page-card__body,.pub-para')]
      .filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
      .map(el => 'Rendered text exceeds its box: ' + el.textContent.slice(0, 80));
    return FDProduction.preflight(documentSession.doc, layout, { missingFonts, domIssues });
  }
  function runPreflight() { return withPrintRoot(undefined, inspectPrintRoot); }
  async function exportPDF(options = {}) {
    try {
      const exportVersion=documentSession.editVersion;
      if(options.expectedVersion!==undefined&&options.expectedVersion!==exportVersion)throw new Error('The draft changed. Preview the revision packet again.');
      const pages=Array.isArray(options.pages)?options.pages:undefined;
      if(pages&&!pages.length)throw new Error('There are no changed pages to export.');
      await withPrintRoot(pages, async layout => {
        const preflight = inspectPrintRoot(layout);
        if (!preflight.ok) throw new Error('PDF preflight failed: ' + preflight.issues.filter(i=>i.severity==='error').map(i=>i.message).join('; '));
        if (isDesktop) {
          const result = await desktop.exportPdf({ defaultName: (documentSession.doc.title || "screenplay") + (options.suffix || '') });
          if (!result.canceled) modalActions.toast("PDF exported", `${result.name} is ready to share.`, "success");
        } else {
          window.print();
        }
      });
    } catch (error) {
      modalActions.toast("PDF export failed", error.message || "Could not render the PDF.", "error");
    }
  }
  async function printDocument() {
    try {
      await withPrintRoot(undefined, async () => {
        if (isDesktop) {
          const result = await desktop.print({ pageSize: { width: documentSession.doc.page.width, height: documentSession.doc.page.height } });
          if (result && result.ok === false && result.reason) modalActions.toast("Printing cancelled", String(result.reason), "info", 2600);
        } else {
          window.print();
        }
      });
    } catch (error) {
      modalActions.toast("Print failed", error.message || "Could not open the print dialog.", "error");
    }
  }
  function openPrintPreviewDialog() {
    const pages = pageCount();
    const layout = getLayout();
    const title = documentSession.doc.title || "Untitled Screenplay";
    modalActions.openDialog({
      eyebrow: "File · Print Preview",
      title: "Print Preview",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Document</span><strong>${escapeHtml(title)}</strong></div>
          <div class="shortcut-row"><span>Pages</span><strong>${pages} printable page${pages === 1 ? "" : "s"}</strong></div>
          <div class="shortcut-row"><span>Paper</span><strong>${escapeHtml(String(documentSession.doc.page.width))} × ${escapeHtml(String(documentSession.doc.page.height))} in</strong></div>
          <div class="shortcut-row"><span>Scene numbers</span><strong>${documentSession.doc.settings.sceneNumbers ? "On" : "Off"}</strong></div>
          <div class="shortcut-row"><span>Revision color</span><strong>${documentSession.doc.revision.enabled ? escapeHtml(revisionEntry(documentSession.doc, documentSession.doc.revision.current).name) + " revision" : "Hidden"}</strong></div>
        </div>
        <p class="dialog-note">Page view shows the same paginated cards used for printing and PDF export, including scene numbers, revision marks and (MORE)/(CONT'D).</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Open Page view",
          onClick: () => {
            modalActions.closeDialog();
            workspaceLayout.setView("script");
            workspaceLayout.setMode("page");
          },
        },
        { label: "Print…", kind: "primary", onClick: () => { modalActions.closeDialog(); printDocument(); } },
      ],
    });
  }
  const typographyMeasures = new Map();
  function measureForLayout() {
    const key = `${preferences.font}:${preferences.fontSize}`;
    if (!typographyMeasures.has(key)) typographyMeasures.set(key, FDCoreWriting.createMeasureText(preferences.font, preferences.fontSize));
    return typographyMeasures.get(key);
  }
  function applyDocumentTypography(el, paragraph, published = false) {
    const spec = elementSpec(paragraph.type);
    const custom = documentSession.doc.elements && documentSession.doc.elements[paragraph.type];
    const typography = FDPagination.paragraphTypography(documentSession.doc, paragraph, layoutOptions());
    el.style.lineHeight = `${typography.lineHeight}pt`;
    if (custom) {
      el.style.fontWeight = spec.style?.includes("Bold") ? "700" : "normal";
      el.style.fontStyle = spec.style?.includes("Italic") ? "italic" : "normal";
      el.style.textDecoration = spec.style?.includes("Underline") ? "underline" : "none";
      el.style.textTransform = spec.style?.includes("AllCaps") ? "uppercase" : "none";
      el.style.color = FDX.parseColor(spec.native?.font?.Color || "") || "";
    }
    if (preferences.typographyMode === "document" && custom) {
      el.style.fontFamily = `${JSON.stringify(spec.font || preferences.font)}, "Courier New", monospace`;
      el.style.fontSize = `${spec.fontSize || preferences.fontSize}pt`;
    } else { el.style.fontFamily = ""; el.style.fontSize = ""; }
    if (custom) {
      el.style.textAlign = paragraph.alignment || spec.align || "left";
      if (!published && !workspaceState.flow) {
        el.style.marginLeft = `${spec.left}in`;
        el.style.marginRight = `${documentSession.doc.page.width - spec.right}in`;
        el.style.textIndent = `${spec.first || 0}in`;
        el.style.marginTop = `${paragraph.spaceBefore ?? spec.before ?? 0}pt`;
      } else if (!published) { el.style.marginLeft = ""; el.style.marginRight = ""; el.style.textIndent = ""; }
    } else if (!published) { el.style.marginLeft = ""; el.style.marginRight = ""; el.style.textIndent = ""; }
    el.setAttribute("dir", "auto");
  }
  function currentTypography() {
    const paragraph = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    const custom = paragraph && documentSession.doc.elements?.[paragraph.type];
    return preferences.typographyMode === "document" && custom
      ? { family: custom.font || preferences.font, size: custom.fontSize || preferences.fontSize, document: true }
      : { family: preferences.font, size: preferences.fontSize, document: false };
  }
  function syncDocumentFontControls() {
    const current = currentTypography(), select = $("#fontSelect"), size = $("#fontSize");
    if (select) {
      select.querySelectorAll('[data-document-font]').forEach(option => option.remove());
      if (current.document) {
        const option = document.createElement("option"); option.dataset.documentFont = "true";
        option.value = `document:${current.family}`; option.textContent = `Document: ${current.family}`;
        option.disabled = true; select.append(option); select.value = option.value;
      } else select.value = normalizeScriptFont(preferences.font);
      select.title = current.document ? "Document font. Choosing another font enables the workspace override." : "Workspace font for the editor and PDF.";
    }
    if (size) { size.value = String(current.size); size.title = current.document ? "Document font size. Changing this enables the workspace override." : "Workspace font size."; }
  }
  function useWorkspaceTypography() {
    preferences.typographyMode = "workspace";
    document.body.classList.add("workspace-typography");
    pageState.layoutDirty = true;
    editorActions.decorateEditor(); syncDocumentFontControls();
  }
  return {
    invalidateLayout,
    getLayoutError,
    stepPage,
    applyDocumentTypography,
    currentTypography,
    exportPDF,
    getLayout,
    goToPage,
    layoutOptions,
    openPrintPreviewDialog,
    pageCount,
    resetDocumentLayout,
    printDocument,
    renderPageDock,
    renderPagePreview,
    runPreflight,
    syncDocumentFontControls,
    titlePageMarkup,
    updatePageFromScroll,
    useWorkspaceTypography
  };
};
