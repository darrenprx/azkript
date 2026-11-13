/* Shared editing, typography and background-search primitives. No app state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./fdx.js'));
  else root.FDCoreWriting = factory(root.FDModel, root.FDX);
})(typeof self !== 'undefined' ? self : this, function (M, FDX) {
  'use strict';
  const textOf = p => FDX.htmlToRuns(p.html || '').map(r => r.text).join('');
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
  function sliceHtml(html, start, end) {
    start = Math.max(0, Number(start) || 0);
    end = end === undefined ? Infinity : Math.max(start, Number(end) || 0);
    let cursor = 0;
    const out = [];
    for (const run of FDX.htmlToRuns(html)) {
      const finish = cursor + run.text.length;
      if (finish > start && cursor < end) out.push({ ...run, text: run.text.slice(Math.max(0, start - cursor), Math.min(run.text.length, end - cursor)) });
      cursor = finish;
    }
    return FDX.runsToHtml(out);
  }
  function orderedRange(doc, range) {
    let a = doc.paragraphs.findIndex(p => p.id === range.start.id);
    let b = doc.paragraphs.findIndex(p => p.id === range.end.id);
    if (a < 0 || b < 0) throw new Error('Selection no longer belongs to this document.');
    let start = { ...range.start, offset: clamp(range.start.offset, 0, textOf(doc.paragraphs[a]).length) };
    let end = { ...range.end, offset: clamp(range.end.offset, 0, textOf(doc.paragraphs[b]).length) };
    if (a > b || (a === b && start.offset > end.offset)) { [a, b] = [b, a]; [start, end] = [end, start]; }
    return { a, b, start, end };
  }
  function cleanDualGroups(doc) {
    const groups = new Map();
    for (const p of doc.paragraphs) if (p.dualGroup) {
      const list = groups.get(p.dualGroup) || []; list.push(p); groups.set(p.dualGroup, list);
    }
    for (const list of groups.values()) {
      const sides = new Set(list.map(p => p.dualSide));
      const positions = list.map(p => doc.paragraphs.indexOf(p));
      if (!sides.has(0) || !sides.has(1) || positions.some((n, i) => i && n !== positions[i - 1] + 1)) {
        for (const p of list) { p.dualGroup = null; p.dualSide = null; }
      }
    }
  }
  function replaceSelection(input, selection, text) {
    const doc = M.cloneDocument(input);
    const { a, b, start, end } = orderedRange(doc, selection);
    const first = doc.paragraphs[a], last = doc.paragraphs[b];
    const prefix = sliceHtml(first.html, 0, start.offset);
    const suffix = sliceHtml(last.html, end.offset, textOf(last).length);
    const pieces = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const inserted = [{ ...first, html: prefix + M.escapeHtml(pieces[0]) }];
    for (const piece of pieces.slice(1)) {
      const previous = inserted[inserted.length - 1];
      const next = M.makeParagraph(M.nextType(previous.type, doc), '');
      next.html = M.escapeHtml(piece);
      next.dualGroup = first.dualGroup || null; next.dualSide = first.dualSide ?? null;
      if (doc.revision.enabled) M.markRevision(doc, next);
      inserted.push(next);
    }
    const final = inserted[inserted.length - 1];
    const offset = textOf(final).length;
    final.html += suffix;
    if (doc.revision.enabled) M.markRevision(doc, inserted[0]);
    doc.paragraphs.splice(a, b - a + 1, ...inserted);
    cleanDualGroups(doc);
    return { doc, caret: { id: final.id, offset } };
  }
  function deleteAdjacent(input, caret, direction) {
    const doc = M.normalizeDocument(input), index = doc.paragraphs.findIndex(p => p.id === caret.id);
    if (index < 0) throw new Error('Caret no longer belongs to this document.');
    const offset = clamp(caret.offset, 0, textOf(doc.paragraphs[index]).length);
    const text = textOf(doc.paragraphs[index]);
    const graphemes = graphemeOffsets(text);
    if (direction < 0 && offset > 0) {
      const before = graphemes.filter(n => n < offset).pop() ?? 0;
      return replaceSelection(doc, { start: { id: caret.id, offset: before }, end: { id: caret.id, offset } }, '');
    }
    if (direction > 0 && offset < text.length) {
      const after = graphemes.find(n => n > offset) ?? text.length;
      return replaceSelection(doc, { start: { id: caret.id, offset }, end: { id: caret.id, offset: after } }, '');
    }
    const other = doc.paragraphs[index + (direction < 0 ? -1 : 1)];
    if (!other) return { doc, caret: { id: caret.id, offset } };
    const start = direction < 0 ? { id: other.id, offset: textOf(other).length } : { id: caret.id, offset };
    const end = direction < 0 ? { id: caret.id, offset: 0 } : { id: other.id, offset: 0 };
    return replaceSelection(doc, { start, end }, '');
  }
  function graphemeOffsets(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const offsets = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.index);
      return [...offsets, text.length];
    }
    const out = [0]; let offset = 0;
    for (const point of text) { offset += point.length; out.push(offset); }
    return out;
  }
  function directionFor(text) {
    const first = String(text || '').match(/[\p{L}]/u)?.[0] || '';
    return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u.test(first) ? 'rtl' : 'ltr';
  }
  function captureSelection(editor, selection) {
    selection = selection || (typeof window !== 'undefined' && window.getSelection());
    if (!selection || !selection.rangeCount) return null;
    const endpoint = (node, offset) => {
      const el = node?.nodeType === 1 ? node.closest('.para') : node?.parentElement?.closest('.para');
      if (!el || !editor.contains(el)) return null;
      const range = el.ownerDocument.createRange(); range.selectNodeContents(el); range.setEnd(node, offset);
      const holder = el.ownerDocument.createElement('div'); holder.appendChild(range.cloneContents());
      return { id: el.dataset.id, offset: FDX.htmlToRuns(holder.innerHTML).map(run => run.text).join('').length };
    };
    const start = endpoint(selection.anchorNode, selection.anchorOffset), end = endpoint(selection.focusNode, selection.focusOffset);
    return start && end ? { start, end } : null;
  }
  function restoreSelection(editor, snapshot) {
    if (!snapshot || !editor?.ownerDocument) return false;
    const point = endpoint => {
      const el = Array.from(editor.querySelectorAll('.para[data-id]')).find(p => p.dataset.id === endpoint.id);
      if (!el) return null;
      let remaining = Math.max(0, endpoint.offset);
      const walker = editor.ownerDocument.createTreeWalker(el, 5);
      let node, last;
      while ((node = walker.nextNode())) {
        if (node.nodeType === 1) {
          if (node.tagName !== 'BR') continue;
          const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
          if (remaining <= 1) return [node.parentNode, index + (remaining ? 1 : 0)];
          remaining--; continue;
        }
        last = node; if (remaining <= node.length) return [node, remaining]; remaining -= node.length;
      }
      return last ? [last, last.length] : [el, 0];
    };
    const a = point(snapshot.start), b = point(snapshot.end);
    if (!a || !b) return false;
    const selection = editor.ownerDocument.defaultView.getSelection();
    const owner = (a[0].nodeType === 1 ? a[0] : a[0].parentElement).closest('.para');
    owner?.focus({ preventScroll: true });
    selection.setBaseAndExtent(a[0], a[1], b[0], b[1]); return true;
  }
  function expandReplacement(template, match, text) {
    const captures = match.captures || match;
    const groups = match.groups || captures.groups;
    const whole = captures[0] || match.text || '';
    const index = match.start ?? match.index ?? 0;
    return String(template).replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, group) => {
      if (group === '$') return '$'; if (group === '&') return whole;
      if (group === '`') return text.slice(0, index); if (group === "'") return text.slice(index + whole.length);
      if (group.startsWith('<')) return groups === undefined ? token : groups[group.slice(1, -1)] ?? '';
      const number = Number(group);
      if (number >= 1 && number < captures.length) return captures[number] ?? '';
      if (group.length === 2 && Number(group[0]) >= 1 && Number(group[0]) < captures.length) return (captures[Number(group[0])] ?? '') + group[1];
      return token;
    });
  }
  function searchError(message, code) { const error = new Error(message); error.code = code; return error; }
  // Self-contained so file:// builds can create a worker from trusted shipped
  // code rather than relying on file-origin worker loading (blocked by Chrome).
  function runSearchTask(data) {
    const { id } = data;
    try {
      const flags = [...new Set(String(data.flags || 'giu').split('').filter(flag => flag !== 'y'))];
      if (!flags.includes('g')) flags.push('g');
      const regex = new RegExp(data.pattern, flags.join(''));
      const matches = [], max = Math.max(1, Math.min(100000, Number(data.maxMatches) || 10000));
      let totalCount = 0, truncated = false;
      outer: for (const paragraph of data.paragraphs || []) {
        const text = String(paragraph.text || ''); regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (!match[0]) { regex.lastIndex += (regex.unicode || regex.unicodeSets) && text.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1; continue; }
          totalCount++;
          if (matches.length >= max) { truncated = true; break outer; }
          matches.push({ paragraphId: paragraph.id, start: match.index, end: match.index + match[0].length,
            text: match[0], captures: Array.from(match), groups: match.groups,
            before: text.slice(Math.max(0, match.index - 34), match.index), after: text.slice(match.index + match[0].length, match.index + match[0].length + 34), type: paragraph.type });
        }
      }
      return { id, matches, totalCount, truncated };
    } catch (error) { return { id, error: error.message || String(error), code: 'REGEX_INVALID' }; }
  }
  function createRegexClient(workerURL, options = {}) {
    let worker = null, pending = null, sequence = 0;
    const WorkerClass = options.Worker || (typeof Worker !== 'undefined' ? Worker : null);
    const stop = (error) => {
      if (worker) { worker.terminate(); worker = null; }
      if (pending) { clearTimeout(pending.timer); const reject = pending.reject; pending = null; reject(error); }
    };
    const client = {
      search(paragraphs, query = {}) {
        client.cancel();
        if (!WorkerClass) return Promise.reject(searchError('Background search is unavailable in this browser.', 'WORKER_UNAVAILABLE'));
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          try {
            if (typeof location !== 'undefined' && location.protocol === 'file:' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
              const script = `const run = ${runSearchTask.toString()}; self.onmessage = ({data}) => self.postMessage(run(data));`;
              const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
              worker = new WorkerClass(url); URL.revokeObjectURL(url);
            } else worker = new WorkerClass(workerURL);
          } catch (error) { reject(error); return; }
          const timer = setTimeout(() => stop(searchError('The search pattern took too long. Simplify it and try again.', 'SEARCH_TIMEOUT')),
            Math.max(20, Number(query.timeoutMs ?? options.timeoutMs) || 1500));
          pending = { id, timer, reject };
          worker.onmessage = ({ data }) => {
            if (!pending || data.id !== pending.id) return;
            clearTimeout(timer); pending = null; worker.terminate(); worker = null;
            if (data.error) reject(searchError(data.error, data.code || 'SEARCH_ERROR')); else resolve(data);
          };
          worker.onerror = event => stop(searchError(event.message || 'Background search failed.', 'WORKER_ERROR'));
          try {
            worker.postMessage({ id, operation: 'search', paragraphs: paragraphs.map(p => ({ id: p.id, type: p.type,
              text: p.text === undefined ? textOf(p) : String(p.text) })), pattern: query.pattern ?? query.query ?? '',
              flags: query.flags || 'giu', maxMatches: query.maxMatches ?? options.maxMatches ?? 10000 });
          } catch (error) { stop(error); }
        });
      },
      cancel() { stop(searchError('Search cancelled.', 'SEARCH_CANCELLED')); },
      dispose() { client.cancel(); },
    };
    return client;
  }
  function createPaginationClient(workerURL, options = {}) {
    let worker = null, pending = null, sequence = 0;
    const WorkerClass = options.Worker || (typeof Worker !== 'undefined' ? Worker : null);
    function cancel() {
      if (worker) { worker.terminate(); worker = null; }
      if (pending) { clearTimeout(pending.timer); const reject = pending.reject; pending = null;
        reject(searchError('Pagination cancelled.', 'PAGINATION_CANCELLED')); }
    }
    return {
      layout(document, settings = {}) {
        cancel();
        if (!WorkerClass) return Promise.reject(searchError('Background pagination is unavailable.', 'WORKER_UNAVAILABLE'));
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          try {
            if (typeof options.source === 'string' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
              const url = URL.createObjectURL(new Blob([options.source], { type: 'text/javascript' }));
              worker = new WorkerClass(url); URL.revokeObjectURL(url);
            } else worker = new WorkerClass(workerURL);
          } catch (error) { reject(error); return; }
          const timer = setTimeout(() => {
            if (worker) { worker.terminate(); worker = null; }
            pending = null; reject(searchError('Background pagination took too long.', 'PAGINATION_TIMEOUT'));
          }, Math.max(100, Number(options.timeoutMs) || 10000));
          pending = { id, timer, reject };
          worker.onmessage = ({ data }) => {
            if (!pending || pending.id !== data.id) return;
            clearTimeout(timer); pending = null; worker.terminate(); worker = null;
            if (data.error) reject(new Error(data.error)); else resolve(data.result);
          };
          worker.onerror = event => {
            clearTimeout(timer); pending = null;
            if (worker) { worker.terminate(); worker = null; }
            reject(searchError(event.message || 'Background pagination failed.', 'WORKER_ERROR'));
          };
          // The original FDX XML is not needed to lay out the normalized model.
          const { sourceFDX, story, ...leanDocument } = document;
          const leanSettings = { ...settings }; delete leanSettings.measureText;
          try { worker.postMessage({ id, document: leanDocument, options: leanSettings }); }
          catch (error) { clearTimeout(timer); pending = null; worker.terminate(); worker = null; reject(error); }
        });
      }, cancel, dispose: cancel,
    };
  }
  function createMeasureText(fontFamily, fontSize = 12, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    const canvas = doc?.createElement('canvas'); const context = canvas?.getContext('2d');
    if (!context) return null;
    const cache = new Map();
    let activeFont = '';
    return (text, spec = {}) => {
      const size = Number(spec.size ?? spec.fontSize ?? fontSize) || 12;
      const family = spec.font || spec.fontFamily || fontFamily || 'Courier New';
      const font = `${spec.style || ''} ${size}pt ${JSON.stringify(family)}, "Courier New", monospace`.trim();
      const key = font + '\n' + text;
      if (cache.has(key)) return cache.get(key);
      if (activeFont !== font) { context.font = font; activeFont = font; }
      const width = context.measureText(String(text)).width * 72 / 96;
      if (cache.size >= 12000) cache.delete(cache.keys().next().value);
      cache.set(key, width); return width;
    };
  }
  function typography(fontFamily, fontSize = 12, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    const measure = createMeasureText(fontFamily, fontSize, doc);
    const generic = /^(monospace|serif|sans-serif|system-ui|cursive|fantasy)$/i.test(fontFamily);
    const canvas = doc?.createElement('canvas'), context = canvas?.getContext('2d');
    let available = null;
    if (context) {
      available = generic;
      for (const fallback of ['monospace', 'serif', 'sans-serif']) {
        for (const sample of ['mmmmmmmmmmlliWW', 'The quick fox 0123456789', '漢字 العربية 😀']) {
          context.font = `${fontSize}pt ${fallback}`; const base = context.measureText(sample).width;
          context.font = `${fontSize}pt ${JSON.stringify(fontFamily)}, ${fallback}`;
          if (Math.abs(context.measureText(sample).width - base) > 0.01) available = true;
        }
      }
      if (doc.fonts && !doc.fonts.check(`${fontSize}pt ${JSON.stringify(fontFamily)}`)) available = false;
    }
    return { family: fontFamily, size: fontSize, available, measurementAvailable: Boolean(measure),
      sampleAdvancePoints: measure ? measure('MMMMMMMMMM') / 10 : null,
      warning: available === true ? '' : available === false ? `The requested font ${fontFamily} is unavailable; a substitute will be used.` : 'Font availability could not be measured.' };
  }
  function visibleRange(count, scrollTop, viewportHeight, estimatedHeight, overscan = 4) {
    const height = Math.max(1, Number(estimatedHeight) || 1);
    const start = clamp(Math.floor(Math.max(0, scrollTop) / height) - overscan, 0, count);
    const end = clamp(Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / height) + overscan, start, count);
    return { start, end, before: start * height, after: (count - end) * height };
  }
  return { sliceHtml, replaceSelection, deleteAdjacent, captureSelection, restoreSelection, directionFor,
    graphemeOffsets, expandReplacement, runSearchTask, createRegexClient, createPaginationClient, createMeasureText, typography, visibleRange };
});
