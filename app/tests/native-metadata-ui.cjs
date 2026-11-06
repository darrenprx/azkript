/* Actual user paths for native metadata edits, undo and safe error handling. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'rea/node_modules/playwright-core'));
const xml = `<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="6"><Content>
<Paragraph Type="Character" id="c3c42d80-909a-414c-8072-73f2c39165b1"><Text>MARA</Text></Paragraph>
<Paragraph Type="Dialogue" id="80a0f705-c578-4d11-9900-a267e82ae4da"><Text TagNumber="1">The lamp stays.</Text></Paragraph></Content>
<Cast><Member Character="MARA" Actor="Avery"/></Cast><Actors><Actor Name="Avery" Pitch="Normal" Speed="Medium"/></Actors>
<TagData><TagCategories><TagCategory Id="cat" Name="Props" Color="#FFFF00000000"/></TagCategories><TagDefinitions><TagDefinition Id="definition" CatId="cat" Label="Lamp"/></TagDefinitions><Tags><Tag Number="1"><DefId>definition</DefId></Tag></Tags></TagData>
<LockedPages><LockedPage PageNumber="1" Position="0" LevelIndex="0" LockLevel="0" Deleted="0"/></LockedPages>
<FutureVendorSection Keep="yes">Future metadata</FutureVendorSection></FinalDraft>`;
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('azkript.prefs.v2', JSON.stringify({ startCenter: false, smartTypeEnabled: false, reducedMotion: true })));
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.evaluate(xml => localStorage.setItem('azkript.document.v3', JSON.stringify(FDX.parse(xml))), xml);
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('is-loading'));
    const open = async () => {
      await page.waitForFunction(() => !document.querySelector('#appDialog').open && !document.querySelector('#commandDialog').open);
      await page.keyboard.press('Control+k'); await page.locator('#commandInput').fill('Edit native FDX metadata');
      await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('#appDialog').open && document.querySelector('#nativeMetadataSection'));
    };
    const savedXml = () => page.evaluate(() => FDX.serialize(JSON.parse(localStorage.getItem('azkript.document.v3'))));
    const expand = async () => {
      while (await page.locator('#nativeMetadataFields details:not([open]) > summary').count()) {
        await page.locator('#nativeMetadataFields details:not([open]) > summary').first().click();
      }
    };
    await open();
    await page.locator('#nativeMetadataSection').selectOption('Cast');
    await expand();
    const name = page.getByLabel('Character', { exact: true }); await name.fill('ELIAS');
    await page.locator('#nativeMetadataSection').selectOption('TagData');
    assert.equal(await page.locator('#nativeMetadataSection').inputValue(), 'Cast', 'section switching must not silently commit edits');
    assert.match(await page.locator('#nativeMetadataError').innerText(), /Apply your native changes/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.match(await savedXml(), /Character="MARA"/);
    await open(); await page.locator('#nativeMetadataSection').selectOption('TagData');
    await expand();
    const label = page.getByLabel('Label', { exact: true });
    await label.fill('Lantern');
    await page.getByRole('button', { name: 'Apply native changes', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await page.keyboard.press('Control+s');
    let output = await savedXml(); assert.match(output, /Label="Lantern"/); assert.match(output, /FutureVendorSection Keep="yes"/);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+s'); assert.match(await savedXml(), /Label="Lamp"/);
    await page.keyboard.press('Control+y'); await page.keyboard.press('Control+s'); assert.match(await savedXml(), /Label="Lantern"/);
    await open(); await page.locator('#nativeMetadataSection').selectOption('TagData');
    await expand();
    const remove = page.getByRole('button', { name: 'Delete Lantern', exact: true });
    await remove.click();
    assert.match(await page.locator('#nativeMetadataError').innerText(), /invalid|missing|referenc/i);
    await page.keyboard.press('Escape'); assert.match(await savedXml(), /Label="Lantern"/);
    await open(); await page.locator('#nativeMetadataSection').selectOption('Cast');
    await expand();
    const duplicate = page.getByRole('button', { name: 'Duplicate MARA', exact: true });
    await duplicate.click();
    assert.equal(await page.locator('#nativeMetadataError').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#appDialog').open);
    await page.keyboard.press('Control+s');
    output = await savedXml(); assert.match(output, /Character="MARA COPY /);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(root, 'reports/native-metadata-ui.json'), JSON.stringify({ passed: true, cases: ['cancel retains original', 'section switch refuses pending edits', 'native tag edit preserves unknown XML', 'metadata undo and redo', 'referenced-row deletion refused', 'native cast duplicate'], checkedAt: new Date().toISOString() }, null, 2));
    console.log('PASS: six native metadata UI/undo/reference-safety workflows');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
