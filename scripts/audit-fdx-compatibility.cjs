/* File-format interoperability checks. Does not launch Final Draft. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
const out = path.join(root, 'reports/fdx-compatibility-2026-11-05');
const templates = process.env.FDX_TEMPLATE_DIR || 'C:/Program Files (x86)/Final Draft 13/Templates';
async function walk(folder) {
  const files = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (/\.fdxt?$/i.test(entry.name)) files.push(file);
  }
  return files.sort();
}
(async () => {
  await fs.mkdir(path.join(out, 'exports'), { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.waitForFunction(() => !!window.FDX);
    const rows = [];
    const files = [...await walk(templates), path.join(root, 'examples/sample.fdx')];
    for (const [index, file] of files.entries()) {
      const xml = await fs.readFile(file, 'utf8');
      const result = await page.evaluate(xml => {
        const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');
        const source = parseXml(xml).documentElement;
        const direct = (node, name) => Array.from(node?.children || []).filter(e => e.tagName === name);
        const body = node => direct(node, 'Content').flatMap(content => direct(content, 'Paragraph').flatMap(p =>
          p.getAttribute('Type') === 'DualDialogue' ? direct(p, 'DualDialogue').flatMap(d => direct(d, 'Paragraph')) : [p]));
        const sourceBody = body(source);
        const imported = FDX.parse(xml);
        const exported = FDX.serialize(imported, { template: /yes/i.test(source.getAttribute('Template')) });
        const target = parseXml(exported).documentElement;
        const exportedBody = body(target);
        const text = p => direct(p, 'Text').map(t => t.textContent).join('');
        const nonempty = list => list.map(text).filter(Boolean);
        const attrs = node => Object.fromEntries(Array.from(node?.attributes || []).map(a => [a.name, a.value]));
        const sourceSettings = direct(source, 'ElementSettings');
        const targetSettings = direct(target, 'ElementSettings');
        const changedGeometry = sourceSettings.filter(s => {
          const other = targetSettings.find(t => t.getAttribute('Type') === s.getAttribute('Type'));
          if (!other) return true;
          const a = attrs(direct(s, 'ParagraphSpec')[0]), b = attrs(direct(other, 'ParagraphSpec')[0]);
          return Object.keys(a).some(k => k in b && a[k] !== b[k] &&
            !(Number.isFinite(Number(a[k])) && Number(a[k]) === Number(b[k])));
        }).map(s => s.getAttribute('Type'));
        const stripped = parseXml(exported);
        stripped.querySelector('AzkriptData')?.remove();
        const native = FDX.parse(new XMLSerializer().serializeToString(stripped));
        const nativeBodyStable = imported.paragraphs.map(p => FDModel.paragraphText(p)).join('\n') ===
          native.paragraphs.map(p => FDModel.paragraphText(p)).join('\n');
        return {
          exported, inputParagraphs: sourceBody.length, outputParagraphs: exportedBody.length,
          sourceText: nonempty(sourceBody), outputText: nonempty(exportedBody), nativeBodyStable,
          unknownBodyTypes: [...new Set(sourceBody.map(p => p.getAttribute('Type')).filter(t => t && !FDModel.ELEMENTS[t] && !imported.elements?.[t]))],
          changedElementGeometry: changedGeometry,
          droppedSections: [...new Set(Array.from(source.children).map(e => e.tagName))].filter(name => !direct(target, name).length),
          revisionSetsBefore: source.querySelectorAll(':scope > Revisions > Revision').length,
          revisionSetsAfter: target.querySelectorAll(':scope > Revisions > Revision').length,
          dynamicLabels: sourceBody.flatMap(p => direct(p, 'DynamicLabel')).length,
          warnings: imported.warnings,
        };
      }, xml);
      const { exported, sourceText, outputText, ...metrics } = result;
      const fileName = `${String(index + 1).padStart(2, '0')}-${path.basename(file).replace(/\.fdxt?$/i, '')}.fdx`;
      await fs.writeFile(path.join(out, 'exports', fileName), exported);
      rows.push({ source: path.relative(templates, file), exportedFile: fileName,
        bodyTextPreserved: JSON.stringify(sourceText) === JSON.stringify(outputText), ...metrics });
    }
    const fixture = await page.evaluate(() => {
      const doc = FDModel.sampleDocument();
      doc.title = 'Interoperability — 兼容性 😀';
      doc.page = { ...doc.page, width: 8.27, height: 11.69 };
      doc.paragraphs[1].html = '<strong>Bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> &amp; 中文 😀';
      Object.assign(doc.paragraphs[1], { note: 'A native note.', alignment: 'center', spacing: '1.5', spaceBefore: 6, leading: 'Tight', pageBreakBefore: true, revision: 13 });
      doc.paragraphs[0].scene.number = '12A';
      doc.revision = { enabled: true, current: 13, history: Array.from({ length: 19 }, (_, i) => ({
        id: i + 1, name: `Pass ${i + 1}`, hex: '#123456', pageColor: '#abcdef', createdAt: '',
      })) };
      doc.watermark = { enabled: true, text: 'PRIVATE', opacity: 14, angle: -35 };
      doc.headerFooter = { headerText: 'CUSTOM HEADER', footerText: 'CUSTOM FOOTER', showHeader: true, showFooter: true, showOnFirstPage: true, startingPage: 1 };
      const xml = FDX.serialize(doc);
      const tree = new DOMParser().parseFromString(xml, 'application/xml');
      tree.querySelector('AzkriptData').remove();
      const nativeXml = new XMLSerializer().serializeToString(tree);
      const native = FDX.parse(nativeXml);
      const app = FDX.parse(xml);
      const p = native.paragraphs[1];
      return { xml, nativeXml, checks: {
        textAndUnicode: doc.paragraphs.map(FDModel.paragraphText).join('\n') === native.paragraphs.map(FDModel.paragraphText).join('\n'),
        elementTypes: JSON.stringify(doc.paragraphs.map(p => p.type)) === JSON.stringify(native.paragraphs.map(p => p.type)),
        basicRunStyles: JSON.stringify(FDX.htmlToRuns(doc.paragraphs[1].html).map(({text,style}) => ({text,style}))) === JSON.stringify(FDX.htmlToRuns(p.html).map(({text,style}) => ({text,style}))),
        dualDialogue: native.paragraphs.filter(p => p.dualGroup).length === doc.paragraphs.filter(p => p.dualGroup).length,
        nativeNote: p.note === 'A native note.',
        paragraphFormatting: p.alignment === 'center' && p.spacing === '1.5' && p.spaceBefore === 6 && p.leading === 'Tight' && p.pageBreakBefore,
        revisionId: p.revision === 13, extendedRevisionPalette: native.revision.history.length === 19,
        sceneNumber: native.paragraphs[0].scene.number === '12A',
        a4PageSize: native.page.width === 8.27 && native.page.height === 11.69,
        appWatermarkRoundtrip: app.watermark.text === 'PRIVATE',
      }, unsupportedNative: {
        watermarkRetained: native.watermark.enabled === true && native.watermark.text === 'PRIVATE',
        customHeaderRetained: JSON.stringify(native.headerFooter).includes('CUSTOM HEADER'),
        customRevisionInkRetained: native.revision.history[12].hex === '#123456',
      } };
    });
    await fs.writeFile(path.join(out, 'feature-fixture.fdx'), fixture.xml);
    await fs.writeFile(path.join(out, 'feature-fixture-native-only.fdx'), fixture.nativeXml);
    const { xml, nativeXml, ...featureResults } = fixture;
    const summary = { generatedAt: new Date().toISOString(), actualFinalDraftApplicationTested: false,
      templateCount: files.length - 1, sampleCount: 1, parsed: rows.length,
      textChanged: rows.filter(r => !r.bodyTextPreserved).map(r => r.source),
      geometryChanged: rows.filter(r => r.changedElementGeometry.length).length,
      unknownTypes: rows.filter(r => r.unknownBodyTypes.length).length,
      nativeBodyStable: rows.filter(r => r.nativeBodyStable).length,
      featureResults, files: rows };
    await fs.writeFile(path.join(out, 'audit.json'), JSON.stringify(summary, null, 2));
    assert.equal(summary.parsed, 55, 'the installed-template corpus must not silently shrink');
    assert.ok(rows.every(r => r.nativeBodyStable), 'body must survive native-only FDX re-import');
    assert.deepEqual(Object.entries(featureResults.checks).filter(([, ok]) => !ok), []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ parsed: summary.parsed, templateCount: summary.templateCount,
      textChanged: summary.textChanged.length, geometryChanged: summary.geometryChanged, unknownTypes: summary.unknownTypes,
      nativeBodyStable: summary.nativeBodyStable, featureResults }, null, 2));
    console.log('PASS: file-format checks completed; limitations are recorded in audit.json');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
