"use strict";

window.AzkriptRenderer.findActions = function ({
  documentSession,
  editorActions,
  fileActions,
  modalActions,
  shared,
  workspaceLayout,
  workspaceState,
}) {
  const { $, $$, on, clamp, els, escapeHtml, icon, markRevision, paragraphText, plural } = shared;

  const regexClient = FDCoreWriting.createRegexClient(new URL("js/search-worker.js", location.href), { timeoutMs: 1500, maxMatches: 10000 });
  let findGeneration = 0;
  const searchState = {
    open: false,
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    matches: [],
    index: 0,
    mode: "find",
  };
  function findSelectionAction() {
    const text = String(window.getSelection() || "").trim();
    if (!text) {
      openFind("find");
      return;
    }
    openFind("find");
    searchState.query = text;
    if (els.findInput) els.findInput.value = text;
    runFind();
  }
  // find and replace
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function buildFindRegex() {
    const query = searchState.query;
    if (!query) return null;
    const flags = searchState.caseSensitive ? "gu" : "giu";
    let pattern = searchState.regex ? query : escapeRegExp(query);
    if (searchState.wholeWord && !searchState.regex) {
      pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
    }
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  function findInParagraph(paragraph, regex) {
    const text = paragraphText(paragraph);
    if (!regex) return [];
    const matches = [];
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!match[0]) {
        regex.lastIndex += text.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
        continue;
      }
      matches.push({
        paragraphId: paragraph.id,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      if (matches.length > 300) break;
    }
    return matches;
  }
  function setFindBusy(busy) {
    searchState.busy = busy;
    for (const id of ["findNext", "findPrev", "findReplaceOne", "findReplaceAll"]) {
      const control = document.getElementById(id);
      if (control) control.disabled = busy;
    }
    let cancel = $("#cancelBackgroundSearch");
    if (!cancel) {
      cancel = document.createElement("button"); cancel.id = "cancelBackgroundSearch";
      cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "Cancel search";
      els.findCount.after(cancel);
      cancel.addEventListener("click", () => {
        findGeneration++; regexClient.cancel(); setFindBusy(false);
        els.findCount.textContent = "Search cancelled";
      });
    }
    cancel.hidden = !busy;
    els.findResults.setAttribute("aria-busy", String(busy));
  }
  async function runFind() {
    const generation = ++findGeneration;
    const version = documentSession.editVersion;
    searchState.matches = [];
    searchState.truncated = false;
    regexClient.cancel();
    clearFindHighlights();
    if (!searchState.query) {
      setFindBusy(false); renderFindResults(); return;
    }
    const regex = buildFindRegex();
    if (!regex) { setFindBusy(false); renderFindResults({ invalid: true }); return; }
    setFindBusy(true);
    els.findCount.textContent = "Searching…";
    try {
      const result = await regexClient.search(documentSession.doc.paragraphs, { pattern: regex.source, flags: regex.flags });
      if (generation !== findGeneration || version !== documentSession.editVersion) return;
      searchState.matches = result.matches;
      searchState.truncated = result.truncated;
      searchState.version = version;
      searchState.index = clamp(searchState.index, 0, Math.max(0, result.matches.length - 1));
      renderFindResults(); applyFindHighlights();
      return result;
    } catch (error) {
      if (generation !== findGeneration || error.code === "SEARCH_CANCELLED") return;
      els.findCount.textContent = error.code === "SEARCH_TIMEOUT" ? "Search timed out" : "Search unavailable";
      els.findResults.innerHTML = `<div class="find-empty"><span>${escapeHtml(error.message)}</span></div>`;
    } finally { if (generation === findGeneration) setFindBusy(false); }
  }
  function renderFindResults(options = {}) {
    const matches = searchState.matches;
    const invalid = Boolean(options.invalid);
    /* The count label belongs to this function; runFind() cannot set it before
     * calling here without the text being overwritten in the same tick. An
     * invalid pattern therefore used to report "0 results" — indistinguishable
     * from a valid search that matched nothing. */
    els.findCount.textContent = invalid
      ? "Invalid regex"
      : searchState.query
        ? `${searchState.truncated ? "At least " : ""}${matches.length} result${matches.length === 1 ? "" : "s"}${searchState.truncated ? " — narrow the search before replacing all" : ""}`
        : /* Empty, not "Find in screenplay": that string duplicated the input's
           * own placeholder, so before typing the field appeared to contain a
           * stray second copy of its own label. */
          "";
    els.findResults.innerHTML = "";
    if (invalid) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("warning")}<span>That regex is not valid. Check brackets, quantifiers and escapes.</span></div>`;
      return;
    }
    if (!searchState.query) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("search")}<span>Type a word or phrase to search the whole draft.</span></div>`;
      return;
    }
    if (!matches.length) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("check-circle")}<span>No matches. Try a shorter phrase or turn off whole-word.</span></div>`;
      return;
    }
    matches.slice(0, 200).forEach((match, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `find-result${index === searchState.index ? " is-active" : ""}`;
      button.style.setProperty("--i", String(index));
      button.innerHTML = `<span class="find-result__index">${String(index + 1).padStart(2, "0")}</span><span class="find-result__copy">…${escapeHtml(match.before)}<mark>${escapeHtml(match.text)}</mark>${escapeHtml(match.after)}…</span><span class="find-result__type">${escapeHtml(match.type)}</span>`;
      button.addEventListener("click", () => {
        searchState.index = index;
        renderFindResults();
        selectFindMatch(index, true);
      });
      els.findResults.appendChild(button);
    });
  }
  function openFind(mode = "find") {
    modalActions.invalidateModalClose(els.findDialog);
    editorActions.hideSmartType();
    searchState.mode = mode;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const selected = selection.toString().trim();
      if (selected && selected.length < 90) {
        searchState.query = selected;
        els.findInput.value = selected;
      }
    }
    els.findDialog.classList.remove("is-closing");
    if (!els.findDialog.open) els.findDialog.showModal();
    searchState.open = true;
    runFind();
    requestAnimationFrame(() => {
      els.findInput.focus();
      if (mode === "replace") els.replaceInput.focus();
      els.findInput.select();
    });
  }
  function closeFind() {
    findGeneration++; regexClient.cancel(); setFindBusy(false);
    if (!els.findDialog.open) return;
    const match = searchState.matches[searchState.index];
    modalActions.closeModalAnimated(els.findDialog, () => {
      searchState.open = false;
      clearFindHighlights();
      $$(".para.is-find-target", els.editor).forEach((el) => el.classList.remove("is-find-target"));
      if (match && documentSession.doc.paragraphs.some(p => p.id === match.paragraphId)) {
        editorActions.focusParagraph(match.paragraphId, "start");
        const el = editorActions.paragraphElement(match.paragraphId), range = el && rangeForOffsets(el, match.start, match.end);
        if (range) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }
    });
  }
  function resetDocumentSearch() {
    findGeneration++;
    regexClient.cancel();
    setFindBusy(false);
    modalActions.invalidateModalClose(els.findDialog);
    if (els.findDialog.open) els.findDialog.close();
    els.findDialog.classList.remove("is-open", "is-closing");
    searchState.open = false;
    searchState.matches = [];
    searchState.index = 0;
    clearFindHighlights();
  }
  function rangeForOffsets(root, start, end) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === 1 && node.tagName === "BR") return NodeFilter.FILTER_ACCEPT;
        if (node.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    let offset = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1 && node.tagName === "BR") {
        if (startNode === null && offset >= start) {
          startNode = node.parentNode;
          startOffset = Array.from(node.parentNode.childNodes).indexOf(node);
        }
        if (startNode !== null && offset + 1 >= end) {
          endNode = node.parentNode;
          endOffset = Array.from(node.parentNode.childNodes).indexOf(node);
          break;
        }
        offset += 1;
      } else {
        const length = node.nodeValue.length;
        if (startNode === null && offset + length >= start) {
          startNode = node;
          startOffset = start - offset;
        }
        if (startNode !== null && offset + length >= end) {
          endNode = node;
          endOffset = end - offset;
          break;
        }
        offset += length;
      }
    }
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.max(0, startOffset));
      range.setEnd(endNode, Math.max(0, endOffset));
      return range;
    } catch {
      return null;
    }
  }
  function rangeForMatch(match) {
    const el = editorActions.paragraphElement(match.paragraphId);
    if (!el) return null;
    return rangeForOffsets(el, match.start, match.end);
  }
  function clearFindHighlights() {
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete("fd-find");
      CSS.highlights.delete("fd-find-current");
    }
  }
  function applyFindHighlights() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === "undefined") return;
    if (!searchState.open || !searchState.matches.length) {
      clearFindHighlights();
      return;
    }
    const ranges = searchState.matches.map(rangeForMatch).filter(Boolean);
    if (!ranges.length) return;
    CSS.highlights.set("fd-find", new Highlight(...ranges));
    const current = ranges[searchState.index];
    if (current) CSS.highlights.set("fd-find-current", new Highlight(current));
    else CSS.highlights.delete("fd-find-current");
  }
  function selectFindMatch(index, scroll = true) {
    if (!searchState.matches.length) return;
    searchState.index = clamp(index, 0, searchState.matches.length - 1);
    const match = searchState.matches[searchState.index];
    if (workspaceState.view !== "script") workspaceLayout.setView("script");
    if (workspaceState.mode !== "write") workspaceLayout.setMode("write");
    const el = editorActions.paragraphElement(match.paragraphId);
    if (!el) return;
    const range = rangeForOffsets(el, match.start, match.end);
    if (!range) return;
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $$(".para.is-find-target", els.editor).forEach((item) => item.classList.remove("is-find-target"));
    el.classList.add("is-find-target");
    if (scroll) editorActions.scrollParagraphIntoView(el, "center", true);
    applyFindHighlights();
    $$(".find-result", els.findResults).forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === searchState.index);
    });
  }
  function replaceRangeInHtml(html, start, end, replacement) {
    const runs = FDX.htmlToRuns(html);
    const output = [];
    let cursor = 0;
    let replaced = false;
    for (const run of runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;
      if (runEnd <= start || runStart >= end) {
        output.push(run);
        continue;
      }
      if (runStart < start) {
        output.push({ ...run, text: run.text.slice(0, start - runStart) });
      }
      if (!replaced) {
        output.push({ ...run, text: replacement });
        replaced = true;
      }
      if (runEnd > end) {
        output.push({ ...run, text: run.text.slice(end - runStart) });
      }
    }
    if (!replaced) output.push({ text: replacement, style: "" });
    return FDX.runsToHtml(output.filter((run) => run.text));
  }
  function refreshAfterFindEdit(paragraph) {
    if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, paragraph);
    fileActions.markDirty();
    documentSession.history.record();
    const el = editorActions.paragraphElement(paragraph.id);
    if (el) {
      el.innerHTML = paragraph.html;
      editorActions.applyRevisionToElement(el, paragraph);
    }
    editorActions.decorateEditor();
    editorActions.scheduleChrome();
    runFind();
  }
  function replaceCurrent() {
    if (searchState.busy || !searchState.matches.length) return;
    if (searchState.version !== documentSession.editVersion) { runFind(); return; }
    const match = searchState.matches[searchState.index];
    const paragraph = documentSession.doc.paragraphs.find((item) => item.id === match.paragraphId);
    if (!paragraph) return;
    const replacement = FDCoreWriting.expandReplacement(els.replaceInput.value, match, paragraphText(paragraph));
    paragraph.html = replaceRangeInHtml(paragraph.html, match.start, match.end, replacement);
    refreshAfterFindEdit(paragraph);
    modalActions.toast("Replaced", `One match in ${match.type}.`, "success", 1800);
  }
  /* Expand `$&`, `$1`…`$99` and `$$` in a replacement for one match, using the
   * same rules String.prototype.replace applies. Without this, regex replace
   * wrote "$1" into the script literally and silently destroyed the captured
   * names — a destructive bulk edit with a success toast. `$`` and `$'` are
   * supported too, since they are part of the same substitution grammar. */
  function expandReplacement(template, matchArray, index, text) {
    if (!template || template.indexOf("$") === -1) return template;
    const whole = matchArray[0] || "";
    return template.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, group) => {
      if (group === "$") return "$";
      if (group === "&") return whole;
      if (group === "`") return text.slice(0, index);
      if (group === "'") return text.slice(index + whole.length);
      if (group.startsWith("<")) {
        return matchArray.groups === undefined ? token : (matchArray.groups[group.slice(1, -1)] ?? "");
      }
      const captureIndex = Number(group);
      /* `matchArray` is a real array here (not an object spread, which would
       * drop `length` and make every numbered reference fall through). */
      if (captureIndex >= 1 && captureIndex < matchArray.length) {
        return matchArray[captureIndex] == null ? "" : matchArray[captureIndex];
      }
      if (group.length === 2 && Number(group[0]) >= 1 && Number(group[0]) < matchArray.length) {
        return (matchArray[Number(group[0])] ?? "") + group[1];
      }
      /* An out-of-range reference is left as typed rather than blanked. */
      return token;
    });
  }
  function replaceAll() {
    if (searchState.busy || !searchState.query || !searchState.matches.length) return;
    if (searchState.version !== documentSession.editVersion) { runFind(); return; }
    if (searchState.truncated) { modalActions.toast("Too many matches", "Narrow the search so every replacement can be reviewed and applied together.", "warning"); return; }
    const replacement = els.replaceInput.value;
    const byParagraph = new Map();
    for (const match of searchState.matches) {
      if (!byParagraph.has(match.paragraphId)) byParagraph.set(match.paragraphId, []);
      byParagraph.get(match.paragraphId).push(match);
    }
    let count = 0;
    for (const paragraph of documentSession.doc.paragraphs) {
      const text = paragraphText(paragraph);
      const matches = byParagraph.get(paragraph.id) || [];
      if (!matches.length) continue;
      let html = paragraph.html;
      for (const item of matches.slice().reverse()) {
        const value = FDCoreWriting.expandReplacement(replacement, item, text);
        html = replaceRangeInHtml(html, item.start, item.end, value);
        count += 1;
      }
      paragraph.html = html;
      if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, paragraph);
    }
    if (count) {
      fileActions.markDirty();
      documentSession.history.record();
      workspaceLayout.renderAll();
      searchState.index = 0;
      runFind();
      modalActions.toast("Replaced all", `${plural(count, "match", "matches")} updated.`, "success");
    } else {
      runFind();
    }
  }
  function bindFindEvents() {
    on("findClose", "click", closeFind);
    on("findInput", "input", () => {
      searchState.query = els.findInput.value;
      searchState.index = 0;
      runFind();
    });
    on("replaceInput", "input", () => {
      searchState.replacement = els.replaceInput.value;
    });
    on("findInput", "keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          selectFindMatch(searchState.index - 1);
        } else {
          selectFindMatch(searchState.index + 1);
        }
      }
    });
    on("findNext", "click", () => selectFindMatch(searchState.index + 1));
    on("findPrev", "click", () => selectFindMatch(searchState.index - 1));
    on("findReplaceOne", "click", replaceCurrent);
    on("findReplaceAll", "click", replaceAll);
    $$(".find-option").forEach((button) => {
      button.addEventListener("click", () => {
        const option = button.dataset.findOption;
        if (option === "case") searchState.caseSensitive = !searchState.caseSensitive;
        if (option === "word") searchState.wholeWord = !searchState.wholeWord;
        if (option === "regex") searchState.regex = !searchState.regex;
        button.classList.toggle("is-active", searchState[option === "case" ? "caseSensitive" : option === "word" ? "wholeWord" : "regex"]);
        searchState.index = 0;
        runFind();
      });
    });
    els.findDialog.addEventListener("click", (event) => {
      if (event.target === els.findDialog) closeFind();
    });
    els.findDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFind();
    });
    els.findDialog.addEventListener("close", () => {
      if (els.findDialog.open) return;
      searchState.open = false;
      clearFindHighlights();
    });
  }
  return {
    applyFindHighlights,
    bindFindEvents,
    closeFind,
    findSelectionAction,
    openFind,
    rangeForOffsets,
    resetDocumentSearch,
  };
};
