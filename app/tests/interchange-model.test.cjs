const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/model.js');
const fdx = require('../js/fdx.js');

test('document identity survives renaming, normalization and serialization', () => {
  const doc = model.blankDocument(), id = doc.documentId;
  const other = model.blankDocument();
  assert.notEqual(other.documentId, id);
  doc.title = 'A renamed draft';
  const restored = model.normalizeDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(restored.documentId, id);
  assert.match(fdx.serialize(restored), new RegExp(`<DocumentRef id="${id}"`));
});

test('document element definitions and flow stay local to that document', () => {
  const doc = model.normalizeDocument({ title: 'Custom', elements: {
    Lyrics: { left: 2.25, right: 6.25, before: 6, font: 'Consolas', fontSize: 14, next: 'Lyrics', tab: 'Action' },
  }, paragraphs: [model.makeParagraph('Lyrics', 'A line')] });
  assert.equal(doc.paragraphs[0].type, 'Lyrics');
  assert.equal(model.elementSpec('Lyrics', doc).left, 2.25);
  assert.equal(model.elementSpec('Lyrics').left, model.ELEMENTS.Action.left);
  assert.equal(model.nextType('Lyrics', doc), 'Lyrics');
  assert.equal(model.tabType('Lyrics', false, doc), 'Action');
  assert.equal(model.validateDocument(doc).some(issue => issue.code === 'unknown-type'), false);
  assert.equal(model.ELEMENTS.Lyrics, undefined);
});

test('a retained source is shared while editable document fields are cloned', () => {
  const doc = model.blankDocument();
  doc.sourceFDX = Object.freeze({ xml: '<FinalDraft><Content/></FinalDraft>', paragraphs: [], sections: [] });
  const cloned = model.cloneDocument(doc);
  assert.equal(cloned.sourceFDX, doc.sourceFDX);
  cloned.paragraphs[0].html = 'changed';
  assert.notEqual(cloned.paragraphs[0].html, doc.paragraphs[0].html);
  assert.throws(() => fdx.serialize(doc), /browser XML engine/);
});

test('native run attributes remain attached through an HTML round-trip', () => {
  const runs = [{ text: 'Mixed 中文 😀', style: 'Bold+Superscript', attrs: {
    Font: 'Consolas', Size: '14.00', Color: '#94AA11150000', Background: '#FFFFDDDD2222', TagNumber: '4',
  } }];
  assert.deepEqual(fdx.htmlToRuns(fdx.runsToHtml(runs)), runs);
});

test('prototype property names cannot become element definitions', () => {
  const doc = model.normalizeDocument({ elements: JSON.parse('{"__proto__":{"left":2},"constructor":{"left":3}}'), paragraphs: [{ id: 'p', type: 'constructor', html: 'Text' }] });
  assert.equal(doc.paragraphs[0].type, 'Action');
  assert.equal(model.elementSpec('constructor', doc), model.ELEMENTS.Action);
  assert.deepEqual(Object.keys(doc.elements), []);
});
