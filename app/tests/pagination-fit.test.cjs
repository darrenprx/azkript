/* Pagination page-fit invariants.
 *
 * Regression cover for the bug where a split dialogue reserved zero space for
 * its (MORE) lead-out: the page's lineCount ended one line over contentHeight,
 * and because the page card clips with `overflow: hidden` (and the print root
 * behaves the same), the marker was invisible and the last dialogue line was cut
 * in half. A screenplay that hides "the speech continues" is worse than one that
 * breaks a line early.
 *
 * These assert the invariants, not the implementation:
 *   1. no script page exceeds contentHeight;
 *   2. an over-long speech still splits and still emits (MORE), inside the page;
 *   3. a character cue is never stranded alone at the foot of a page;
 *   4. splitting preserves the text exactly.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const model = require("../js/model.js");
const pagination = require("../js/pagination.js");

/** Build a layout from [type, text] pairs. */
function layoutOf(paragraphs, options) {
  const doc = model.blankDocument();
  doc.titlePage.enabled = false;
  doc.paragraphs = [];
  for (const [type, text] of paragraphs) doc.paragraphs.push(model.makeParagraph(type, text));
  return pagination.layout(model.normalizeDocument(doc), options);
}

const scriptPages = (layout) => layout.pages.filter((page) => page.kind === "script");
const OPTS = { fontSize: 12, lineHeight: 12, showMore: true };

test("no script page exceeds the content height (audit repro)", () => {
  const paras = [["Scene Heading", "INT. ROOM - DAY"]];
  for (let i = 0; i < 25; i += 1) paras.push(["Action", "action line " + i]);
  paras.push(["Character", "MARA"]);
  paras.push(["Dialogue", Array.from({ length: 20 }, (_, i) => "word" + i).join(" ")]);
  paras.push(["Action", "AFTER THE SPEECH"]);

  const layout = layoutOf(paras, OPTS);
  for (const page of scriptPages(layout)) {
    assert.ok(
      page.lineCount <= layout.contentHeight + 0.01,
      `page ${page.number} overruns: lineCount ${page.lineCount} > contentHeight ${layout.contentHeight}`
    );
  }
});

test("an over-long speech splits and keeps its (MORE) marker inside the page", () => {
  const paras = [["Scene Heading", "INT. ROOM - DAY"]];
  for (let i = 0; i < 22; i += 1) paras.push(["Action", `setup ${i} ${"word ".repeat(14)}`]);
  paras.push(["Character", "MARA"]);
  paras.push(["Dialogue", "This speech is deliberately far longer than one page. ".repeat(60)]);

  const layout = layoutOf(paras, OPTS);
  const pages = scriptPages(layout);
  const withMore = pages.filter((page) => page.blocks.some((b) => b.kind === "more"));
  assert.ok(withMore.length > 0, "an over-long speech must emit at least one (MORE) marker");

  for (const page of withMore) {
    assert.equal(
      page.blocks[page.blocks.length - 1].kind,
      "more",
      "(MORE) must be the last block on its page"
    );
    assert.ok(
      page.lineCount <= layout.contentHeight + 0.01,
      `page ${page.number} with (MORE) overruns: ${page.lineCount} > ${layout.contentHeight}`
    );
  }
});

test("a character cue is never stranded alone at the foot of a page", () => {
  // Vary the fill length so the break lands in different places.
  for (let count = 14; count <= 30; count += 1) {
    const paras = [["Scene Heading", "INT. ROOM - DAY"]];
    for (let i = 0; i < count; i += 1) paras.push(["Action", `a${i} ${"word ".repeat(14)}`]);
    paras.push(["Character", "MARA"]);
    paras.push(["Dialogue", "A speech that is long enough to require splitting. ".repeat(18)]);

    const layout = layoutOf(paras, OPTS);
    for (const page of scriptPages(layout)) {
      assert.ok(
        page.lineCount <= layout.contentHeight + 0.01,
        `fill ${count}: page ${page.number} overruns (${page.lineCount} > ${layout.contentHeight})`
      );
      const last = page.blocks[page.blocks.length - 1];
      if (last && last.kind === "paragraph" && last.type === "Character") {
        assert.fail(`fill ${count}: page ${page.number} ends with a lone Character cue`);
      }
    }
  }
});

test("splitting a speech preserves its text exactly", () => {
  const longLine = "alpha bravo charlie delta echo foxtrot golf hotel india juliet. ";
  const paras = [["Scene Heading", "INT. ROOM - DAY"]];
  for (let i = 0; i < 22; i += 1) paras.push(["Action", `filler ${i} ${"word ".repeat(14)}`]);
  paras.push(["Character", "MARA"]);
  paras.push(["Dialogue", longLine.repeat(30)]);

  const layout = layoutOf(paras, OPTS);
  const pieces = [];
  for (const page of scriptPages(layout)) {
    for (const block of page.blocks) {
      if (block.kind === "paragraph" && block.type === "Dialogue" && block.lines) {
        pieces.push(block.lines.map((line) => line.text).join(" "));
      }
    }
  }
  const recombined = pieces.join(" ").replace(/\s+/g, " ").trim();
  const expected = longLine.repeat(30).replace(/\s+/g, " ").trim();
  assert.equal(recombined, expected, "split speech must recombine to the original text");
});
