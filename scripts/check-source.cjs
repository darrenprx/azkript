/* Checks that can run from a clean source checkout without launching the app. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { candidates } = require('./check-repository-content.cjs');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json'), lock = require('../package-lock.json');
const problems = [], files = candidates(root);
for (const file of files.filter(file => /\.(?:cjs|js)$/.test(file))) {
  if (!fs.existsSync(path.join(root, file))) continue;
  try { execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe', windowsHide: true }); }
  catch { problems.push(`${file}: JavaScript syntax check failed`); }
}
for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const match of command.matchAll(/\b(?:node|python|powershell\.exe\s+-NoProfile\s+-File)\s+([\w./-]+\.(?:cjs|js|py|ps1))\b/g)) {
    if (!fs.existsSync(path.join(root, match[1]))) problems.push(`${name}: missing entry point ${match[1]}`);
  }
}
for (const file of ['name', 'version', 'license']) if (pkg[file] !== lock.packages[''][file]) problems.push(`package-lock.json: stale ${file}`);
for (const field of ['devDependencies', 'engines']) {
  if (JSON.stringify(pkg[field]) !== JSON.stringify(lock.packages[''][field])) problems.push(`package-lock.json: stale ${field}`);
}
for (const [name, version] of Object.entries(pkg.overrides || {})) {
  // npm ci resolves version-qualified overrides; audit checks their advisories.
  if (name.includes('@') || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) continue;
  const entries = Object.entries(lock.packages).filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
  if (!entries.length || entries.some(([, value]) => value.version !== version)) problems.push(`package-lock.json: unresolved ${name} security override`);
}
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
  const relative = match[1];
  if (/^(?:\w+:|\/\/)/.test(relative) || !fs.existsSync(path.join(root, 'app', relative))) problems.push(`app/index.html: missing or remote executable/style resource ${relative}`);
}
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const match of readme.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
  if (!/^(?:\w+:|\/\/)/.test(match[1]) && !fs.existsSync(path.join(root, match[1]))) problems.push(`README.md: broken local link ${match[1]}`);
}
const pythonConfig = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
if (pkg.license === 'UNLICENSED' && !/license\s*=\s*\{\s*text\s*=\s*"UNLICENSED"\s*\}/.test(pythonConfig)) problems.push('Python and application licensing metadata disagree');
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log('PASS: source syntax, npm entry points, lock metadata, local resources and licensing metadata.');
