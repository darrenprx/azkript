const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256, validateReferenceCase, assertReferenceResult, NATIVE_METADATA_SECTIONS } = require('./vendor-reference-tools.cjs');
const entry = { name: 'Observed script', input: 'in.fdx', vendorSaved: 'out.fdx', requirePaginationMatch: true, vendorPageCount: 2, fonts: ['Courier New'], observedAt: '2026-11-05T12:00:00Z' };
const result = { bodyRetained: true, fontDiagnostics: [{ family: 'Courier New', available: true }], appScriptPageCount: 2 };
test('vendor page gate rejects absent observations, font substitutions and actual page differences', () => {
  validateReferenceCase(entry, 'in', 'out');
  assert.throws(() => validateReferenceCase({ ...entry, fonts: [] }, 'in', 'out'), /pinned/);
  assert.throws(() => validateReferenceCase({ ...entry, observedAt: null }, 'in', 'out'), /observation/);
  assert.throws(() => validateReferenceCase({ ...entry, vendorPageCount: 0 }, 'in', 'out'), /positive/);
  assertReferenceResult(entry, result);
  assert.throws(() => assertReferenceResult(entry, { ...result, requestedFonts: ['Consolas'] }), /pin every/);
  assert.throws(() => assertReferenceResult(entry, { ...result, fontDiagnostics: [{ available: false }] }), /unavailable/);
  assert.throws(() => assertReferenceResult(entry, { ...result, appScriptPageCount: 3 }), /pagination differs/);
});
test('vendor gate binds saved references and checks native data and line placement independently of page count', () => {
  assert.throws(() => validateReferenceCase({ ...entry, inputSha256: sha256('different') }, 'in', 'out'), /hash differs/);
  const lineEntry = { ...entry, requireNativeMetadata: true, requireLineParity: true, vendorPageLayout: [[{ paragraphIndex: 0, type: 'Action', lines: ['A'] }], []] };
  validateReferenceCase(lineEntry, 'in', 'out');
  const matched = { ...result, nativeMetadataDifferences: [], appPageLayout: lineEntry.vendorPageLayout };
  assertReferenceResult(lineEntry, matched);
  assert.throws(() => assertReferenceResult(lineEntry, { ...matched, appPageLayout: [[], [{ paragraphIndex: 0, type: 'Action', lines: ['A'] }]] }), /line placement/);
  assert.throws(() => assertReferenceResult(lineEntry, { ...matched, nativeMetadataDifferences: ['TagData'] }), /production metadata/);
  assert.throws(() => assertReferenceResult(lineEntry, { ...matched, nativeMetadataDifferences: ['ListItems'] }), /production metadata/);
  for (const section of ['ListItems', 'CharacterHighlighting', 'Watermarking', 'Characters', 'CastList']) assert.ok(NATIVE_METADATA_SECTIONS.includes(section));
});
