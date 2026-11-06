/* Keep the publishable source tree separate from local research and operations. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = [
  /^(?:docs|official|rea|reports|dist|node_modules|plans|notes|private|\.agents|\.codex)\//i,
  /^app\/(?:README\.md|brand\/preview\/|tests\/fixtures\/VENDOR-CONFORMANCE\.md)/i,
  /(?:^|\/)(?:AGENTS\.md|MEMORY\.md|\.env(?:\..*)?|credentials[^/]*\.json)$/i,
  /^scripts\/(?:ge76-.*\.ps1|invoke-ge76-.*\.ps1|test-packages-on-ge76\.ps1|write-(?:release-followup-report|distribution-qa)\.cjs|fetch-official\.ps1|generate-baseline\.ps1|(?:dump|extract)-ref-icons\.py|extract-letter\.py)$/i,
];
const contentRules = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /[A-Z]:[\\/]{1,2}Users[\\/]{1,2}(?!Public\b|Default\b)[^\\/\s"'<>]+/i,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
];
const problems = [];
for (const file of files) {
  if (forbidden.some(rule => rule.test(file))) { problems.push(file + ': local-only path'); continue; }
  const bytes = fs.readFileSync(path.join(root, file));
  if (!bytes.includes(0) && contentRules.some(rule => rule.test(bytes.toString('utf8')))) {
    problems.push(file + ': credential signature or machine-specific path/address');
  }
}
if (problems.length) {
  console.error('FAIL: review repository content before publishing:\n' + problems.map(item => '  ' + item).join('\n'));
  process.exitCode = 1;
} else console.log(`PASS: ${files.length} tracked files satisfy repository content boundaries.`);
