/* Keep existing test entry points usable without the optional REA checkout. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.dirname(require.resolve('playwright-core/package.json'));
const legacy = path.join(root, 'rea/node_modules/playwright-core');
if (fs.existsSync(legacy)) {
  console.log('Test runtime: existing Playwright compatibility path retained.');
} else {
  // Never replace a user-managed checkout or a broken pre-existing link.
  if (fs.existsSync(path.dirname(legacy))) {
    try {
      fs.lstatSync(legacy);
      throw new Error('Existing broken Playwright link: remove or repair it before installing.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.symlinkSync(source, legacy, process.platform === 'win32' ? 'junction' : 'dir');
  console.log('Test runtime: legacy test path linked to the pinned project dependency.');
}
