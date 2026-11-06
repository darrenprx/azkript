'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sha256 = contents => crypto.createHash('sha256').update(contents).digest('hex');
const NATIVE_METADATA_SECTIONS = ['Cast', 'Actors', 'TagData', 'ListItems', 'DisplayBoards', 'LockedPages', 'Characters', 'CastList', 'CharacterHighlighting', 'Watermarking'];

function validateReferenceCase(entry, input, vendorSaved) {
  assert.ok(entry && typeof entry.name === 'string' && entry.name.trim(), 'name the reference case');
  assert.ok(typeof entry.input === 'string' && typeof entry.vendorSaved === 'string', 'record both reference files');
  if (entry.inputSha256) assert.equal(sha256(input), entry.inputSha256.toLowerCase(), `${entry.name}: input hash differs from the observed reference`);
  if (entry.vendorSavedSha256) assert.equal(sha256(vendorSaved), entry.vendorSavedSha256.toLowerCase(), `${entry.name}: vendor save hash differs from the observed reference`);
  if (entry.requirePaginationMatch || entry.requireLineParity) {
    assert.ok(Number.isInteger(entry.vendorPageCount) && entry.vendorPageCount > 0, 'pagination parity requires a positive, observed script page count');
    assert.ok(Array.isArray(entry.fonts) && entry.fonts.length && entry.fonts.every(font => typeof font === 'string' && font.trim()), 'pagination parity requires the pinned vendor font families');
    assert.ok(entry.observedAt && !Number.isNaN(Date.parse(entry.observedAt)), 'pagination parity requires the actual vendor observation date');
  }
  if (entry.requireLineParity) assert.ok(Array.isArray(entry.vendorPageLayout) && entry.vendorPageLayout.length === entry.vendorPageCount, 'line parity requires observed paragraph/line placement for each script page');
}

function assertReferenceResult(entry, result) {
  assert.equal(result.bodyRetained, true, `${entry.name}: native body changed through vendor save`);
  if (entry.requireIdentity) assert.equal(result.identityRetained, true, `${entry.name}: identity changed`);
  if (entry.requireAppState) assert.equal(result.appStateRetained, true, `${entry.name}: vendor removed app-only data`);
  if (entry.requireNativeMetadata) assert.deepEqual(result.nativeMetadataDifferences, [], `${entry.name}: native production metadata changed`);
  if (entry.requirePaginationMatch || entry.requireLineParity) {
    const pinned = new Set(entry.fonts.map(font => font.toLowerCase()));
    assert.ok((result.requestedFonts || []).every(font => pinned.has(font.toLowerCase())), `${entry.name}: pin every document/run font used for pagination`);
    assert.ok(result.fontDiagnostics.every(font => font.available === true), `${entry.name}: a pinned font is unavailable; substituted fonts cannot establish parity`);
    assert.equal(result.appScriptPageCount, entry.vendorPageCount, `${entry.name}: vendor pagination differs`);
  }
  if (entry.requireLineParity) assert.deepEqual(result.appPageLayout, entry.vendorPageLayout, `${entry.name}: page/line placement differs`);
}
module.exports = { sha256, validateReferenceCase, assertReferenceResult, NATIVE_METADATA_SECTIONS };
