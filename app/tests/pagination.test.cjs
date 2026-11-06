/* Pagination and page geometry tests. */
const assert = require("node:assert/strict");
const test = require("node:test");
const model = require("../js/model.js");
const pagination = require("../js/pagination.js");

function longDocument() {
  const doc = model.blankDocument();
  doc.titlePage.enabled = false;
  doc.paragraphs = [];
  const add = (type, text) => doc.paragraphs.push(model.makeParagraph(type, text));
  add("Scene Heading", "INT. TEST - DAY");
  for (let index = 0; index < 20; index += 1) {
    add("Action", `Action line ${index} ${"word ".repeat(18)}`);
  }
  add("Character", "MARA");
  add("Dialogue", "This is a very long speech. ".repeat(80));
  add("Character", "ELIAS");
  add("Dialogue", "Short reply.");
  return model.normalizeDocument(doc);
}

test("sample pagination produces a title page and one script page", () => {
  const layout = pagination.layout(model.sampleDocument());
  assert.equal(layout.pages[0].kind, "title");
  assert.equal(layout.scriptPageCount, 1);
  assert.equal(layout.totalPageCount, 2);
  assert.ok(layout.pages[1].blocks.length > 20);
  assert.equal(layout.pages[1].number, 1);
  assert.ok(layout.pages[1].blocks.some((block) => block.type === "DualDialogue"));
});

test("line wrapping keeps source offsets and does not exceed the column", () => {
  const text = "one two three four five six seven";
  const lines = pagination.wrapText(text, 12);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(line.text.length <= 12);
    assert.equal(text.slice(line.start, line.end), line.text);
  }
});

test("dialogue splits with MORE and CONT'D and never overflows the page", () => {
  const layout = pagination.layout(longDocument());
  assert.ok(layout.scriptPageCount >= 3);
  const blocks = layout.pages.flatMap((page) => page.blocks);
  assert.ok(blocks.some((block) => block.kind === "more"));
  assert.ok(
    blocks.some(
      (block) =>
        block.continuation &&
        /CONT/.test(block.paragraph && block.paragraph.html),
    ),
  );
  for (const page of layout.pages) {
    assert.ok(
      page.lineCount <= layout.contentHeight + 0.5,
      `page ${page.number} uses ${page.lineCount}pt of ${layout.contentHeight}pt`,
    );
  }
});

test("omitted scenes are excluded from the published pages", () => {
  const doc = model.sampleDocument();
  const scenes = model.getScenes(doc);
  scenes[1].paragraph.scene = { ...scenes[1].paragraph.scene, omit: true };
  const layout = pagination.layout(doc);
  const text = layout.pages
    .flatMap((page) => page.blocks)
    .map((block) => block.paragraph?.html || "")
    .join(" ");
  assert.doesNotMatch(text, /CONTROL ROOM/);
  assert.match(text, /OBSERVATORY RIDGE/);
  assert.match(text, /CLIFFSIDE/);
});

test("scene numbers are carried into page blocks when enabled", () => {
  const doc = model.sampleDocument();
  doc.settings.sceneNumbers = true;
  const layout = pagination.layout(doc);
  const headings = layout.pages
    .flatMap((page) => page.blocks)
    .filter((block) => block.type === "Scene Heading");
  assert.equal(headings.length, 3);
  assert.deepEqual(
    headings.map((block) => block.sceneNumber),
    ["1", "2", "3"],
  );
});

test("HTML slices keep inline styles and do not duplicate text", () => {
  const html = "A <strong>bold</strong> and <em>italic</em> line.";
  const text = pagination.plainText(html);
  const sliced = pagination.sliceHtml(html, 2, 8);
  assert.equal(pagination.plainText(sliced), text.slice(2, 8));
  assert.match(sliced, /<strong>|bold/);
  assert.equal((sliced.match(/bold/g) || []).length, 1);
});

test("title page can be disabled without losing script pages", () => {
  const doc = model.sampleDocument();
  doc.titlePage.enabled = false;
  const layout = pagination.layout(doc);
  assert.equal(layout.pages[0].kind, "script");
  assert.equal(layout.scriptPageCount, 1);
  assert.equal(layout.totalPageCount, 1);
});

/* Regression: a split speech used to reprint the whole paragraph on every page
 * after the break, because continuation blocks inherited the original `html`
 * through `...block` and the renderer preferred it over the split lines. */
test("split dialogue renders each page's own slice, never the whole speech", () => {
  const doc = model.blankDocument();
  doc.titlePage.enabled = false;
  doc.paragraphs = [];
  const speech = Array.from({ length: 120 }, (_, i) => `Sentence number ${i + 1} continues here.`).join(" ");
  doc.paragraphs.push(model.makeParagraph("Scene Heading", "INT. TEST - DAY"));
  doc.paragraphs.push(model.makeParagraph("Character", "MARA"));
  doc.paragraphs.push(model.makeParagraph("Dialogue", speech));
  const normalized = model.normalizeDocument(doc);
  const layout = pagination.layout(normalized);
  const sourceChars = normalized.paragraphs[2].html.length;

  const dialogueBlocks = layout.pages
    .flatMap((page) => page.blocks)
    .filter((block) => block.kind === "paragraph" && block.type === "Dialogue");
  assert.ok(dialogueBlocks.length > 1, "speech should span multiple pages");
  assert.ok(dialogueBlocks.some((block) => block.isContinuation), "expected continuation blocks");

  for (const block of dialogueBlocks) {
    const rendered = block.html != null ? block.html : block.paragraph.html;
    assert.ok(
      rendered.length <= sourceChars,
      `a single block must never exceed the source paragraph (${rendered.length} > ${sourceChars})`,
    );
    if (block.isContinuation) {
      assert.ok(
        rendered.length < sourceChars,
        "a continuation block must carry only its own slice, not the full paragraph",
      );
    }
  }

  /* Total rendered dialogue must not exceed the source text. */
  const total = dialogueBlocks.reduce(
    (sum, block) => sum + (block.html != null ? block.html.length : block.paragraph.html.length),
    0,
  );
  assert.ok(
    total <= sourceChars * 1.05,
    `dialogue must not be duplicated across pages (rendered ${total} vs ${sourceChars})`,
  );
});
