/* Hidden native bridge tests; native pickers choose only disposable test paths. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),{_electron}=require(path.join(root,'node_modules/playwright-core'));
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-workspace-e2e-')),profile=path.join(temp,'profile'),folder=path.join(temp,'Series project');let app;
  await fs.mkdir(folder);const env={...process.env,AZKRIPT_USER_DATA:profile,AZKRIPT_TEST_BACKGROUND:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const cases=[],errors=[];
  try{
    app=await _electron.launch({executablePath:process.env.AZKRIPT_TEST_EXECUTABLE||path.join(root,'node_modules/electron/dist/electron.exe'),args:[...(process.env.AZKRIPT_TEST_EXECUTABLE?[]:['.']),'--mute-audio','--disable-renderer-backgrounding','--disable-gpu'],cwd:root,env});
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>document.querySelector('#workspaceButton'));
    await page.waitForFunction(()=>document.querySelector('#startCenter').open);
    await page.locator('#startCenterClose').click();
    await page.waitForFunction(()=>!document.querySelector('#startCenter').open);
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
    await page.locator('#workspaceButton').click();await page.locator('#workspaceProject').click();
    await page.getByRole('button',{name:'Create project',exact:true}).click();await page.locator('#projectCast').waitFor();
    await page.locator('#projectCast').fill('MARA: engineer; ELIAS: observer');await page.locator('#projectLocations').fill('Observatory ridge');
    await page.getByRole('button',{name:'Save bible',exact:true}).click();await page.locator('#projectCast').waitFor();
    assert.equal(await page.locator('#projectCast').inputValue(),'MARA: engineer; ELIAS: observer');
    await page.getByRole('button',{name:'Add script copy',exact:true}).click();await page.locator('[data-project-script]').waitFor();
    const manifest=JSON.parse(await fs.readFile(path.join(folder,'project.azkproj'),'utf8'));assert.equal(manifest.scripts.length,1);assert.match(manifest.bible.locations,/ridge/);
    cases.push('Create real project, save bible and add FDX copy through UI');
    await page.locator('[data-project-script]').click();await page.waitForFunction(()=>!document.querySelector('#appDialog').open);
    const canonicalFolder=await fs.realpath(folder);
    await page.waitForFunction(folder=>document.querySelector('#documentPill').title.toLowerCase().startsWith(folder.toLowerCase()),canonicalFolder);
    const loaded=await page.evaluate(()=>document.querySelector('#documentPill').title);assert.ok(loaded.toLowerCase().startsWith(canonicalFolder.toLowerCase()),loaded);
    cases.push('Switch into project script through native bridge');
    await page.locator('#workspaceButton').click();await page.locator('#workspaceProject').click();await page.locator('#projectCast').waitFor();
    await page.locator('#projectCast').fill('Local edit that must not replace external edits');
    const external={...manifest,title:'Externally changed project'};await fs.writeFile(path.join(folder,'project.azkproj'),JSON.stringify(external));
    await page.getByRole('button',{name:'Save bible',exact:true}).click();await page.locator('.toast:has-text("changed outside")').waitFor();
    assert.equal(JSON.parse(await fs.readFile(path.join(folder,'project.azkproj'),'utf8')).title,'Externally changed project');
    cases.push('Stale project save cannot overwrite an external edit');
    await page.keyboard.press('Escape');
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
    assert.equal(await page.evaluate(()=>window.azkript.stageUpdate()),null);
    assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.isVisible())),[false]);
    assert.deepEqual(errors,[]);cases.push('Cancelled update picker and all windows remain hidden');
    console.log('PASS: hidden desktop workspace: '+cases.join('; '));
    await fs.mkdir(path.join(root,'reports/workspace-upgrade'),{recursive:true});await fs.writeFile(path.join(root,'reports/workspace-upgrade/desktop.json'),JSON.stringify({cases,passed:true},null,2));
  }catch(error){if(app){const pages=await app.windows();console.error(await pages[0].evaluate(()=>({pill:document.querySelector('#documentPill').title,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.innerText),toasts:document.querySelector('#toastStack').innerText})));}throw error;}
  finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
