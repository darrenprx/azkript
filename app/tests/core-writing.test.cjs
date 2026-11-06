'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const M = require('../js/model.js');
const FDX = require('../js/fdx.js');
const core = require('../js/core-writing.js');
const pagination = require('../js/pagination.js');
function documentOf(...lines) {
  const doc = M.blankDocument(); doc.titlePage.enabled = false;
  doc.paragraphs = lines.map(([type, html]) => ({ ...M.makeParagraph(type, ''), html }));
  return doc;
}
test('cross-paragraph replacement preserves text order and unaffected run formatting', () => {
  const doc = documentOf(['Action', '<strong>before</strong> discarded'], ['Dialogue', 'also discarded <em>after</em>'], ['Action', 'untouched']);
  const result = core.replaceSelection(doc, { start: { id: doc.paragraphs[0].id, offset: 6 }, end: { id: doc.paragraphs[1].id, offset: 15 } }, '\nnew');
  assert.equal(M.paragraphText(result.doc.paragraphs[0]), 'before');
  assert.equal(M.paragraphText(result.doc.paragraphs[1]), 'newafter');
  assert.match(result.doc.paragraphs[0].html, /strong/);
  assert.match(result.doc.paragraphs[1].html, /em/);
  assert.equal(result.doc.paragraphs[2].html, 'untouched');
  assert.deepEqual(result.caret, { id: result.doc.paragraphs[1].id, offset: 3 });
  assert.equal(doc.paragraphs.length, 3, 'the input document remains available for undo');
});
test('backward selections and multiline paste preserve the final suffix', () => {
  const doc = documentOf(['Action', 'beforeAFTER']); const id = doc.paragraphs[0].id;
  const result = core.replaceSelection(doc, { start: { id, offset: 6 }, end: { id, offset: 6 } }, 'ONE\r\nTWO');
  assert.deepEqual(result.doc.paragraphs.map(M.paragraphText), ['beforeONE', 'TWOAFTER']);
  const backward = core.replaceSelection(doc, { start: { id, offset: 11 }, end: { id, offset: 6 } }, 'end');
  assert.equal(M.paragraphText(backward.doc.paragraphs[0]), 'beforeend');
});
test('Backspace deletes a grapheme rather than half of an emoji/combining cluster', () => {
  const doc = documentOf(['Action', 'A👨‍👩‍👧‍👦e\u0301']); const id = doc.paragraphs[0].id;
  const first = core.deleteAdjacent(doc, { id, offset: M.paragraphText(doc.paragraphs[0]).length }, -1);
  assert.equal(M.paragraphText(first.doc.paragraphs[0]), 'A👨‍👩‍👧‍👦');
  const second = core.deleteAdjacent(first.doc, first.caret, -1);
  assert.equal(M.paragraphText(second.doc.paragraphs[0]), 'A');
});
test('Delete and Backspace join boundaries without losing the later paragraph suffix', () => {
  const doc = documentOf(['Action', 'first'], ['Action', '<em>second</em>']);
  const result = core.deleteAdjacent(doc, { id: doc.paragraphs[0].id, offset: 5 }, 1);
  assert.equal(result.doc.paragraphs.length, 1);
  assert.equal(M.paragraphText(result.doc.paragraphs[0]), 'firstsecond');
  assert.match(result.doc.paragraphs[0].html, /em/);
  assert.equal(result.caret.offset, 5);
});
test('deleting across dual-dialogue sides removes stranded dual grouping', () => {
  const doc = documentOf(['Character', 'A'], ['Dialogue', 'left'], ['Character', 'B'], ['Dialogue', 'right']);
  doc.paragraphs.forEach((p, index) => { p.dualGroup = 'g'; p.dualSide = index < 2 ? 0 : 1; });
  const result = core.replaceSelection(doc, { start: { id: doc.paragraphs[0].id, offset: 1 }, end: { id: doc.paragraphs[3].id, offset: 5 } }, '');
  assert.equal(result.doc.paragraphs.length, 1);
  assert.equal(result.doc.paragraphs[0].dualGroup, null);
});
test('native replacement tokens match JavaScript replacement behavior', () => {
  const text = 'before Alpha after', captures = /(?<word>Alpha)/.exec(text);
  const match = { captures: Array.from(captures), groups: captures.groups, start: captures.index, text: captures[0] };
  for (const template of ['$<word>/$12/$$', '$&', '$`', "$'", '$01', '$00', '$99', '$<missing>']) {
    const expected = text.replace(/(?<word>Alpha)/, template);
    const actual = text.slice(0, match.start) + core.expandReplacement(template, match, text) + text.slice(match.start + match.text.length);
    assert.equal(actual, expected, template);
  }
});
test('direction inference follows the first strong letter', () => {
  assert.equal(core.directionFor('123 שלום'), 'rtl');
  assert.equal(core.directionFor('“مرحبا”'), 'rtl');
  assert.equal(core.directionFor('123 中文'), 'ltr');
  assert.equal(core.directionFor('123 English العربية'), 'ltr');
});
test('measured wrap respects glyph widths, graphemes and original offsets', () => {
  const text = 'Wide WWW narrow iii then 🧑‍🚀🧑‍🚀';
  const measure = value => Array.from(value).reduce((n, point) => n + (point === 'W' ? 12 : /i/.test(point) ? 2 : 6), 0);
  const lines = pagination.wrapMeasured(text, 48, measure);
  assert.ok(lines.length > 2);
  for (const line of lines) { assert.equal(line.text, text.slice(line.start, line.end)); assert.ok(measure(line.text) <= 48); }
  assert.ok(!lines.some(line => /^\u200d|\u200d$/u.test(line.text)), 'a grapheme is never split at its joiner');
});
test('a tall first paragraph is split instead of silently disappearing', () => {
  const doc = documentOf(['Action', 'Unbroken opening action that spans many lines. '.repeat(180)]);
  const layout = pagination.layout(doc);
  assert.ok(layout.scriptPageCount > 1);
  assert.ok(layout.pages.every(page => page.lineCount <= layout.contentHeight + 0.01));
  const body = layout.pages.flatMap(p => p.blocks).filter(b => b.kind === 'paragraph').map(b => FDX.htmlToRuns(b.html).map(r => r.text).join('')).join('');
  assert.equal(body.replace(/\s/g, ''), M.paragraphText(doc.paragraphs[0]).replace(/\s/g, ''));
});
test('explicit paragraph page breaks reach the shared screen/print engine', () => {
  const doc = documentOf(['Action', 'first'], ['Action', 'next page']); doc.paragraphs[1].pageBreakBefore = true;
  const layout = pagination.layout(doc);
  assert.equal(layout.scriptPageCount, 2);
});
test('long dual dialogue splits without clipping either column or duplicating text', () => {
  const doc = documentOf(['Character', 'LEFT'], ['Dialogue', 'left speech '.repeat(600)], ['Character', 'RIGHT'], ['Dialogue', 'right speech '.repeat(400)]);
  doc.paragraphs.forEach((p, index) => { p.dualGroup = 'g'; p.dualSide = index < 2 ? 0 : 1; });
  const layout = pagination.layout(doc);
  assert.ok(layout.scriptPageCount > 1);
  assert.ok(layout.pages.every(page => page.lineCount <= layout.contentHeight + 0.01));
  for (const paragraph of doc.paragraphs) {
    const parts = layout.pages.flatMap(page => page.blocks).flatMap(block => block.columns || []).flatMap(column => column.blocks)
      .filter(block => block.paragraph.id === paragraph.id).map(block => pagination.plainText(block.html)).join('');
    assert.equal(parts, M.paragraphText(paragraph));
  }
});
test('dual columns wrap at the same gap/padding geometry used by the renderer', () => {
  const doc = documentOf(['Character', 'LEFT'], ['Dialogue', 'words for the left column '.repeat(15)], ['Character', 'RIGHT'], ['Dialogue', 'words for the right column '.repeat(15)]);
  doc.paragraphs.forEach((p, index) => { p.dualGroup = 'g'; p.dualSide = index < 2 ? 0 : 1; });
  const geometry = pagination.dualGeometry(doc);
  assert.equal(geometry.widthInches, 6); assert.equal(geometry.paddingInches, 0.1);
  assert.ok(Math.abs(geometry.columnWidthPoints - 189) < 0.01);
  const layout = pagination.layout(doc, { measureText: text => text.length * 7.2 });
  for (const block of layout.pages.flatMap(page => page.blocks)) {
    for (const column of block.columns || []) for (const item of column.blocks) {
      assert.ok(item.lines.every(line => line.text.length * 7.2 <= geometry.columnWidthPoints + 0.01));
    }
  }
});
test('custom elements and typography share font metrics across layout and rendering', () => {
  const doc = documentOf(['Action', 'unused']);
  doc.elements = { Panel: { ...M.ELEMENTS.Action, label: 'Panel', left: 2, right: 3, before: 18,
    font: 'Arial', fontSize: 18, spacing: 1.5, leading: 'Tight' } };
  doc.paragraphs[0].type = 'Panel'; doc.paragraphs[0].html = 'one two three four five six seven eight nine ten';
  const seen = [];
  const result = pagination.layout(doc, { measureText(text, font) { seen.push(font); return text.length * 9; } });
  const block = result.pages[0].blocks[0];
  const visual = pagination.paragraphTypography(doc, doc.paragraphs[0]);
  assert.equal(block.type, 'Panel'); assert.equal(block.font.font, 'Arial'); assert.equal(block.font.size, 18);
  assert.equal(block.lineHeight, visual.lineHeight); assert.equal(visual.lineHeight, 18 * 1.5 * 0.9);
  assert.ok(seen.every(font => font.font === 'Arial' && font.size === 18));
  assert.ok(block.lines.every(line => line.text.length <= 8));
  const overridden = pagination.paragraphTypography(doc, doc.paragraphs[0], { fontFamily: 'Consolas', fontSize: 10, lineHeight: 10, useDocumentTypography: false });
  assert.equal(overridden.font, 'Consolas'); assert.equal(overridden.size, 10);
});
test('native run fonts and sizes contribute their real width and line height', () => {
  const html = FDX.runsToHtml([{ text: 'wide wide wide', style: 'Bold', attrs: { Font: 'Arial', Size: '24' } }]);
  const doc = documentOf(['Action', html]);
  const seen = [];
  const layout = pagination.layout(doc, { measureText(text, font) { seen.push(font); return text.length * font.size; } });
  const block = layout.pages[0].blocks[0];
  assert.ok(seen.length > 0 && seen.every(font => font.font === 'Arial' && font.size === 24 && font.style.includes('bold')));
  assert.equal(block.lineHeight, 24);
  assert.equal(pagination.paragraphTypography(doc, doc.paragraphs[0]).lineHeight, 24);
});
test('150–300 page fixture paginates without truncation under a bounded time budget', () => {
  const doc = M.blankDocument(); doc.titlePage.enabled = false;
  doc.paragraphs = Array.from({ length: 2400 }, (_, index) => M.makeParagraph('Action', `Block ${index}: ${'screenplay '.repeat(20)}`));
  const before = performance.now(); const layout = pagination.layout(doc); const elapsed = performance.now() - before;
  assert.ok(layout.scriptPageCount >= 150 && layout.scriptPageCount <= 300, `fixture is ${layout.scriptPageCount} pages`);
  assert.equal(new Set(layout.pages.flatMap(p => p.blocks).map(b => b.paragraph?.id)).size, doc.paragraphs.length);
  assert.ok(elapsed < 5000, `pagination took ${elapsed.toFixed(1)}ms`);
});
test('virtualized range keeps overscan and spacer geometry bounded', () => {
  assert.deepEqual(core.visibleRange(10000, 5000, 800, 100, 2), { start: 48, end: 60, before: 4800, after: 994000 });
});
