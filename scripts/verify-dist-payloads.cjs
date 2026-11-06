/* Read both distribution wrappers without running an installer or portable app. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getPath7za } = require('../node_modules/app-builder-lib/out/toolsets/7zip.js');
const root = path.resolve(__dirname, '..');
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function memberHash(tool, archive, member) {
  const child = spawn(tool, ['e', '-so', archive, member], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = crypto.createHash('sha256');
  let size = 0, stderr = '';
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`7-Zip exit ${code}: ${stderr}`)));
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  for await (const bytes of child.stdout) { hash.update(bytes); size += bytes.length; }
  await done;
  assert.ok(size > 0, `missing archive member: ${member}`);
  return { size, sha256: hash.digest('hex') };
}
(async () => {
  const tool = await getPath7za();
  const version = require('../package.json').version;
  const members = ['resources/app.asar', 'Azkript.exe'];
  const expected = Object.fromEntries(await Promise.all(members.map(async member => [member,
    await fileHash(path.join(root, 'dist/win-unpacked', member))])));
  const artifacts = [];
  for (const name of [`Azkript-${version}-portable.exe`, `Azkript-Setup-${version}.exe`]) {
    const file = path.join(root, 'dist', name);
    const payloads = {};
    for (const member of members) {
      const result = await memberHash(tool, file, path.normalize(member));
      assert.equal(result.sha256, expected[member], `${name}: stale ${member}`);
      payloads[member] = result;
    }
    artifacts.push({ file: name, size: (await fsp.stat(file)).size, sha256: await fileHash(file), payloads });
    console.log(`PASS: ${name} embeds the verified app archive and executable`);
  }
  await fsp.writeFile(path.join(root, 'reports/dist-artifact-verification.json'), JSON.stringify({
    verifiedAt: new Date().toISOString(), installerExecuted: false, artifacts,
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
