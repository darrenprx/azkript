const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const model = require(path.join(__dirname, "..", "js", "model.js"));
const fdx = require(path.join(__dirname, "..", "js", "fdx.js"));

test("model sample has three scenes and named characters", () => {
  const doc = model.sampleDocument();
  const scenes = model.getScenes(doc);
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].heading, "EXT. OBSERVATORY RIDGE - NIGHT");
  const characters = model.getCharacters(doc);
  assert.ok(characters.some((item) => item.name === "MARA"));
  assert.ok(characters.some((item) => item.name === "ELIAS"));
  assert.equal(doc.paragraphs.filter((paragraph) => paragraph.dualGroup).length, 4);
  const stats = model.getStats(doc);
  assert.ok(stats.words > 100);
  assert.equal(stats.scenes, 3);
  assert.ok(stats.pages >= 1);
});

test("element flow follows screenplay conventions", () => {
  assert.equal(model.nextType("Scene Heading"), "Action");
  assert.equal(model.nextType("Character"), "Dialogue");
  assert.equal(model.nextType("Dialogue"), "Action");
  assert.equal(model.nextType("Transition"), "Scene Heading");
  assert.equal(model.tabType("Action"), "Character");
  assert.equal(model.tabType("Dialogue"), "Parenthetical");
  assert.equal(model.tabType("Character"), "Transition");
});

test("HTML runs become FDX styles without duplicating text", () => {
  const runs = fdx.htmlToRuns(
    '<strong>Hello</strong> <em>world</em><br><span style="text-decoration: underline">next</span>',
  );
  assert.equal(runs.map((run) => run.text).join(""), "Hello world\nnext");
  assert.equal(runs[0].style, "Bold");
  assert.equal(runs[1].style, "");
  assert.equal(runs[2].style, "Italic");
  assert.equal(runs[3].style, "");
  assert.equal(runs[4].style, "Underline");
});

test("serializer escapes text and includes required FDX sections", () => {
  const doc = model.normalizeDocument({
    title: "A & B <test>",
    paragraphs: [
      model.makeParagraph("Scene Heading", "INT. ROOM - DAY"),
      model.makeParagraph("Action", 'A < B & "C"'),
    ],
  });
  const xml = fdx.serialize(doc);
  assert.match(xml, /<FinalDraft DocumentType="Script" Template="No" Version="6"/);
  assert.match(xml, /<Content>/);
  assert.match(xml, /A &lt; B &amp; &quot;C&quot;/);
  assert.match(xml, /<SceneProperties Length="1\/8"/);
  assert.match(xml, /<ElementSettings Type="Dialogue">/);
  assert.match(xml, /<PageSize Height="11.00" Width="8.50"\/>/);
  assert.doesNotMatch(xml, /A < B/);
});

test("normalization keeps dual-dialogue grouping", () => {
  const doc = model.normalizeDocument({
    paragraphs: [
      Object.assign(model.makeParagraph("Character", "MARA"), {
        dualGroup: "g1",
        dualSide: 0,
      }),
      Object.assign(model.makeParagraph("Dialogue", "Left."), {
        dualGroup: "g1",
        dualSide: 0,
      }),
      Object.assign(model.makeParagraph("Character", "VOICE"), {
        dualGroup: "g1",
        dualSide: 1,
      }),
    ],
  });
  assert.equal(doc.paragraphs[0].dualGroup, "g1");
  const xml = fdx.serialize(doc);
  assert.match(xml, /<Paragraph Type="DualDialogue">/);
  assert.match(xml, /<DualDialogue>/);
});

test("validation reports duplicate ids without throwing", () => {
  const doc = model.sampleDocument();
  doc.paragraphs[1].id = doc.paragraphs[0].id;
  const issues = model.validateDocument(doc);
  assert.ok(issues.some((issue) => issue.code === "duplicate-id"));
});
