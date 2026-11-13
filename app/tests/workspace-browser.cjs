'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');const root=path.resolve(__dirname,'../..');
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
const {setInterfaceScale}=require('./ui-scale.cjs');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--mute-audio']});
  const cases=[];let failures=0;
  async function check(name,run){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{await page.addInitScript(()=>{if(!localStorage.getItem('azkript.prefs.v2'))localStorage.setItem('azkript.prefs.v2',JSON.stringify({startCenter:false,smartTypeEnabled:false}));});
      await page.goto(pathToFileURL(path.join(root,'app/index.html')).href);await page.waitForFunction(()=>document.querySelector('#workspaceButton'));
      await run(page);assert.deepEqual(errors,[]);cases.push({name,passed:true});console.log('PASS: '+name);
    }catch(error){failures++;cases.push({name,passed:false,error:error.message});console.error('FAIL: '+name+'\n'+error.stack);await fs.mkdir(path.join(root,'reports/workspace-upgrade'),{recursive:true});await page.screenshot({path:path.join(root,'reports/workspace-upgrade','failure-'+name.replace(/[^a-z0-9]+/gi,'-')+'.png')});}finally{await context.close();}
  }
  const workspace=async page=>{await page.locator('#workspaceButton').click();await page.getByRole('heading',{name:'Workspace',exact:true}).waitFor();};
  const tool=async(page,id)=>{await workspace(page);await page.locator('#'+id).click();};
  const close=async page=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#appDialog').open);};
  await check('writing/production presets, custom layout, quick access and reload',async page=>{
    await workspace(page);await page.locator('#presetWriting').click();
    assert.ok(await page.locator('#appShell').evaluate(el=>el.classList.contains('ribbon-collapsed')));
    await workspace(page);await page.locator('#layoutLeft').fill('310');await page.locator('#layoutName').fill('Review desk');await page.locator('[data-quick="exportButton"]').uncheck();
    await page.getByRole('button',{name:'Save layout',exact:true}).click();await page.getByRole('button',{name:'Review desk',exact:true}).waitFor();await close(page);
    assert.equal(await page.locator('#exportButton').isVisible(),false);
    await page.reload();await page.locator('#workspaceButton').waitFor();
    assert.equal(await page.locator('#exportButton').isVisible(),false);
    assert.equal(await page.locator('.workspace').evaluate(el=>getComputedStyle(el).getPropertyValue('--ws-nav').trim()),'310px');
    await workspace(page);await page.locator('#presetProduction').click();assert.equal(await page.locator('[data-ribbon-tab="production"]').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#appShell').evaluate(el=>el.classList.contains('ribbon-collapsed')),false);
    await fs.mkdir(path.join(root,'reports/workspace-upgrade'),{recursive:true});await page.screenshot({path:path.join(root,'reports/workspace-upgrade/production.png')});
  });
  await check('scratchpad notes persist, serialize reference IDs and support undo',async page=>{
    await page.locator('#editor .para').nth(1).click();
    await tool(page,'workspaceNotes');await page.locator('#newScratch').click();await page.locator('#scratchTitle').fill('Research clue');await page.locator('#scratchTitle').blur();
    await page.locator('#scratchText').fill('A red bicycle returns after midnight.');
    await page.locator('#closeScratch').click();await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+s');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('azkript.document.v3')).workspaceNotes[0].text),'');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+s');
    const result=await page.evaluate(()=>{const doc=JSON.parse(localStorage.getItem('azkript.document.v3'));const reopened=FDX.parse(FDX.serialize(doc));const note=reopened.workspaceNotes[0];return{note,linked:reopened.paragraphs.some(p=>p.id===note.paragraphId),body:reopened.paragraphs.map(FDModel.paragraphText).join('\n')};});
    assert.equal(result.note.title,'Research clue');assert.equal(result.linked,true);assert.match(result.note.text,/red bicycle/);assert.doesNotMatch(result.body,/red bicycle/);
    await page.reload();await page.locator('#workspaceButton').waitFor();await tool(page,'workspaceNotes');
    assert.equal(await page.locator('#scratchText').inputValue(),'A red bicycle returns after midnight.');
    await page.screenshot({path:path.join(root,'reports/workspace-upgrade/scratchpad.png')});
  });
  await check('split layout and per-document navigation position survive reopening',async page=>{
    await page.locator('#editor .para').nth(20).click();
    const selected=await page.locator('#editor .para').nth(20).getAttribute('data-id');
    await page.locator('#splitViewButton').click();
    await page.locator('[data-ribbon-tab="view"]').click();
    await page.waitForTimeout(450);
    await page.reload();await page.locator('#workspaceButton').waitFor();
    await page.waitForFunction(selected=>document.querySelector('#editor .para.is-selected')?.dataset.id===selected||document.activeElement?.dataset.id===selected,selected);
    assert.equal(await page.locator('#editorStage').evaluate(el=>el.classList.contains('is-split')),true);
    assert.equal(await page.locator('[data-ribbon-tab="view"]').getAttribute('aria-selected'),'true');
  });
  await check('unified search filters and navigates actual scene results with keyboard',async page=>{
    await page.keyboard.press('Control+Shift+f');await page.locator('#unifiedQuery').fill('observatory');await page.locator('[data-result]').first().waitFor();
    assert.match(await page.locator('#unifiedResults').innerText(),/Ridge|OBSERVATORY/);
    await page.locator('#unifiedQuery').press('ArrowDown');assert.equal(await page.locator('[data-result="0"]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('#appDialog').open);
    assert.equal(await page.locator('#editor .para').first().evaluate(el=>el===document.activeElement),true);
  });
  await check('previewed bulk scene duplicate is one undoable edit',async page=>{
    const before=await page.locator('#editor .para').count();await tool(page,'workspaceScenes');await page.locator('#sceneOperation').selectOption('duplicate');await page.locator('[data-scene-choice]').first().check();
    await page.getByRole('button',{name:'Preview',exact:true}).click();assert.equal(await page.locator('#editor .para').count(),before);
    await page.getByRole('button',{name:'Apply scene changes',exact:true}).click();assert.ok(await page.locator('#editor .para').count()>before);
    await page.keyboard.press('Control+z');assert.equal(await page.locator('#editor .para').count(),before);
    await page.keyboard.press('Control+y');assert.ok(await page.locator('#editor .para').count()>before);
  });
  await check('named milestones survive rotation and compare dialogue by scene/character',async page=>{
    await tool(page,'workspaceMilestones');await page.locator('#milestoneName').fill('First draft');await page.getByRole('button',{name:'Save milestone',exact:true}).click();await page.locator('[data-milestone]').first().waitFor();await close(page);
    const dialogue=page.locator('#editor .para[data-type="Dialogue"]').first();await dialogue.fill('The red bicycle returns.');await page.keyboard.press('Control+s');
    await tool(page,'workspaceMilestones');await page.locator('[data-milestone]').first().click();await page.getByRole('heading',{name:/Character dialogue/}).waitFor();
    assert.match(await page.locator('#appDialog').innerText(),/Scenes \(1\)|Character dialogue \(1\)/);await close(page);
    const retained=await page.evaluate(async()=>{const store=new FDWritingTools.BrowserBackups({retention:2}),doc=FDModel.blankDocument();await store.create(doc,{label:'Milestone: Keep'});for(let i=0;i<5;i++){doc.title='D'+i;await store.create(doc);}return(await store.list(doc.documentId)).map(v=>v.label);});
    assert.ok(retained.includes('Milestone: Keep'));
  });
  await check('workspace tools remain reachable at narrow viewport and 200% scale',async page=>{
    await page.setViewportSize({width:1100,height:800});await workspace(page);
    assert.ok(await page.locator('#workspaceSearch').isVisible());await close(page);
    await setInterfaceScale(page,2);
    await page.reload();await page.waitForFunction(()=>Number(getComputedStyle(document.documentElement).zoom)===2);
    await workspace(page);await page.locator('#workspaceSearch').click();await page.locator('#unifiedQuery').fill('signal');await page.locator('[data-result]').first().waitFor();
    await page.screenshot({path:path.join(root,'reports/workspace-upgrade/scaled-search.png')});
  });
  await browser.close();await fs.mkdir(path.join(root,'reports/workspace-upgrade'),{recursive:true});await fs.writeFile(path.join(root,'reports/workspace-upgrade/browser.json'),JSON.stringify({cases,passed:!failures},null,2));if(failures)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
