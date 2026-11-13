/* Inspect working files, staged blobs and optionally every locally reachable commit. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const forbidden = [
  /^(?:docs|official|rea|reports|dist|node_modules|plans|notes|private|\.agents|\.codex)\//i,
  /^app\/(?:README\.md|brand\/preview\/|tests\/fixtures\/VENDOR-CONFORMANCE\.md)/i,
  /(?:^|\/)(?:AGENTS\.md|MEMORY\.md|\.env(?:\..*)?|credentials[^/]*\.json|id_rsa|id_ed25519)$/i,
  /\.(?:pem|key|pfx|p12)$/i,
  /^scripts\/(?:ge76-.*\.ps1|invoke-ge76-.*\.ps1|test-packages-on-ge76\.ps1|write-(?:release-followup-report|distribution-qa)\.cjs|fetch-official\.ps1|generate-baseline\.ps1|(?:dump|extract)-ref-icons\.py|extract-letter\.py)$/i,
];
const contentRules = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /[A-Z]:[\\/]{1,2}Users[\\/]{1,2}(?!Public\b|Default\b)[^\\/\s"'<>]+/i,
  /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
];
function inspect(file, bytes) {
  if (file !== '.env.example' && forbidden.some(rule => rule.test(file))) return 'local-only or credential path';
  const value = bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? bytes.toString('utf16le') : bytes.toString('utf8');
  for (const rule of contentRules) {
    const match = rule.exec(value);
    if (match) return `credential signature or machine-specific path/address at line ${value.slice(0, match.index).split('\n').length}`;
  }
  return null;
}
function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
}
function candidates(root) {
  return [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
}
function readBlobs(root, hashes) {
  const unique = [...new Set(hashes)];
  if (!unique.length) return new Map();
  const output = git(root, ['cat-file', '--batch'], { encoding: null, input: unique.join('\n') + '\n' });
  const values = new Map();
  let offset = 0;
  for (const hash of unique) {
    const end = output.indexOf(10, offset), header = output.subarray(offset, end).toString('ascii').split(' ');
    if (header[1] !== 'blob') throw new Error(`Cannot inspect Git blob ${hash}.`);
    const size = Number(header[2]);
    values.set(hash, output.subarray(end + 1, end + 1 + size));
    offset = end + size + 2;
  }
  return values;
}
function audit(root, { history = false } = {}) {
  const files = candidates(root), problems = [], entries = [];
  const record = (label, file, bytes) => { const issue = inspect(file, bytes); if (issue) problems.push(`${label}: ${issue}`); };
  for (const file of files) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue; // A deletion can still exist in the index.
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) { problems.push(`${file}: links and non-regular files need review`); continue; }
    record(file, file, fs.readFileSync(target));
  }
  for (const entry of git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const [metadata, file] = entry.split('\t'), [mode, hash, stage] = metadata.split(' ');
    if (stage !== '0' || mode === '120000' || mode === '160000') problems.push(`index:${file}: unresolved merge, link or submodule`);
    else entries.push({ label: `index:${file}`, file, hash });
  }
  const commits = history ? git(root, ['rev-list', '--all']).trim().split('\n').filter(Boolean) : [];
  for (const commit of commits) for (const entry of git(root, ['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean)) {
    const [metadata, file] = entry.split('\t'), [mode, type, hash] = metadata.split(' ');
    const label = `history:${commit.slice(0, 8)}:${file}`;
    if (mode === '120000' || type !== 'blob') problems.push(`${label}: link or submodule needs review`);
    else entries.push({ label, file, hash });
  }
  const blobs = readBlobs(root, entries.map(entry => entry.hash));
  for (const entry of entries) record(entry.label, entry.file, blobs.get(entry.hash));
  return { files: files.length, commits: commits.length, problems: [...new Set(problems)] };
}
if (require.main === module) {
  try {
    const result = audit(path.resolve(__dirname, '..'), { history: process.argv.includes('--history') });
    if (result.problems.length) {
      console.error('FAIL: review repository content before publishing:\n' + result.problems.map(item => '  ' + item).join('\n'));
      process.exitCode = 1;
    } else console.log(`PASS: ${result.files} tracked/new files, staged content and ${result.commits} reachable commits satisfy publication boundaries.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { inspect, candidates, audit };
