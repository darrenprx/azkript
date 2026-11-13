/* Derive freshness checks from the same inclusion rules used by the packager. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { minimatch } = require('minimatch');
function runtimeFiles(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const patterns = pkg.build.files;
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string')) throw new Error('Review runtime file inventory for the new build.files format.');
  const include = patterns.filter(pattern => !pattern.startsWith('!'));
  const exclude = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
  const files = [];
  const walk = folder => {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const relative = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Runtime files cannot contain links: ${relative}`);
      if (entry.isDirectory()) walk(relative);
      else if (include.some(pattern => minimatch(relative, pattern, { dot: true })) &&
        !exclude.some(pattern => minimatch(relative, pattern, { dot: true }))) files.push(relative);
    }
  };
  walk('app'); walk('desktop');
  for (const pattern of include) if (!/[?*{}[\]]/.test(pattern) && pattern !== 'package.json') files.push(pattern);
  return [...new Set(files)].sort();
}
module.exports = { runtimeFiles };
