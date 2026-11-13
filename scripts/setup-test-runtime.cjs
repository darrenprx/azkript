/* Verify the pinned runtime without creating a research checkout or links. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
for (const dependency of ['electron', 'playwright-core', 'minimatch']) {
  const actual = require(`${dependency}/package.json`).version;
  if (actual !== pkg.devDependencies[dependency]) {
    throw new Error(`${dependency} ${actual} does not match the pinned version. Run npm ci.`);
  }
}
if (!fs.existsSync(require('electron'))) throw new Error('Electron was not installed. Run npm ci with install scripts enabled.');
if (fs.readFileSync(path.join(path.dirname(require('electron')), 'version'), 'utf8').trim() !== pkg.devDependencies.electron) throw new Error('The Electron binary does not match the pinned version. Run npm ci.');
console.log('Test runtime: pinned project dependencies are available.');
