/* Real worker timing/cancellation, canvas metrics, selection and long-script tests. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/app/index.html');
    if (!await page.evaluate(() => !!window.FDCoreWriting)) await page.addScriptTag({ url: origin + '/app/js/core-writing.js' });
    const search = await page.evaluate(async () => {
      const client = FDCoreWriting.createRegexClient(new URL('js/search-worker.js', location.href), { timeoutMs: 200 });
      try {
        const normal = await client.search([{ id: 'p', text: '😀 Alpha Alpha', type: 'Action' }], { pattern: '(?<word>Alpha)' });
        let heartbeat = 0; const tick = setInterval(() => heartbeat++, 10);
        let timeout, cancelled, invalid;
        try { await client.search([{ id: 'p', text: 'a'.repeat(35) + '!' }], { pattern: '(a+)+$' }); } catch (error) { timeout = error.code; }
        const alive = heartbeat; clearInterval(tick);
        const after = await client.search([{ id: 'p', text: 'alive' }], { pattern: 'alive' });
        const request = client.search([{ id: 'p', text: 'a'.repeat(35) + '!' }], { pattern: '(a+)+$' });
        setTimeout(() => client.cancel(), 20);
        try { await request; } catch (error) { cancelled = error.code; }
        try { await client.search([{ id: 'p', text: 'x' }], { pattern: '[' }); } catch (error) { invalid = error.code; }
        const capped = await client.search([{ id: 'p', text: 'x '.repeat(20) }], { pattern: 'x', maxMatches: 3 });
        const unicode = await client.search([{ id: 'p', text: '😀x' }], { pattern: '(?=.)|x' });
        return { normal, timeout, alive, after, cancelled, invalid, capped, unicode };
      } finally { client.dispose(); }
    });
    assert.equal(search.normal.matches[0].start, 3);
    assert.equal(search.normal.matches[0].groups.word, 'Alpha');
    assert.deepEqual(search.normal.matches[0].captures, ['Alpha', 'Alpha']);
    assert.equal(search.timeout, 'SEARCH_TIMEOUT'); assert.ok(search.alive >= 5, 'the renderer must keep ticking during a catastrophic search');
    assert.equal(search.after.matches.length, 1); assert.equal(search.cancelled, 'SEARCH_CANCELLED'); assert.equal(search.invalid, 'REGEX_INVALID');
    assert.equal(search.capped.matches.length, 3); assert.equal(search.capped.truncated, true); assert.equal(search.unicode.matches.length, 0);

    const metrics = await page.evaluate(() => ({
      installed: FDCoreWriting.typography('Courier New'), missing: FDCoreWriting.typography('Azkript Definitely Missing Font 93848'),
      wide: FDCoreWriting.createMeasureText('Arial')('WWWW'), narrow: FDCoreWriting.createMeasureText('Arial')('iiii'),
    }));
    assert.equal(metrics.installed.available, true); assert.equal(metrics.missing.available, false); assert.ok(metrics.wide > metrics.narrow * 2);

    const selection = await page.evaluate(() => {
      const editor = document.createElement('div'); editor.id = 'selectionFixture';
      editor.innerHTML = '<div class="para" data-id="a" contenteditable="true"><strong>A😀</strong><br>שלום</div><div class="para" data-id="b" contenteditable="true">مرحبا world</div>';
      document.body.appendChild(editor);
      const a = editor.children[0], b = editor.children[1], sel = window.getSelection();
      sel.setBaseAndExtent(b.firstChild, 5, a.lastChild, 2);
      const captured = FDCoreWriting.captureSelection(editor);
      sel.removeAllRanges(); const restored = FDCoreWriting.restoreSelection(editor, captured);
      return { captured, restored, again: FDCoreWriting.captureSelection(editor) };
    });
    assert.equal(selection.captured.end.offset, 6, 'BR contributes a plaintext newline');
    assert.equal(selection.restored, true); assert.deepEqual(selection.again, selection.captured);

    const long = await page.evaluate(async () => {
      const doc = FDModel.blankDocument(); doc.titlePage.enabled = false;
      doc.paragraphs = Array.from({ length: 2400 }, (_, i) => FDModel.makeParagraph('Action', `Block ${i}: ${'screenplay '.repeat(20)}`));
      const client = FDCoreWriting.createPaginationClient(new URL('js/pagination-worker.js', location.href));
      let heartbeat = 0; const timer = setInterval(() => heartbeat++, 5);
      const start = performance.now();
      try {
        const worker = await client.layout(doc, { measuredTypography: false });
        const elapsed = performance.now() - start;
        return { pages: worker.scriptPageCount, blocks: worker.pages.flatMap(p => p.blocks).length, elapsed, heartbeat };
      } finally { clearInterval(timer); client.dispose(); }
    });
    assert.ok(long.pages >= 150 && long.pages <= 300); assert.ok(long.blocks >= 2400); assert.ok(long.heartbeat > 0);

    // Test the same browser file-entry path users open without a web server.
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    if (!await page.evaluate(() => !!window.FDCoreWriting)) await page.addScriptTag({ url: pathToFileURL(path.join(root, 'app/js/core-writing.js')).href });
    const fileSearch = await page.evaluate(async () => {
      const client = FDCoreWriting.createRegexClient(new URL('js/search-worker.js', location.href));
      try { return await client.search([{ id: 'p', text: 'file worker works' }], { pattern: 'works' }); } finally { client.dispose(); }
    });
    assert.equal(fileSearch.matches[0].text, 'works');
    if (!await page.evaluate(() => typeof window.FDPaginationWorkerSource === 'string')) {
      await page.addScriptTag({ url: pathToFileURL(path.join(root, 'app/js/pagination-worker-source.js')).href });
    }
    const fileLayout = await page.evaluate(async () => {
      const doc = FDModel.sampleDocument(); doc.sourceFDX = { xml: 'x'.repeat(5000000) };
      const client = FDCoreWriting.createPaginationClient(new URL('js/pagination-worker.js', location.href), { source: FDPaginationWorkerSource });
      try {
        const result = await client.layout(doc, { measuredTypography: true });
        return { pages: result.scriptPageCount, normalizedReturned: 'normalized' in result, blocks: result.pages.flatMap(p => p.blocks).length };
      } finally { client.dispose(); }
    });
    assert.ok(fileLayout.pages > 0); assert.equal(fileLayout.normalizedReturned, false); assert.ok(fileLayout.blocks > 0);
    await fs.writeFile(path.join(root, 'reports/core-writing-browser.json'), JSON.stringify({ search: { timeout: search.timeout, heartbeat: search.alive, cancellation: search.cancelled }, metrics, long, fileLayout }, null, 2));
    console.log(`PASS: actual workers time out/cancel/recover, renderer stays live, font substitution detected, RTL/BR selection restored, ${long.pages}-page background layout in ${long.elapsed.toFixed(1)}ms`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
