'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimeFiles } = require('../lib/release-files.cjs');
test('legacy packager globs work alongside the patched matcher', () => {
  const root = path.resolve(__dirname, '../..');
  assert.ok(require('glob').sync('app/**/*.html', { cwd: root, nodir: true }).includes('app/index.html'));
});
test('release inventory follows packaging rules and automatically includes new runtime files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azkript-inventory-'));
  try {
    fs.mkdirSync(path.join(root, 'app/tests'), { recursive: true });
    fs.mkdirSync(path.join(root, 'desktop/tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ build: { files: ['app/**/*', '!app/tests/**/*', 'desktop/**/*', '!desktop/tests/**/*', 'README.md', 'package.json'] } }));
    for (const file of ['app/new-module.js', 'app/tests/private-test.cjs', 'desktop/security.js', 'desktop/tests/test.cjs', 'README.md']) fs.writeFileSync(path.join(root, file), 'fixture');
    assert.deepEqual(runtimeFiles(root), ['README.md', 'app/new-module.js', 'desktop/security.js']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
