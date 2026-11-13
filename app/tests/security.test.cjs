'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model'), X = require('../js/fdx');
const T = require('../js/story-tools');
test('imported document HTML keeps rich text while removing active content, file loads and UI overlays', () => {
  const doc = M.normalizeDocument({ paragraphs: [{ type: 'Action', html: '<strong>Visible</strong><br><span style="color:#112233;position:fixed;background-image:url(file:///secret)">text</span><img src="file:///secret" onerror="alert(1)"><iframe src="file:///secret"></iframe><base href="file:///"><form><input autofocus></form><span id="appShell" onclick="alert(1)">safe</span>' }] });
  const html = doc.paragraphs[0].html;
  assert.match(html, /<strong>Visible<\/strong><br>/);
  assert.match(html, /style="color:#112233"/);
  assert.doesNotMatch(html, /img|iframe|base|form|input|onclick|position|background-image|id=/);
  assert.equal(M.normalizeDocument(doc).paragraphs[0].html, html);
  const runs = [{ text: 'A rich line', style: 'Bold+Superscript', attrs: { Font: 'Courier New', Size: '12', Color: '#111122223333', RevisionID: '2' } }];
  assert.deepEqual(X.htmlToRuns(M.sanitizeHtml(X.runsToHtml(runs))), X.htmlToRuns(X.runsToHtml(runs)));
});
test('malformed entities and recovery structures do not crash normalization', () => {
  assert.equal(M.decodeEntities('&#9999999999999999; &#xD800; &#0;'), '\ufffd \ufffd \ufffd');
  assert.equal(M.normalizeDocument({ paragraphs: {}, macros: [null] }).paragraphs.length, 1);
  const doc = M.normalizeDocument({ paragraphs: [{ trackedOriginal: '<img src=x>Original', html: '<span style="background-color:red" onmouseover="x()">Hi</span>' }] });
  assert.equal(doc.paragraphs[0].trackedOriginal, 'Original');
  assert.equal(doc.paragraphs[0].html, '<span style="background-color:red">Hi</span>');
});
test('imported story layout fields are numeric and malformed collections cannot create markup', () => {
  const data = T.data({ story: { lanes: [null, { height: '120\"><img src=x>', name: 'Main' }], timeline: [{ start: '1<svg>', end: Infinity }], arcs: [{ value: '5\"><input>' }], shots: [{ seconds: '3<iframe>' }], assets: [{ data: 42 }], facts: {} } });
  assert.equal(data.lanes.length, 1); assert.equal(data.lanes[0].height, 120);
  assert.equal(data.timeline[0].start, 1); assert.equal(data.timeline[0].end, 1);
  assert.equal(data.arcs[0].value, 0); assert.equal(data.shots[0].seconds, 3);
  assert.equal(data.assets[0].data, ''); assert.deepEqual(data.facts, []);
});
