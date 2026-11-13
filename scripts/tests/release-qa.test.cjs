'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceipt } = require('../release-qa.cjs');

function evidence() {
  const artifacts = [{ file: 'Azkript-1.2.0-portable.exe', sha256: 'portable' }, { file: 'Azkript-Setup-1.2.0.exe', sha256: 'installer' }];
  return {
    head: 'commit', dirty: false,
    release: { version: '1.2.0', sourceCommit: 'commit', sourceDirty: false, artifacts, sourceTreeSHA256: 'source',
      payloads: { appArchiveSHA256: 'archive', executableSHA256: 'executable' }, dependencies: {} },
    lifecycle: { passed: true, operatingSystemIsolation: true, actualInstallerExecuted: true, sameVersionReinstall: true, missingDefaultsPreserved: true, artifacts: structuredClone(artifacts), checks: ['test'] },
    portable: { passed: true, actualPortableExecuted: true, sha256: 'portable' },
    payloads: { artifacts: artifacts.map(item => ({ ...item, payloads: { 'resources/app.asar': { sha256: 'archive' }, 'Azkript.exe': { sha256: 'executable' } } })) },
    unitLog: '# tests 164\n# pass 164\n# fail 0\n# cancelled 0\n',
    pythonLog: 'Ran 12 tests in 0.1s\n\nOK (skipped=2)\n', audit: { metadata: { vulnerabilities: { total: 0 } } },
    pythonAudit: { dependencies: [{ name: 'Pillow', version: '13.0.0', vulns: [] }] }, pythonPins: { pillow: '13.0.0' },
    packaged: Object.fromEntries(['security', 'production', 'story', 'workspace'].map(name => [name, { passed: true }])),
    signatures: [{ file: 'win-unpacked/Azkript.exe', status: 'NotSigned' }, ...artifacts.map(item => ({ file: item.file, status: 'NotSigned' }))],
  };
}

test('release QA keeps automated installer acceptance separate from physical and signed acceptance', () => {
  const result = createReceipt(evidence());
  assert.equal(result.sourceDirty, false);
  assert.equal(result.automated.pythonSkipped, 2);
  assert.equal(result.automated.installerLifecycle.sameVersionReinstall, true);
  assert.ok(result.manualNotClaimed.some(item => /Physical IME/.test(item)));
  assert.ok(result.manualNotClaimed.some(item => /signed cross-version/.test(item)));
  assert.ok(!JSON.stringify(result).includes('executablePath'));
});

test('release QA rejects stale, incomplete and duplicate artifact evidence', () => {
  for (const change of [
    item => { item.lifecycle.artifacts[0].sha256 = 'old'; },
    item => { item.payloads.artifacts.pop(); },
    item => { item.lifecycle.artifacts[1] = item.lifecycle.artifacts[0]; },
    item => { item.portable.sha256 = 'old'; },
    item => { item.payloads.artifacts[0].payloads['Azkript.exe'].sha256 = 'old'; },
  ]) {
    const item = evidence(); change(item); assert.throws(() => createReceipt(item));
  }
});

test('release QA rejects dirty source, missing installer execution and failed suites', () => {
  for (const change of [
    item => { item.release.sourceCommit = 'old'; },
    item => { item.release.sourceDirty = true; },
    item => { item.dirty = true; },
    item => { item.lifecycle.actualInstallerExecuted = false; },
    item => { item.lifecycle.operatingSystemIsolation = false; },
    item => { item.lifecycle.sameVersionReinstall = false; },
    item => { item.lifecycle.missingDefaultsPreserved = false; },
    item => { item.unitLog = '# tests 164\n# pass 163\n# fail 1\n# cancelled 0\n'; },
    item => { item.pythonLog = 'Ran 12 tests in 0.1s\nFAILED (errors=1)\n'; },
    item => { item.packaged.security.passed = false; },
    item => { item.audit.metadata.vulnerabilities.total = 1; },
    item => { item.pythonAudit.dependencies[0].vulns = [{ id: 'PYSEC-test' }]; },
    item => { item.pythonAudit.dependencies[0].version = 'old'; },
    item => { item.signatures[0].status = 'HashMismatch'; },
  ]) {
    const item = evidence(); change(item); assert.throws(() => createReceipt(item));
  }
});
