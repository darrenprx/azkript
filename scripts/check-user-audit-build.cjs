/* Prove the review build contains the current application sources. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'reports/bug-audit/build/win-unpacked');
const archive = path.join(folder, 'resources/app.asar');
const files = ['app/index.html', 'app/styles.css', 'app/styles-desktop.css',
  'app/styles-ribbon.css', 'app/js/app.js', 'app/js/fdx.js', 'app/js/model.js', 'app/js/pagination.js',
  'desktop/main.js', 'desktop/preload.js', 'desktop/menu.js', 'desktop/profile-migration.js'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = files.map(file => {
  const current = fs.readFileSync(path.join(root, file));
  const packed = asar.extractFile(archive, path.normalize(file));
  assert.ok(packed.equals(current), `stale packaged file: ${file}`);
  return { file, sha256: hash(current) };
});
// electron-builder deliberately removes development scripts/build config.
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
for (const field of ['name', 'productName', 'version', 'description', 'main', 'author', 'license']) {
  assert.equal(packagedManifest[field], sourceManifest[field], `stale package metadata: ${field}`);
}
fs.writeFileSync(path.join(root, 'reports/bug-audit/build-verification.json'), JSON.stringify({
  verifiedAt: new Date().toISOString(), files: checks, packagedManifest,
  executableSha256: hash(fs.readFileSync(path.join(folder, 'Azkript.exe'))),
}, null, 2));
console.log(`PASS: ${checks.length} packaged application files match current sources byte for byte; package metadata matches`);
