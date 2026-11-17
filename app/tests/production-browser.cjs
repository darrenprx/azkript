'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),{chromium}=require(path.join(root,'node_modules/playwright-core'));
const {setInterfaceScale}=require('./ui-scale.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--mute-audio']}),cases=[];
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('azkript.prefs.v2'))localStorage.setItem('azkript.prefs.v2',JSON.stringify({startCenter:false,smartTypeEnabled:false}));});
 await page.goto(pathToFileURL(path.join(root,'app/index.html')).href);await page.locator('#productionToolsButton').waitFor();
 const tool=async id=>{if(await page.locator('#appDialog').evaluate(e=>e.open))await page.keyboard.press('Escape');await page.locator('#productionToolsButton').click();await page.locator('#production-'+id).click();};
 const download=async label=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const d=await pending;return {name:d.suggestedFilename(),text:await fs.readFile(await d.path(),'utf8')};};
 try{
  await tool('locking');await page.getByRole('button',{name:'Issue and lock pages',exact:true}).click();await page.keyboard.press('Control+s');
  let roundtrip=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('azkript.document.v3')),r=FDX.parse(FDX.serialize(d));return {labels:FDPagination.layout(r).pages.filter(p=>p.kind==='script').map(p=>p.label),numbers:FDModel.getScenes(r).map(s=>s.number),beforeNumbers:FDModel.getScenes(d).map(s=>s.number),baseline:!!r.production.baseline};});
  assert.ok(roundtrip.baseline);assert.deepEqual(roundtrip.numbers,roundtrip.beforeNumbers);assert.ok(roundtrip.labels.length);cases.push('25: lock through UI and preserve issued pagination/scene numbers through FDX');
  const heading = page.locator('#editor .para[data-type="Scene Heading"]').first();
  const sceneId = await heading.getAttribute('data-id');
  const initialNumber = await heading.getAttribute('data-scene-number');
  const assertNumber = async number => {
    await page.waitForFunction(({ sceneId, number }) => {
      const heading = document.querySelector(`#editor .para[data-id="${sceneId}"]`);
      const navigator = document.querySelector(`.scene-item[data-scene-id="${sceneId}"] .scene-index`);
      return heading.dataset.sceneNumber === number && navigator.textContent === number;
    }, { sceneId, number });
  };
  await heading.click();
  await page.locator('#ribbonTab-production').click();
  await page.getByRole('button', { name: 'Edit Scene Number', exact: true }).click();
  const originalOverride = await page.locator('#dialogSceneNumber').inputValue();
  await page.locator('#dialogSceneNumber').fill('35A');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await assertNumber('35A');
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('azkript.document.v3'));
    return FDModel.getScenes(FDX.parse(FDX.serialize(saved)))[0].number;
  }), '35A');
  await page.getByRole('tab', { name: 'Scene', exact: true }).click();
  await page.locator('#sceneNumberInput').fill(originalOverride);
  await page.locator('#sceneNumberInput').press('Tab');
  await assertNumber(initialNumber);
  cases.push('Scene number edits update the issued script and Navigator, survive FDX, and can be cleared in the inspector');
  assert.ok(await page.evaluate(()=>{let doc=FDProduction.lock(FDModel.blankDocument());doc.paragraphs.push(FDModel.makeParagraph('Scene Heading','EXT. INSERTED - DAY'));doc=FDProduction.approve(doc,'Owner','owner');return FDProduction.approvalValid(FDX.parse(FDX.serialize(doc)));}),'Approvals on newly inserted numbered scenes survive save/reopen');
  const action=page.locator('#editor .para[data-type="Action"]').first();await action.fill('Production revision: copper key on the table.');await page.keyboard.press('Control+s');
  await tool('revisions');assert.match(await page.locator('#appDialog').innerText(),/Changed pages: [0-9]/);const summary=await download('Export revision summary');assert.match(summary.text,/Paragraph changes/);cases.push('26: actual edit appears in downloadable revision summary');
  await tool('breakdown');await page.locator('#breakdownLabel').fill('Copper key');await page.locator('#breakdownCategory').selectOption('props');await page.getByRole('button',{name:'Add native tag',exact:true}).click();assert.match(await page.locator('#appDialog').innerText(),/props · Copper key/);
  await page.keyboard.press('Escape');await page.keyboard.press('Control+s');
  const native=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('azkript.document.v3')),xml=FDX.serialize(d),r=FDX.parse(xml);return {xml,tags:r.paragraphs.flatMap(p=>p.tags||[])};});
  assert.match(native.xml,/<TagDefinitions>/);assert.match(native.xml,/TagNumber=/);assert.ok(native.tags.some(t=>t.label==='Copper key'));cases.push('27: UI tags write native FDX definitions and paragraph references');
  await tool('handoff');await page.locator('#handoffKind').selectOption('dialogue only');const dialogue=await download('Export text');assert.match(dialogue.text,/SCENE /);assert.doesNotMatch(dialogue.text,/Production revision: copper/);cases.push('28: downloadable dialogue handoff excludes action');
  await tool('preflight');await page.getByRole('heading',{name:'PDF preflight',exact:true}).waitFor();assert.match(await page.locator('#appDialog').innerText(),/Passed/);const receipt=JSON.parse((await download('Export preflight receipt')).text);assert.ok(receipt.ok,JSON.stringify(receipt));cases.push('29: rendered preflight checks fonts, coverage, page boxes and geometry');
  await tool('exchange');const fountain=await download('Export current draft');assert.match(fountain.text,/Title:/);await page.locator('#exchangeText').fill('Title: Exchange test\nAuthor: Test\n\n.INT. ROOM - DAY\n\n@MARA\nHello there.\n\n!A key drops.');await page.getByRole('button',{name:'Preview import',exact:true}).click();assert.match(await page.locator('#exchangePreview').innerText(),/Dialogue.*Hello there/s);await page.locator('#exchangeText').fill('!Changed');await page.getByRole('button',{name:'Apply previewed import',exact:true}).click();assert.ok(await page.locator('#appDialog').evaluate(e=>e.open));cases.push('30: Fountain downloads and previewed element inference invalidate stale previews');
  await tool('read');await page.locator('#readPronunciation').fill('Mara = Mah rah');await page.locator('#readWpm').fill('120');await page.getByRole('button',{name:'Save voice and pronunciation settings',exact:true}).click();assert.equal(await page.locator('#readWpm').inputValue(),'120');const timing=await download('Export timing CSV');assert.match(timing.text,/"seconds"/);cases.push('31: save pronunciation/profiles and export scene timing');
  await tool('review');await page.locator('#reviewAuthor').fill('Sam');await page.locator('#reviewComment').fill('Check the key continuity.');await page.getByRole('button',{name:'Add comment',exact:true}).click();assert.match(await page.locator('#appDialog').innerText(),/Check the key continuity/);await page.locator('[data-resolve="0"]').click();await page.locator('#reviewAuthor').fill('Darren');await page.getByRole('button',{name:'Approve draft as owner',exact:true}).click();assert.match(await page.locator('#appDialog').innerText(),/Approved by Darren/);
  const clean=await download('Export clean review FDX');assert.doesNotMatch(clean.text,/Check the key continuity/);await page.locator('#reviewRole').selectOption('approver');const invitation=JSON.parse((await download('Export review packet')).text);assert.equal(invitation.role,'approver');
  const response=await page.evaluate(packet=>FDProduction.respond(packet,{author:'Reviewer',approve:true}),invitation);
  await page.locator('#reviewFile').setInputFiles({name:'review.azkresponse',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});await page.getByText('Approved by Reviewer',{exact:true}).waitFor();cases.push('32: scoped comments, resolution, owner approval, clean FDX and offline approval response');
  await fs.mkdir(path.join(root,'reports/production-upgrade'),{recursive:true});await page.screenshot({path:path.join(root,'reports/production-upgrade/review.png')});
  await page.keyboard.press('Escape');await page.keyboard.press('Control+s');
  const reopened=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('azkript.document.v3')),r=FDX.parse(FDX.serialize(d));return {approved:FDProduction.approvalValid(r),before:FDProduction.fingerprint(d),after:FDProduction.fingerprint(r),locked:!!r.production.lock};});
  const differences=[];function compare(a,b,path=''){if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[k],b[k],path+'.'+k);}else differences.push({path,before:a,after:b});}compare(JSON.parse(reopened.before),JSON.parse(reopened.after));
  assert.equal(reopened.locked,true);assert.equal(reopened.approved,true,'Approval must survive an FDX save and reopen: '+JSON.stringify(differences.slice(0,30)));
  await tool('exchange');await page.locator('#exchangeText').fill('Title: Imported draft\n\n.INT. NEW ROOM - DAY\n\n!New action.');await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('button',{name:'Apply previewed import',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#appDialog').open);await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('azkript.document.v3')).title),'Imported draft');
  await heading.click();
  await page.locator('#sceneNumberInput').fill('36');
  await page.locator('#ribbonTab-production').click();
  await page.getByRole('button', { name: 'Reset Scene Numbers', exact: true }).click();
  await page.locator('#appDialog').getByRole('button', { name: 'Reset Scene Numbers', exact: true }).click();
  assert.equal(await heading.getAttribute('data-scene-number'), '1');
  await page.keyboard.press('Control+s');
  assert.equal(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('azkript.document.v3'));
    return FDModel.getScenes(FDX.parse(FDX.serialize(saved)))[0].paragraph.scene.number;
  }), '');
  cases.push('Reset Scene Numbers restores sequential numbering in the saved draft');
  await page.setViewportSize({width:1100,height:800});await setInterfaceScale(page,2);await page.reload();await page.waitForFunction(()=>Number(getComputedStyle(document.documentElement).zoom)===2);await tool('read');await page.locator('#appDialog details summary').click();await page.locator('[data-read-rate="0"]').fill('1.2');assert.equal(await page.locator('[data-read-rate="0"]').inputValue(),'1.2');cases.push('Production hub and voice fields remain reachable at 200% scale');
  await page.getByRole('button',{name:'Save voice and pronunciation settings',exact:true}).click();await page.locator('#appDialog details summary').click();assert.equal(await page.locator('[data-read-rate="0"]').inputValue(),'1.2');await page.screenshot({path:path.join(root,'reports/production-upgrade/scaled-read.png')});assert.deepEqual(errors,[]);
  console.log(cases.map(c=>'PASS: '+c).join('\n'));await fs.writeFile(path.join(root,'reports/production-upgrade/browser.json'),JSON.stringify({passed:true,cases},null,2));
 }catch(e){console.error('Completed:',cases);await fs.mkdir(path.join(root,'reports/production-upgrade'),{recursive:true});await page.screenshot({path:path.join(root,'reports/production-upgrade/failure.png')});console.error(await page.locator('#appDialog').innerText());throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
