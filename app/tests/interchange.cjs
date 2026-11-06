/* Authorized synthetic/native XML and local-template interoperability checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'rea/node_modules/playwright-core'));
async function walk(folder) {
  const all = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) all.push(...await walk(file));
    else if (/\.fdxt?$/i.test(entry.name)) all.push(file);
  }
  return all.sort();
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.waitForFunction(() => !!window.FDX);
    const fixture = await fs.readFile(path.join(__dirname, 'fixtures/interchange-native.fdx'), 'utf8');
    const result = await page.evaluate(xml => {
      const read = xml => new DOMParser().parseFromString(xml, 'application/xml');
      const serial = node => new XMLSerializer().serializeToString(node);
      const original = read(xml), doc = FDX.parse(xml);
      const spec = FDModel.elementSpec('Lyrics', doc);
      const source = doc.sourceFDX;
      const normalized = FDModel.normalizeDocument(doc), cloned = FDModel.cloneDocument(doc);
      const docId = doc.documentId;
      doc.title = 'Renamed script';
      doc.paragraphs[0].html = 'INT. LAB - DAWN';
      const output = FDX.serialize(doc), tree = read(output);
      const byId = (tree, id) => [...tree.querySelectorAll('Paragraph')].find(p => p.getAttribute('id') === id);
      const customId = doc.paragraphs[1].id;
      const nativeOnly = read(output); nativeOnly.querySelector('AzkriptData').remove();
      const reimported = FDX.parse(serial(nativeOnly));
      const checks = {
        stableIdentity: tree.querySelector('DocumentRef').getAttribute('id') === docId && normalized.documentId === docId,
        sharedImmutableSource: cloned.sourceFDX === source && normalized.sourceFDX === source,
        unknownSection: serial(tree.querySelector('FutureVendorSection')) === serial(original.querySelector('FutureVendorSection')),
        tags: serial(tree.querySelector('TagData')) === serial(original.querySelector('TagData')),
        boards: serial(tree.querySelector('DisplayBoards')) === serial(original.querySelector('DisplayBoards')),
        locks: serial(tree.querySelector('LockedPages')) === serial(original.querySelector('LockedPages')),
        unchangedCustomParagraph: serial(byId(tree, customId)) === serial(byId(original, customId)),
        unknownParagraphChild: !!tree.querySelector('VendorInline[Keep="yes"]'),
        unknownParagraphAttribute: byId(tree, doc.paragraphs[0].id).getAttribute('VendorParagraph') === 'keep',
        editedText: byId(tree, doc.paragraphs[0].id).querySelector('Text').textContent === 'INT. LAB - DAWN',
        customType: doc.paragraphs[1].type === 'Lyrics' && reimported.paragraphs[1].type === 'Lyrics',
        customGeometry: spec.left === 2.25 && spec.right === 6.25 && spec.before === 6 && spec.spacing === 1.5 && spec.startsNewPage,
        customFont: spec.font === 'Consolas' && spec.fontSize === 14,
        customFlow: FDModel.nextType('Lyrics', doc) === 'Lyrics' && FDModel.tabType('Lyrics', false, doc) === 'Action',
        header: doc.headerFooter.headerText === 'CONFIDENTIAL {PAGE}' && doc.headerFooter.startingPage === 3,
        smartType: doc.smartType.characters[0] === 'MARA' && doc.smartType.locations[0] === 'LAB',
        continuation: doc.moresContinueds.dialogueMore === '(PLUS)' && doc.settings.showMore === false,
        noGlobalElementsMutation: !FDModel.ELEMENTS.Lyrics,
        dualWrapperMetadata: !!tree.querySelector('Paragraph[VendorDualWrapper="keep"] > DualDialogue[VendorDual="keep"] > FutureDualMetadata') && !!tree.querySelector('FutureWrapperMetadata[Keep="yes"]'),
      };
      // Editing a rich native run keeps its original Text attributes, including
      // color precision, unknown tags and mixed-language content.
      doc.paragraphs[1].html = doc.paragraphs[1].html.replace('lyric', 'revised lyric');
      const rich = read(FDX.serialize(doc)).querySelector('Paragraph[Type="Lyrics"] > Text');
      checks.richRunAttributes = rich.getAttribute('Font') === 'Consolas' && rich.getAttribute('Size') === '14.00' && rich.getAttribute('Color') === '#94AA11150000' && rich.getAttribute('TagNumber') === '4' && rich.getAttribute('Style').includes('Superscript');
      checks.namespacedRunAttribute = rich.getAttributeNS('urn:azkript-synthetic-future', 'Flag') === 'keep';
      checks.richRunEdit = rich.textContent.includes('revised lyric');
      // Changes made by another editor must outrank stale private metadata.
      const external = read(FDX.serialize(doc));
      external.querySelector('Header > Paragraph > Text').textContent = 'VENDOR EDIT ';
      external.querySelector('SmartType > Characters > Character').textContent = 'ELIAS';
      const externalDoc = FDX.parse(serial(external));
      checks.externalNativeWins = externalDoc.headerFooter.headerText === 'VENDOR EDIT {PAGE}' && externalDoc.smartType.characters[0] === 'ELIAS';
      doc.headerFooter.headerText = 'NEW {PAGE}';
      doc.smartType.characters = ['NEW CHARACTER'];
      const edited = read(FDX.serialize(doc));
      edited.querySelector('AzkriptData').remove();
      const fields = FDX.parse(serial(edited));
      checks.nativeFieldEdits = fields.headerFooter.headerText === 'NEW {PAGE}' && fields.smartType.characters[0] === 'NEW CHARACTER';
      checks.futureHeaderPreserved = !!edited.querySelector('FutureHeaderMetadata[Keep="yes"]');
      checks.futureSmartTypePreserved = !!edited.querySelector('FutureSmartType[Keep="yes"]');
      checks.untouchedFooterPreserved = serial(edited.querySelector('Footer')) === serial(original.querySelector('Footer'));
      checks.headerFormattingRetained = edited.querySelector('Header > Paragraph').getAttribute('Alignment') === 'Right' && edited.querySelector('Header > Paragraph > Text').getAttribute('Size') === '10';
      doc.paragraphs[0].scene.synopsis = 'A synopsis edit';
      const sceneEdit = read(FDX.serialize(doc)).querySelector('SceneProperties');
      checks.targetedSceneEdit = sceneEdit.getAttribute('Summary') === 'A synopsis edit' && sceneEdit.getAttribute('Title') === 'A lab' && sceneEdit.getAttribute('VendorScene') === 'keep';
      doc.elements.Lyrics.before = 18;
      const geometryEdit = read(FDX.serialize(doc));
      const settings = geometryEdit.querySelector('ElementSettings[Type="Lyrics"]');
      checks.targetedGeometryEdit = settings.querySelector('ParagraphSpec').getAttribute('SpaceBefore') === '18' && settings.querySelector('FontSpec').getAttribute('Color') === '#FFFF00000000' && !!settings.querySelector('FutureElementMetadata[Keep="yes"]');
      const restored = FDModel.normalizeDocument(JSON.parse(JSON.stringify(doc)));
      checks.persistenceRetainsSource = restored.sourceFDX.xml === xml && read(FDX.serialize(restored)).querySelector('FutureVendorSection').getAttribute('Answer') === '42';
      const freshDoc = FDModel.blankDocument();
      freshDoc.headerFooter = { headerText: '', footerText: 'A footer', showHeader: false, showFooter: true, showOnFirstPage: true, startingPage: 7 };
      const freshNative = read(FDX.serialize(freshDoc)); freshNative.querySelector('AzkriptData').remove();
      const freshReloaded = FDX.parse(serial(freshNative));
      checks.newNativeHeaderFlags = freshReloaded.headerFooter.showHeader === false && freshReloaded.headerFooter.showFooter === true && freshReloaded.headerFooter.showOnFirstPage === true && freshReloaded.headerFooter.startingPage === 7 && freshReloaded.headerFooter.footerText === 'A footer';
      const changedRevision = read(FDX.serialize(FDModel.blankDocument()));
      changedRevision.documentElement.querySelector(':scope > Content > Paragraph > Text').setAttribute('RevisionID', '17');
      const changedRevisionDoc = FDX.parse(serial(changedRevision));
      checks.externalRevisionMarksWin = changedRevisionDoc.revision.enabled && changedRevisionDoc.paragraphs[0].revision === 17;
      const damaged = FDModel.cloneDocument(doc);
      damaged.sourceFDX = { ...damaged.sourceFDX, paragraphBindings: [] };
      try { FDX.serialize(damaged); checks.incompleteSourceStopsSave = false; }
      catch (error) { checks.incompleteSourceStopsSave = /paragraph bindings/.test(error.message); }
      return { checks, compatibility: FDX.compatibility(doc), output };
    }, fixture);
    assert.deepEqual(Object.entries(result.checks).filter(([, ok]) => !ok), []);
    assert.equal(result.compatibility.mode, 'preserve-source');
    assert.equal(result.compatibility.vendorVerified, false);
    const templateFolder = process.env.FDX_TEMPLATE_DIR || 'C:/Program Files (x86)/Final Draft 13/Templates';
    const templates = await walk(templateFolder);
    const corpus = [];
    for (const file of templates) {
      const xml = await fs.readFile(file, 'utf8');
      const checks = await page.evaluate(xml => {
        const read = text => new DOMParser().parseFromString(text, 'application/xml');
        const serial = node => new XMLSerializer().serializeToString(node);
        const source = read(xml), doc = FDX.parse(xml), output = read(FDX.serialize(doc, { template: true }));
        const sections = [...source.documentElement.children].filter(e => !['AzkriptData', 'StudioData', 'DocumentRef'].includes(e.nodeName));
        return { allSections: sections.every(section => {
            const target = [...output.documentElement.children].find(e => e.nodeName === section.nodeName && e.getAttribute('Type') === section.getAttribute('Type'));
            return target && serial(target) === serial(section);
          }),
          customTypes: [...source.querySelectorAll('Content > Paragraph')].filter(p => p.getAttribute('Type') && p.getAttribute('Type') !== 'DualDialogue')
            .every(p => doc.paragraphs.some(model => model.type === p.getAttribute('Type'))),
          identity: doc.documentId === FDX.parse(new XMLSerializer().serializeToString(output)).documentId };
      }, xml);
      assert.equal(checks.allSections, true, `${path.basename(file)}: unedited native sections changed`);
      assert.equal(checks.customTypes, true, `${path.basename(file)}: custom body type lost`);
      assert.equal(checks.identity, true, `${path.basename(file)}: document identity changed`);
      corpus.push({ file: path.relative(templateFolder, file), ...checks });
    }
    assert.equal(templates.length, 54);
    const outputFolder = path.join(root, 'reports/practical-interchange');
    await fs.mkdir(outputFolder, { recursive: true });
    await fs.writeFile(path.join(outputFolder, 'fixture-export.fdx'), result.output);
    await fs.writeFile(path.join(outputFolder, 'verification.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), syntheticChecks: result.checks, corpus, vendorRuntimeVerified: false,
    }, null, 2));
    console.log(`PASS: ${Object.keys(result.checks).length} populated synthetic checks and ${corpus.length} untouched template round-trips`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
