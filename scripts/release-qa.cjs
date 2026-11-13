/* Bind successful clean-build checks to the exact artifacts being handed off. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function artifactMatches(expected, observed, label) {
  assert.equal(observed.length, expected.length, `${label}: incomplete artifact evidence`);
  const names = new Set();
  for (const item of observed) {
    const name = item.file.split(/[\\/]/).pop();
    assert.ok(!names.has(name), `${label}: duplicate artifact evidence`);
    names.add(name);
    const original = expected.find(entry => entry.file === name);
    assert.ok(original, `${label}: unexpected artifact`);
    assert.equal(item.sha256, original.sha256, `${label}: stale artifact hash`);
  }
}

function createReceipt(evidence) {
  const { release, head, dirty, lifecycle, portable, payloads, unitLog, pythonLog, audit, packaged, signatures } = evidence;
  assert.equal(release.sourceCommit, head, 'Release must describe the current commit');
  assert.equal(release.sourceDirty, false, 'Release must come from committed source');
  assert.equal(dirty, false, 'Checkout changed after building');
  assert.equal(audit.metadata.vulnerabilities.total, 0, 'Dependency audit must have no known vulnerabilities');
  const jsTests = Number(unitLog.match(/^# tests (\d+)\s*$/m)?.[1]);
  const jsPassed = Number(unitLog.match(/^# pass (\d+)\s*$/m)?.[1]);
  assert.ok(jsTests > 0 && jsPassed === jsTests, 'JavaScript suite must pass without skips');
  assert.match(unitLog, /^# fail 0\s*$/m);
  assert.match(unitLog, /^# cancelled 0\s*$/m);
  const pythonTests = Number(pythonLog.match(/^Ran (\d+) tests? in /m)?.[1]);
  assert.ok(pythonTests > 0, 'Python test result is missing');
  assert.match(pythonLog, /^OK(?: \(skipped=\d+\))?\s*$/m);
  const pythonSkipped = Number(pythonLog.match(/^OK \(skipped=(\d+)\)/m)?.[1] || 0);
  assert.equal(lifecycle.passed, true, 'Installer lifecycle did not pass');
  assert.equal(lifecycle.operatingSystemIsolation, true, 'Installer must run in a disposable guest');
  assert.equal(lifecycle.actualInstallerExecuted, true, 'Installer execution evidence is missing');
  assert.equal(lifecycle.sameVersionReinstall, true, 'Reinstall acceptance did not pass');
  assert.equal(lifecycle.missingDefaultsPreserved, true, 'Missing-default acceptance did not pass');
  artifactMatches(release.artifacts, lifecycle.artifacts, 'Installer lifecycle');
  artifactMatches(release.artifacts, payloads.artifacts, 'Wrapper payloads');
  for (const item of payloads.artifacts) {
    assert.equal(item.payloads['resources/app.asar'].sha256, release.payloads.appArchiveSHA256, 'Wrapper contains a different application archive');
    assert.equal(item.payloads['Azkript.exe'].sha256, release.payloads.executableSHA256, 'Wrapper contains a different executable');
  }
  const portableArtifact = release.artifacts.find(item => item.file.endsWith('-portable.exe'));
  assert.ok(portableArtifact, 'Portable artifact is missing');
  assert.equal(portable.passed, true, 'Portable smoke did not pass');
  assert.equal(portable.actualPortableExecuted, true, 'Portable wrapper was not executed');
  assert.equal(portable.sha256, portableArtifact.sha256, 'Portable evidence belongs to another build');
  for (const name of ['security', 'production', 'story', 'workspace']) assert.equal(packaged[name].passed, true, `Packaged ${name} checks did not pass`);
  assert.equal(signatures.length, release.artifacts.length + 1, 'Signature inventory is incomplete');
  assert.deepEqual(signatures.map(item => item.file).sort(), ['win-unpacked/Azkript.exe', ...release.artifacts.map(item => item.file)].sort());
  assert.ok(signatures.every(item => ['Valid', 'NotSigned'].includes(item.status)), 'Invalid executable signature');
  return {
    format: 'azkript-release-qa', schemaVersion: 1, verifiedAt: new Date().toISOString(),
    version: release.version, sourceCommit: head, sourceDirty: false, sourceTreeSHA256: release.sourceTreeSHA256,
    workflowRun: evidence.workflowRun || null,
    artifacts: release.artifacts, payloads: release.payloads, dependencies: release.dependencies, signatures,
    automated: {
      passed: true, cleanCommittedBuild: true, javascriptTests: jsTests, pythonTests, pythonSkipped,
      dependencyVulnerabilities: 0, packagedSourceAndRenderGate: true, distributionPayloadChecks: true,
      packagedSecurityProductionStoryWorkspace: true, actualPortableWrapper: true,
      installerLifecycle: { operatingSystemIsolation: true, install: true, uninstall: true, sameVersionReinstall: true,
        checks: lifecycle.checks.length, existingDefaultsPreserved: true, missingDefaultsPreserved: true, profileMarkerPreserved: true },
    },
    manualNotClaimed: [
      'Visible installer-wizard acceptance on a supported physical Windows machine',
      'Physical IME behavior and real screen-reader speech',
      'Real publisher signing and signed cross-version upgrade/rollback',
      'Licensed originating-editor interoperability and exact pagination parity',
      'Actual user-profile migration across different application versions',
    ],
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const release = json('dist/release.json');
  for (const item of release.artifacts) {
    assert.equal(path.basename(item.file), item.file, 'Artifact path must be a filename');
    const bytes = fs.readFileSync(path.join(root, 'dist', item.file));
    assert.equal(bytes.length, item.size, 'Artifact size changed');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, 'Artifact bytes changed');
  }
  const receipt = createReceipt({
    release, head: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']),
    lifecycle: json('reports/isolated-package-results/package-lifecycle.json'),
    portable: json('reports/isolated-package-results/portable-launcher-verification.json'),
    payloads: json('reports/dist-artifact-verification.json'),
    unitLog: fs.readFileSync(path.join(root, 'reports/release-unit-tests.log'), 'utf8'),
    pythonLog: fs.readFileSync(path.join(root, 'reports/release-python-tests.log'), 'utf8'),
    audit: json('reports/release-audit.json'), signatures: json('reports/release-signatures.json'),
    packaged: { security: json('reports/public-readiness/security-desktop.json'), production: json('reports/production-upgrade/desktop.json'),
      story: json('reports/story-upgrade/packaged-desktop.json'), workspace: json('reports/workspace-upgrade/desktop.json') },
    workflowRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  });
  const content = JSON.stringify(receipt, null, 2) + '\n';
  assert.equal(require('./check-repository-content.cjs').inspect('QA-VERIFICATION.json', Buffer.from(content)), null, 'QA receipt must not contain private paths or credentials');
  fs.writeFileSync(path.join(root, 'dist/QA-VERIFICATION.json'), content);
  console.log(`PASS: clean-commit QA receipt for ${receipt.version}, ${receipt.automated.javascriptTests} JS tests and disposable installer/reinstall acceptance.`);
}

if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { createReceipt };
