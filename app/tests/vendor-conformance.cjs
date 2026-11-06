/* External-resource gate: only caller-supplied, authorized Final Draft saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateReferenceCase, assertReferenceResult, NATIVE_METADATA_SECTIONS } = require('./vendor-reference-tools.cjs');
const root = path.resolve(__dirname, '../..');
const folder = process.env.AZKRIPT_VENDOR_REFERENCE_DIR;
if (!folder) {
  console.error('PENDING: set AZKRIPT_VENDOR_REFERENCE_DIR to an authorized vendor-reference.json corpus produced with a trusted Final Draft installation. No vendor compatibility pass is claimed.');
  process.exit(2);
}
(async () => {
  const base = path.resolve(folder);
  const manifest = JSON.parse(await fs.readFile(path.join(base, 'vendor-reference.json'), 'utf8'));
  assert.equal(manifest.authorized, true, 'the reference corpus must be explicitly authorized');
  assert.ok(manifest.vendorVersion && manifest.createdBy && manifest.cases?.length >= 1, 'record trusted vendor version, operator and at least one case');
  const resolve = relative => {
    assert.equal(path.isAbsolute(relative), false, 'corpus paths must be relative');
    const target = path.resolve(base, relative);
    assert.ok(target.startsWith(base + path.sep), 'corpus paths must stay inside the authorized folder');
    return target;
  };
  const { chromium } = require(path.join(root, 'rea/node_modules/playwright-core'));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    const results = [];
    for (const entry of manifest.cases) {
      const input = await fs.readFile(resolve(entry.input), 'utf8');
      const vendorSaved = await fs.readFile(resolve(entry.vendorSaved), 'utf8');
      validateReferenceCase(entry, input, vendorSaved);
      const result = await page.evaluate(async ({ input, vendorSaved, fonts, metadataSections }) => {
        const a = FDX.parse(input), b = FDX.parse(vendorSaved);
        await document.fonts.ready;
        const requestedFonts = [...new Set(a.paragraphs.flatMap(paragraph => [FDModel.elementSpec(paragraph.type, a).font || 'Courier New',
          ...FDX.htmlToRuns(paragraph.html).map(run => run.attrs?.Font).filter(Boolean)]))];
        const measureText = FDCoreWriting.createMeasureText('Courier New', 12);
        const layout = FDPagination.layout(a, { measureText, useDocumentTypography: true, fontFamily: 'Courier New', fontSize: 12 });
        const appPageLayout = layout.pages.filter(p => p.kind === 'script').map(p => {
          const rows = [];
          const add = (block, column) => {
            if (block.kind === 'dual') { (block.columns || []).forEach((c, i) => c.blocks.forEach(child => add(child, i))); return; }
            if (!block.paragraph) return;
            rows.push({ paragraphIndex: a.paragraphs.findIndex(paragraph => paragraph.id === block.paragraph.id),
              type: block.type, ...(column !== undefined ? { column } : {}), lines: (block.lines || []).map(line => line.text) });
          };
          p.blocks.forEach(block => add(block)); return rows;
        });
        const canonical = node => node.nodeType === 1 ? [node.nodeName,
          [...node.attributes].map(attr => [attr.name, attr.value]).sort((x, y) => x[0].localeCompare(y[0])),
          [...node.childNodes].filter(child => child.nodeType === 1 || (child.nodeType === 3 && child.textContent.trim())).map(canonical)] : node.textContent;
        const treeA = new DOMParser().parseFromString(input, 'application/xml'), treeB = new DOMParser().parseFromString(vendorSaved, 'application/xml');
        const nativeMetadataDifferences = metadataSections.filter(name => {
          const nodes = tree => [...tree.documentElement.children].filter(node => node.nodeName === name).map(canonical);
          return JSON.stringify(nodes(treeA)) !== JSON.stringify(nodes(treeB));
        });
        const body = doc => doc.paragraphs.map(p => ({ type: p.type, text: FDModel.paragraphText(p) }));
        return { bodyRetained: JSON.stringify(body(a)) === JSON.stringify(body(b)),
          identityRetained: a.documentId === b.documentId, appStateRetained: b.meta.azkriptData,
          appScriptPageCount: layout.scriptPageCount, appPageLayout, nativeMetadataDifferences,
          requestedFonts, fontDiagnostics: [...new Set([...fonts, ...requestedFonts])].map(font => FDCoreWriting.typography(font, 12)) };
      }, { input, vendorSaved, fonts: entry.fonts || [], metadataSections: NATIVE_METADATA_SECTIONS });
      results.push({ name: entry.name, vendorPageCount: entry.vendorPageCount ?? null, ...result });
      assertReferenceResult(entry, result);
    }
    await fs.writeFile(path.join(base, 'azkript-gate-result.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), vendorVersion: manifest.vendorVersion, createdBy: manifest.createdBy, results,
      scope: 'Supplied native FDX re-save references; this script does not launch or authenticate the vendor application.',
    }, null, 2));
    console.log(`PASS: ${results.length} authorized vendor-reference comparisons`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
