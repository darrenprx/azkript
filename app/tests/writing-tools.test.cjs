const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/model.js");
const tools = require("../js/writing-tools.js");
test("version comparison reports edits, removals, additions, and metadata without quadratic diff", () => {
  const before = model.blankDocument();
  before.paragraphs = Array.from({ length: 10000 }, (_, i) => model.makeParagraph("Action", `Line ${i}`));
  const after = model.cloneDocument(before);
  for (let index = 100; index < 130; index++) after.paragraphs[index].html = "Edited";
  after.paragraphs.splice(20, 1);
  after.paragraphs.push(model.makeParagraph("Action", "New"));
  after.author = "New author";
  const result = tools.compareDocuments(before, after, 25);
  assert.equal(result.counts.changed, 30);
  assert.equal(result.counts.moved, 0);
  assert.equal(result.counts.removed, 1);
  assert.equal(result.counts.added, 1);
  assert.ok(result.metadataChanged.includes("author"));
  assert.equal(result.rows.length, 25);
  assert.equal(result.truncated, true);
});
test("version comparisons disclose native production metadata changes with unchanged body text", () => {
  const before = model.blankDocument(), after = model.cloneDocument(before);
  after.nativeMetadata = [{ name: "Cast", xml: '<Cast><Member Name="A"/></Cast>' }];
  const result = tools.compareDocuments(before, after);
  assert.equal(result.rows.length, 0);
  assert.ok(result.metadataChanged.includes("nativeMetadata"));
});
test("version comparisons detect tag and paragraph-layout edits without text edits", () => {
  const before = model.blankDocument(), after = model.cloneDocument(before);
  after.paragraphs[0].tags = [{ id: "prop", category: "props", label: "Lantern" }];
  after.paragraphs[0].pageBreakBefore = true;
  const result = tools.compareDocuments(before, after);
  assert.equal(result.counts.changed, 1);
});
