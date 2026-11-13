'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspect, audit } = require('../check-repository-content.cjs');
test('publication guard rejects private material, credentials and machine paths without echoing secrets', () => {
  for (const file of ['docs/plan.md', 'rea/tool.js', '.env', 'key.pfx', 'sub/credentials.json']) assert.match(inspect(file, Buffer.from('')), /path/);
  assert.equal(inspect('.env.example', Buffer.from('EXAMPLE=value')), null);
  const secret = 'ghp_' + 'a'.repeat(40);
  const issue = inspect('source.js', Buffer.from('first line\n' + secret));
  assert.match(issue, /line 2/); assert.equal(issue.includes(secret), false);
  assert.ok(inspect('sample.txt', Buffer.from('C:' + '\\Users\\' + 'someone\\draft.fdx')));
  assert.ok(inspect('sample.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(secret, 'utf16le')])));
});
test('publication guard checks untracked, staged and historical content even after working-file redaction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azkript-content-'));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
  try {
    git(['init', '--quiet']);
    fs.writeFileSync(path.join(root, 'new.js'), 'ghp_' + 'b'.repeat(40));
    assert.ok(audit(root).problems.some(problem => problem.startsWith('new.js:')));
    git(['add', 'new.js']);
    fs.writeFileSync(path.join(root, 'new.js'), 'redacted');
    assert.ok(audit(root).problems.some(problem => problem.startsWith('index:new.js:')));
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    git(['add', 'new.js']);
    assert.ok(audit(root, { history: true }).problems.some(problem => problem.startsWith('history:')));
    assert.equal(audit(root).problems.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
