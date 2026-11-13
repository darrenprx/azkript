'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const M=require('../../app/js/model'),T=require('../../app/js/story-tools'),X=require('../../app/js/fdx');
const root=path.resolve(__dirname,'../..'),{_electron}=require('playwright-core');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-story-e2e-')),file=path.join(temp,'story.fdx');let app;
 const env={...process.env,AZKRIPT_USER_DATA:path.join(temp,'profile'),AZKRIPT_TEST_BACKGROUND:'1'};delete env.ELECTRON_RUN_AS_NODE;
 try{
  let d=M.blankDocument();d.title='Native Story Studio';d.paragraphs.push(M.makeParagraph('Character','MARA'),M.makeParagraph('Dialogue','A native recorded line.'));
  d=T.lane(d,{name:'Saved native lane'});d=T.timeline(d,{laneId:T.data(d).lanes[0].id,sceneId:T.id(M.getScenes(d)[0]),start:1,end:4,goal:'Native goal'});
  d=T.captureBranch(d,'Saved native branch');await fs.writeFile(file,X.serialize(d),'utf8');
  app=await _electron.launch({executablePath:process.env.AZKRIPT_TEST_EXECUTABLE||path.join(root,'node_modules/electron/dist/electron.exe'),args:[...(process.env.AZKRIPT_TEST_EXECUTABLE?[]:['.']),file,'--mute-audio','--disable-gpu','--disable-renderer-backgrounding','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],cwd:root,env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('#storyToolsButton').waitFor();await page.waitForFunction(()=>document.querySelector('#docTitle').textContent==='Native Story Studio');
  const close=async()=>{if(await page.locator('#appDialog').evaluate(e=>e.open)){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#appDialog').open);}};
  const tool=async id=>{await close();await page.locator('#storyToolsButton').click();await page.locator('#story-'+id).click();};
  await tool('timeline');assert.match(await page.locator('#storyRoot').innerText(),/Native goal/);await page.getByText('Add a lane',{exact:true}).click();await page.locator('#laneName').fill('Desktop added lane');await page.locator('#laneAdd').click();
  await close();await page.keyboard.press('Control+s');await page.locator('#saveState.is-saved').waitFor();
  const xml=await fs.readFile(file,'utf8'),roundtrip=await page.evaluate(xml=>{const d=FDX.parse(xml);return {lanes:d.story.lanes.map(l=>l.name),preview:FDStory.previewBranch(d,d.story.branches[0].id).rows.length};},xml);
  assert.deepEqual(roundtrip.lanes,['Saved native lane','Desktop added lane']);assert.ok(roundtrip.preview);
  await tool('rehearsal');await page.locator('#rehearsalRole').selectOption('MARA');await page.locator('#rehearsalStart').click();
  await page.evaluate(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{const s=await get(constraints);window.__storyMicTracks=s.getTracks();return s;};});
  await page.locator('#rehearsalRecord').click();await page.getByText('Recording…',{exact:true}).waitFor();await close();await page.waitForFunction(()=>window.__storyMicTracks?.every(t=>t.readyState==='ended'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.keyboard.press('Control+o');await page.waitForFunction(()=>document.querySelector('#docTitle').textContent==='Native Story Studio');await tool('timeline');assert.match(await page.locator('#storyRoot').innerText(),/Desktop added lane/);
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.isVisible())),[false]);assert.deepEqual(errors,[]);
  await fs.mkdir(path.join(root,'reports/story-upgrade'),{recursive:true});await fs.writeFile(path.join(root,'reports/story-upgrade',process.env.AZKRIPT_TEST_EXECUTABLE?'packaged-desktop.json':'desktop.json'),JSON.stringify({passed:true,hidden:true,nativeFdxReopen:true,branchPreviewAfterReopen:true,microphoneStoppedOnClose:true,version:'1.2.0'},null,2));
  console.log('PASS: hidden native Story Studio, real FDX save/reopen, branch persistence and microphone cleanup');
 }catch(e){if(app){const page=(await app.windows())[0];console.error(await page.evaluate(()=>({toasts:document.querySelector('#toastStack').innerText,dialog:document.querySelector('#appDialog').innerText})));}throw e;}
 finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1;});
