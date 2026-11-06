/* Extended document model and FDX writer tests. */
const assert = require("node:assert/strict");
const test = require("node:test");
const model = require("../js/model.js");
const fdx = require("../js/fdx.js");

test("normalization preserves title page, cast, revisions, and scene metadata", () => {
  const doc = model.sampleDocument();
  doc.titlePage.contact = "writer@example.test";
  doc.revision.enabled = true;
  doc.revision.current = 2;
  doc.revision.history = [
    { id: 1, name: "Blue", hex: "#2b579a", pageColor: "#c6c6ed" },
    { id: 2, name: "Pink", hex: "#c2397a", pageColor: "#fdfdcc" },
  ];
  doc.paragraphs[1].revision = 2;
  doc.paragraphs[0].scene = {
    synopsis: "Synopsis",
    notes: "Notes",
    color: "#0f6cbd",
    omit: true,
    number: "A1",
  };
  const normalized = model.normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(normalized.titlePage.contact, "writer@example.test");
  assert.equal(normalized.revision.current, 2);
  assert.equal(normalized.paragraphs[1].revision, 2);
  assert.equal(normalized.paragraphs[0].scene.number, "A1");
  assert.equal(normalized.cast.MARA.actor, "Lead");
});

test("revision progression selects the next color and marks paragraphs", () => {
  const doc = model.sampleDocument();
  assert.equal(doc.revision.enabled, false);
  const entry = model.nextRevision(doc);
  assert.equal(entry.id, 2);
  assert.equal(entry.name, "Pink");
  assert.equal(doc.revision.enabled, true);
  model.markRevision(doc, doc.paragraphs[1]);
  assert.equal(doc.paragraphs[1].revision, 2);
  assert.equal(model.revisionEntry(doc, 2).hex, entry.hex);
});

test("scene model exposes locations, order, and omitted state", () => {
  const doc = model.sampleDocument();
  const scenes = model.getScenes(doc);
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].location, "OBSERVATORY RIDGE");
  assert.equal(scenes[0].prefix, "EXT");
  assert.equal(scenes[0].timeOfDay, "NIGHT");
  assert.equal(scenes[1].startIndex, scenes[0].endIndex);
  scenes[1].paragraph.scene = { ...scenes[1].paragraph.scene, omit: true };
  const locations = model.getLocations(doc);
  assert.ok(locations.some((location) => location.name === "OBSERVATORY RIDGE"));
  assert.ok(!locations.some((location) => location.name === "CONTROL ROOM"));
});

test("template documents carry settings and a first scene", () => {
  const doc = model.templateDocument("tv");
  assert.equal(doc.title, "Untitled TV Pilot");
  assert.equal(doc.settings.targetPages, 55);
  assert.ok(doc.paragraphs.some((paragraph) => paragraph.type === "Scene Heading"));
});

test("FDX writer includes title page, scene properties, revision mode, and omit", () => {
  const doc = model.sampleDocument();
  const scene = model.getScenes(doc)[1];
  scene.paragraph.scene = {
    ...scene.paragraph.scene,
    synopsis: "A test synopsis",
    notes: "A test note",
    number: "B2",
    omit: true,
  };
  doc.revision.enabled = true;
  doc.revision.current = 2;
  doc.revision.history = [
    { id: 1, name: "Blue", hex: "#2b579a", pageColor: "#c6c6ed" },
    { id: 2, name: "Pink", hex: "#c2397a", pageColor: "#fdfdcc" },
  ];
  doc.paragraphs[1].revision = 2;
  const xml = fdx.serialize(doc);
  assert.match(xml, /<TitlePage>/);
  assert.match(xml, /Summary="A test synopsis"/);
  assert.match(xml, /Notes="A test note"/);
  assert.match(xml, /Omit="Yes"/);
  assert.match(xml, /Number="B2"/);
  assert.match(xml, /RevisionMode="Yes"/);
  assert.match(xml, /<Text RevisionID="2">/);
  assert.match(xml, /<SceneNumberOptions/);
  assert.match(xml, /<TargetScriptLength>110<\/TargetScriptLength>/);
});

test("validation catches orphan dialogue and empty documents", () => {
  const orphan = model.blankDocument();
  orphan.paragraphs = [model.makeParagraph("Dialogue", "No cue.")];
  const issues = model.validateDocument(orphan);
  assert.ok(issues.some((issue) => issue.code === "orphan-dialogue"));
  const empty = { paragraphs: [] };
  assert.ok(model.validateDocument(empty).some((issue) => issue.code === "empty-document"));
});

test("settings normalize sceneNumberSide and pageNumbers and serialize to FDX", () => {
  const doc = model.sampleDocument();
  doc.settings.sceneNumberSide = "left";
  doc.settings.pageNumbers = false;
  doc.settings.smartQuotes = false;
  const normalized = model.normalizeDocument(doc);
  assert.equal(normalized.settings.sceneNumberSide, "left");
  assert.equal(normalized.settings.pageNumbers, false);
  assert.equal(normalized.settings.smartQuotes, false);
  const xml = fdx.serialize(normalized);
  assert.match(xml, /ShowNumbersOnLeft="Yes" ShowNumbersOnRight="No"/);
  assert.match(xml, /HeaderVisible="No"/);
  assert.match(xml, /UsesSmartQuotes="No"/);
});
