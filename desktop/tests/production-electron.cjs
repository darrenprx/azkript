'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),{_electron}=require(path.join(root,'node_modules/playwright-core'));
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-production-e2e-')),report=path.join(root,'reports/production-upgrade');let app;
 const env={...process.env,AZKRIPT_USER_DATA:path.join(temp,'profile'),AZKRIPT_TEST_BACKGROUND:'1'};delete env.ELECTRON_RUN_AS_NODE;
 try{
  app=await _electron.launch({executablePath:process.env.AZKRIPT_TEST_EXECUTABLE||path.join(root,'node_modules/electron/dist/electron.exe'),args:[...(process.env.AZKRIPT_TEST_EXECUTABLE?[]:['.']),'--mute-audio','--disable-gpu','--disable-renderer-backgrounding'],cwd:root,env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('#productionToolsButton').waitFor();await page.locator('#startCenterClose').click();
  const tool=async id=>{if(await page.locator('#appDialog').evaluate(e=>e.open))await page.keyboard.press('Escape');await page.locator('#productionToolsButton').click();await page.locator('#production-'+id).click();};
  await tool('locking');await page.getByRole('button',{name:'Issue and lock pages',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#appDialog').open);
  const action=page.locator('#editor .para[data-type="Action"]').first();await action.fill('PRODUCTION PDF COPPER KEY CHECK.');await action.dispatchEvent('input');
  await tool('revisions');assert.match(await page.locator('#appDialog').innerText(),/Changed pages: [0-9]/);console.log('PASS: native revision diff sees actual edit');
  const full=path.join(temp,'full.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},full);
  await tool('preflight');await page.getByText(/Passed ·/).waitFor();await page.getByRole('button',{name:'Export PDF',exact:true}).click();await page.locator('.toast:has-text("PDF exported")').waitFor();
  const bytes=await fs.readFile(full);assert.equal(bytes.toString('ascii',0,4),'%PDF');
  const revision=path.join(temp,'revisions.pdf');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},revision);
  await tool('revisions');await page.getByRole('button',{name:'Export revision PDF',exact:true}).click();
  await page.locator('.toast:has-text("revisions.pdf is ready")').waitFor();
  assert.equal((await fs.readFile(revision)).toString('ascii',0,4),'%PDF');
  const audio=path.join(temp,'read.wav');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},audio);
  const result=await page.evaluate(()=>window.azkript.exportAudio({defaultName:'read',items:[{text:'Azkript table read. Copper key.',profile:{rate:1,pitch:1}}]}));
  assert.equal(result.canceled,false);const wav=await fs.readFile(audio);assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.ok(wav.length>1000);
  const original=path.join(temp,'original.fdx');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},original);
  await page.keyboard.press('Escape');await page.keyboard.press('Control+s');await page.waitForFunction(file=>document.querySelector('#documentPill').title===file,original);const originalBytes=await fs.readFile(original,'utf8');
  await tool('exchange');await page.locator('#exchangeText').fill('Title: Imported separate draft\n\n.INT. ROOM - DAY\n\n!A new draft.');await page.getByRole('button',{name:'Preview import',exact:true}).click();await page.getByRole('button',{name:'Apply previewed import',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#appDialog').open);
  assert.notEqual(await page.locator('#documentPill').getAttribute('title'),original);
  const imported=path.join(temp,'imported.fdx');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},imported);await page.keyboard.press('Control+s');await page.waitForFunction(file=>document.querySelector('#documentPill').title===file,imported);assert.equal(await fs.readFile(original,'utf8'),originalBytes);assert.match(await fs.readFile(imported,'utf8'),/Imported separate draft/);
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.isVisible())),[false]);assert.deepEqual(errors,[]);
  await fs.mkdir(report,{recursive:true});await fs.copyFile(full,path.join(report,'full.pdf'));await fs.copyFile(revision,path.join(report,'revisions.pdf'));
  await fs.writeFile(path.join(report,'desktop.json'),JSON.stringify({passed:true,fullPdfBytes:bytes.length,revisionPdfBytes:(await fs.stat(revision)).size,wavBytes:wav.length,hidden:true},null,2));
  console.log('PASS: hidden desktop full PDF, revision PDF, real Windows speech WAV, separate imported draft and no visible windows');
 }catch(e){if(app){const page=(await app.windows())[0];console.error(await page.evaluate(()=>({toasts:document.querySelector('#toastStack').innerText,dialog:document.querySelector('#appDialog').innerText})));}throw e;}
 finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
