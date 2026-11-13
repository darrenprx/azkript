/* Native graph editing with original populated data and actual local templates. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(root, 'node_modules/playwright-core'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--mute-audio'] });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, 'app/index.html')).href);
    await page.waitForFunction(() => !!window.FDX);
    const fixture = await fs.readFile(path.join(__dirname, 'fixtures/native-production.fdx'), 'utf8');
    const checks = await page.evaluate(xml => {
      const read = value => new DOMParser().parseFromString(value, 'application/xml');
      const serial = value => new XMLSerializer().serializeToString(value);
      const nativeOnly = doc => { const tree = read(FDX.serialize(doc)); tree.querySelector('AzkriptData')?.remove(); return FDX.parse(serial(tree)); };
      const original = FDX.parse(xml), tree = read(xml), output = {};
      const flatten = snapshot => snapshot.sections.flatMap(s => {
        const walk = node => [{ section: s.name, ...node }, ...node.children.flatMap(walk)]; return s.nodes.flatMap(walk);
      });
      const find = (snapshot, section, name, label) => flatten(snapshot).find(n => n.section === section && n.name === name && (!label || n.label === label));
      const edit = (doc, section, name, attribute, value, label) => {
        const snapshot = FDX.nativeMetadata(doc), node = find(snapshot, section, name, label);
        return FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section, path: node.path, attribute, value }] });
      };
      const throws = action => { try { action(); return false; } catch (error) { return !!error.message; } };
      output.castImported = original.cast.MARA.actor === 'Voice One';
      output.beatImported = original.beats.length === 1 && original.beats[0].title === 'Arrival' && original.beats[0].body === 'An arrival beat.' && original.beats[0].x === 40;
      output.tagImported = original.paragraphs[0].tags.length === 1 && original.paragraphs[0].tags[0].label === 'A radio' && original.paragraphs[0].tags[0].category === 'props';
      output.highlightImported = original.characterHighlights.MARA === '#112233';
      let doc = edit(original, 'TagData', 'TagDefinition', 'Label', 'A repaired radio');
      let parsed = nativeOnly(doc), saved = read(FDX.serialize(doc));
      output.nativeLabelSurvivesWithoutPrivateData = parsed.paragraphs[0].tags[0].label === 'A repaired radio';
      output.unknownsPreserved = !!saved.querySelector('FutureDocumentMetadata[Keep="yes"]') && !!saved.querySelector('FutureTag[Keep="yes"]') && !!saved.querySelector('FutureBoard[Keep="yes"]');
      output.sourceImmutable = doc.sourceFDX === original.sourceFDX && doc.sourceFDX.xml === xml;
      output.normalizationIncludesNativeEdits = FDModel.cloneDocument(doc).nativeMetadata.length > 0 && FDModel.normalizeDocument(JSON.parse(JSON.stringify(doc))).nativeMetadata.length > 0;
      doc = edit(doc, 'ListItems', 'ListItem', 'Title', 'Native arrival');
      doc = edit(doc, 'DisplayBoards', 'Item', 'Left', '-24');
      doc = edit(doc, 'LockedPages', 'LockedPage', 'PageNumber', '1A');
      parsed = nativeOnly(doc); saved = read(FDX.serialize(doc));
      output.nativeBeatEdits = parsed.beats[0].title === 'Native arrival' && parsed.beats[0].x === -24 && saved.querySelector('LockedPage').getAttribute('PageNumber') === '1A';
      output.unknownAttributesPreserved = saved.querySelector('Item').getAttribute('FuturePosition') === 'keep' && saved.querySelector('LockedPage').getAttribute('FutureLock') === 'keep';
      let snapshot = FDX.nativeMetadata(doc), def = find(snapshot, 'TagData', 'TagDefinition');
      output.referenceDeleteRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'TagData', path: def.path, action: 'delete' }] }));
      output.staleBatchRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: 'stale', edits: [] }));
      output.identityRewriteRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'TagData', path: def.path, attribute: 'Id', value: 'broken' }] }));
      output.missingCategoryRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'TagData', path: def.path, attribute: 'CatId', value: 'missing' }] }));
      const narrator = find(snapshot, 'Cast', 'Narrator');
      output.missingNarratorActorRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'Cast', path: narrator.path, attribute: 'Actor', value: 'Missing Voice' }] }));
      const category = find(snapshot, 'TagData', 'TagCategory');
      output.invalidNativeColorRejected = throws(() => FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'TagData', path: category.path, attribute: 'Color', value: 'not-a-color' }] }));
      const beatNode = find(snapshot, 'ListItems', 'ListItem');
      const duplicated = FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits: [{ section: 'ListItems', path: beatNode.path, action: 'duplicate' }] });
      const duplicateTree = read(FDX.serialize(duplicated));
      const ids = [...duplicateTree.querySelectorAll('ListItems Paragraph[id]')].map(n => n.getAttribute('id'));
      output.duplicateGraphIdentity = duplicated.beats.length === 2 && new Set(ids).size === ids.length && duplicateTree.querySelectorAll('DisplayBoard[Type="Beat"] > Item').length === 2;
      snapshot = FDX.nativeMetadata(duplicated);
      const duplicateNode = flatten(snapshot).filter(n => n.name === 'ListItem')[1];
      const deleted = FDX.updateNativeMetadata(duplicated, { signature: snapshot.signature, edits: [{ section: 'ListItems', path: duplicateNode.path, action: 'delete' }] });
      output.deleteCleansBoardReferences = deleted.beats.length === 1 && read(FDX.serialize(deleted)).querySelectorAll('DisplayBoard[Type="Beat"] > Item').length === 1;
      const normal = FDModel.cloneDocument(original);
      normal.cast.MARA.actor = 'Voice Two'; normal.beats[0].title = 'Regular beat editor'; normal.beats[0].x = 512;
      normal.characterHighlights.MARA = '#abcdef';
      normal.paragraphs[0].tags.push({ id: 'new-tag', category: 'props', label: 'A compass', color: '#112233' });
      parsed = nativeOnly(normal); saved = read(FDX.serialize(normal));
      output.normalCastToolWritesNative = parsed.cast.MARA.actor === 'Voice Two' && !!saved.querySelector('Actor[Name="Voice Two"]');
      output.normalBeatToolWritesNative = parsed.beats[0].title === 'Regular beat editor' && parsed.beats[0].x === 512;
      output.normalHighlightToolWritesNative = parsed.characterHighlights.MARA === '#abcdef';
      output.normalTagsToolWritesNative = parsed.paragraphs[0].tags.some(t => t.label === 'A compass');
      const bodyEdit = FDModel.cloneDocument(original); bodyEdit.beats[0].body = 'A new native body.';
      const bodyTree = read(FDX.serialize(bodyEdit));
      output.beatBodyKeepsUnknownChildren = bodyTree.querySelector('ListItem Text').textContent === 'A new native body.' && !!bodyTree.querySelector('ListItem Content FutureText[Keep="yes"]') && bodyTree.querySelector('ListItem Text').getAttribute('Style') === 'Italic';
      const runs = [...saved.querySelector('Content > Paragraph').querySelectorAll(':scope > Text')];
      const graph = new Map([...saved.querySelectorAll('TagData > Tags > Tag')].map(n => [n.getAttribute('Number'), [...n.querySelectorAll('DefId')].map(d => d.textContent)]));
      output.importedTagRangesPreserved = graph.get(runs[0].getAttribute('TagNumber')).length === 1 && graph.get(runs[1].getAttribute('TagNumber')).length === 2 && graph.get(runs[2].getAttribute('TagNumber')).length === 1;
      const remove = FDModel.cloneDocument(original); remove.paragraphs[0].tags = [];
      output.normalRemoveTagWritesNative = !(nativeOnly(remove).paragraphs[0].tags || []).length;
      const external = read(FDX.serialize(normal)); external.querySelector('Cast > Member').setAttribute('Actor', 'Voice One'); external.querySelector('TagDefinition').setAttribute('Label', 'External radio'); external.querySelector('ListItem').setAttribute('Title', 'External beat');
      const externalDoc = FDX.parse(serial(external));
      output.externalNativeWins = externalDoc.cast.MARA.actor === 'Voice One' && externalDoc.beats[0].title === 'External beat' && externalDoc.paragraphs[0].tags.some(t => t.label === 'External radio');
      const newDoc = FDModel.blankDocument(); newDoc.cast.MARA = { actor: 'New Voice' }; newDoc.beats = [{ id: 'new-beat', title: 'New beat', body: 'New body', color: '#123456', x: 25, y: 50, width: 240 }]; newDoc.paragraphs[0].tags = [{ id: 'fresh-tag', category: 'props', label: 'Fresh prop', color: '#123456' }];
      parsed = nativeOnly(newDoc); output.newNativeGraphs = parsed.cast.MARA.actor === 'New Voice' && parsed.beats.length === 1 && parsed.beats[0].title === 'New beat' && parsed.paragraphs[0].tags[0].label === 'Fresh prop';
      const reopen = FDX.parse(FDX.serialize(newDoc)); reopen.beats[0].title = 'Edited after reload';
      saved = read(FDX.serialize(reopen)); output.appBeatIdDoesNotDuplicate = saved.querySelectorAll('ListItems > ListItem').length === 1 && saved.querySelector('ListItem').getAttribute('Title') === 'Edited after reload';
      const legacy = read(FDX.serialize(newDoc));
      for (const name of ['Cast', 'Actors', 'ListItems', 'DisplayBoards', 'TagData']) legacy.querySelector(name)?.remove();
      const payload = JSON.parse(legacy.querySelector('AzkriptData').textContent); delete payload.nativeSignatures; legacy.querySelector('AzkriptData').textContent = JSON.stringify(payload);
      const migrated = nativeOnly(FDX.parse(serial(legacy)));
      output.legacyPrivateMetadataMigratesToNative = migrated.cast.MARA.actor === 'New Voice' && migrated.beats[0].title === 'New beat' && migrated.paragraphs[0].tags[0].label === 'Fresh prop';
      const unknownReference = read(xml); unknownReference.documentElement.appendChild(read('<FutureRef Target="73062100-1243-4528-9012-012345678907"/>').documentElement);
      const referencedDoc = FDX.parse(serial(unknownReference)), referencedSnapshot = FDX.nativeMetadata(referencedDoc), referencedBeat = find(referencedSnapshot, 'ListItems', 'ListItem');
      output.unknownIncomingReferenceBlocksDelete = throws(() => FDX.updateNativeMetadata(referencedDoc, { signature: referencedSnapshot.signature, edits: [{ section: 'ListItems', path: referencedBeat.path, action: 'delete' }] }));
      const nestedGraph = read(xml); nestedGraph.querySelector('DisplayBoard > Item').appendChild(read('<FuturePlacement Id="unknown-id"/>').documentElement);
      const nestedDoc = FDX.parse(serial(nestedGraph)), nestedSnapshot = FDX.nativeMetadata(nestedDoc), nestedBeat = find(nestedSnapshot, 'ListItems', 'ListItem');
      output.unknownBoardIdentityBlocksDuplicate = throws(() => FDX.updateNativeMetadata(nestedDoc, { signature: nestedSnapshot.signature, edits: [{ section: 'ListItems', path: nestedBeat.path, action: 'duplicate' }] }));
      const suffix = read(xml); suffix.querySelector('Cast > Member').setAttribute('Character', 'MARA (V.O.)');
      const suffixDoc = FDX.parse(serial(suffix)); suffixDoc.cast.MARA.actor = 'Voice Two';
      const suffixOutput = read(FDX.serialize(suffixDoc));
      output.castSuffixDoesNotDuplicateAssignment = suffixOutput.querySelectorAll('Cast > Member').length === 1 && suffixOutput.querySelector('Cast > Member').getAttribute('Character') === 'MARA (V.O.)' && suffixOutput.querySelector('Cast > Member').getAttribute('Actor') === 'Voice Two';
      const sampleOutput = read(FDX.serialize(FDModel.sampleDocument()));
      const categoryIds = [...sampleOutput.querySelectorAll('TagCategory')].map(n => n.getAttribute('Id'));
      output.sampleNativeGraphExports = categoryIds.length > 1 && new Set(categoryIds).size === categoryIds.length;
      return output;
    }, fixture);
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
    const tutorial = path.join(root, 'official/admin/Program Files/Final Draft 13/Tutorial/Tangle & Moss FD 13 - Shooting Script.fdxt');
    let observedTutorial = { available: false };
    try {
      const source = await fs.readFile(tutorial, 'utf8');
      observedTutorial = await page.evaluate(xml => {
        const doc = FDX.parse(xml), snapshot = FDX.nativeMetadata(doc), flat = [];
        const walk = (section, node) => { flat.push({ section, ...node }); node.children.forEach(child => walk(section, child)); };
        snapshot.sections.forEach(section => section.nodes.forEach(node => walk(section.name, node)));
        const def = flat.find(n => n.name === 'TagDefinition' && n.attributes.some(a => a.name === 'Label' && a.editable));
        const item = flat.find(n => n.name === 'Item' && n.attributes.some(a => a.name === 'Left' && a.editable));
        const lock = flat.find(n => n.name === 'LockedPage' && n.attributes.some(a => a.name === 'PageNumber' && a.editable));
        const edits = [
          { section: def.section, path: def.path, attribute: 'Label', value: 'Original interoperability test edit' },
          { section: item.section, path: item.path, attribute: 'Left', value: '64' },
          { section: lock.section, path: lock.path, attribute: 'PageNumber', value: 'TEST-1' },
        ];
        const edited = FDX.updateNativeMetadata(doc, { signature: snapshot.signature, edits });
        const output = new DOMParser().parseFromString(FDX.serialize(edited), 'application/xml');
        output.querySelector('AzkriptData').remove();
        const native = FDX.parse(new XMLSerializer().serializeToString(output));
        return { available: true, source: 'Locally observed signed-distribution tutorial XML; no vendor executable was run', sections: snapshot.sections.length, cast: Object.keys(doc.cast).length, beats: doc.beats.length, taggedParagraphs: doc.paragraphs.filter(p => p.tags?.length).length,
          checks: { label: [...output.querySelectorAll('TagDefinition')].some(n => n.getAttribute('Label') === 'Original interoperability test edit'), board: !!output.querySelector('Item[Left="64"]'), lock: !!output.querySelector('LockedPage[PageNumber="TEST-1"]'), body: FDModel.documentText(doc) === FDModel.documentText(native), counts: Object.keys(native.cast).length === Object.keys(doc.cast).length && native.beats.length === doc.beats.length } };
      }, source);
      for (const [name, passed] of Object.entries(observedTutorial.checks)) assert.equal(passed, true, `observed tutorial ${name}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const report = { checks, count: Object.keys(checks).length, observedTutorial, vendorRuntimeVerified: false };
    await fs.mkdir(path.join(root, 'reports/native-metadata'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports/native-metadata/verification.json'), JSON.stringify(report, null, 2));
    console.log(`PASS: ${report.count} native metadata graph checks`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
