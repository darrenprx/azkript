'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ProjectStore}=require('../project-store');const R=require('../release-tools');
test('projects create, save shared bible, add independent scripts and reject stale changes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-project-'));
  try{
    const store=new ProjectStore();let p=await store.open(root,true);
    p.manifest.bible.cast='Mara: engineer';p=await store.save({manifest:p.manifest,expectedIdentity:p.identity,script:{title:'Episode 1',contents:'<FinalDraft><Content/></FinalDraft>'}});
    assert.equal(p.manifest.scripts.length,1);assert.match(await fs.readFile(await store.script(p.manifest.scripts[0].path),'utf8'),/FinalDraft/);
    assert.equal((await new ProjectStore().open(root)).manifest.bible.cast,'Mara: engineer');
    await assert.rejects(()=>store.save({manifest:p.manifest,expectedIdentity:'stale'}),/outside/);
    await assert.rejects(()=>store.script('../outside.fdx'),/not listed/);
    await assert.rejects(()=>store.open(root,true),/exist/i);
    assert.equal((await store.read()).manifest.scripts.length,1);
    const outside=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-outside-'));
    try{await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>store.resolve('linked/outside.fdx'),/links/);}finally{await fs.rm(path.join(root,'linked'),{force:true,recursive:true});await fs.rm(outside,{recursive:true,force:true});}
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('update/rollback stage only matching versions, exact hashes and a pinned valid publisher',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-release-')),thumb='a'.repeat(40),bytes=Buffer.from('synthetic signed installer');
  try{
    const file='Azkript-Setup-1.2.0.exe';await fs.writeFile(path.join(root,file),bytes);
    const manifest={format:'azkript-release',schemaVersion:1,version:'1.2.0',artifacts:[{file,sha256:R.sha256(bytes),size:bytes.length}]};
    const manifestPath=path.join(root,'release.json');await fs.writeFile(manifestPath,JSON.stringify(manifest));
    const verified={status:'Valid',thumbprint:thumb,productName:'Azkript',productVersion:'1.2.0'};
    const options={manifestPath,currentVersion:'1.1.0',directory:path.join(root,'staged'),trustedThumbprint:thumb,verifySignature:async()=>({...verified})};
    const update=await R.stageRelease(options);assert.equal(update.version,'1.2.0');assert.deepEqual(await fs.readFile(update.path),bytes);
    assert.equal((await R.stageRelease({...options,currentVersion:'1.3.0',rollback:true})).version,'1.2.0');
    await assert.rejects(()=>R.stageRelease({...options,currentVersion:'1.2.0'}),/newer/);
    await assert.rejects(()=>R.stageRelease({...options,rollback:true}),/earlier/);
    await assert.rejects(()=>R.stageRelease({...options,trustedThumbprint:''}),/signing identity/);
    await assert.rejects(()=>R.stageRelease({...options,verifySignature:async()=>({status:'NotSigned',thumbprint:thumb})}),/signature/);
    await assert.rejects(()=>R.stageRelease({...options,verifySignature:async()=>({status:'Valid',thumbprint:'b'.repeat(40)})}),/signature/);
    await assert.rejects(()=>R.stageRelease({...options,verifySignature:async()=>({...verified,productVersion:'1.1.0'})}),/product\/version/);
    await assert.rejects(()=>R.stageRelease({...options,verifySignature:async()=>({...verified,productName:'Another application'})}),/product\/version/);
    await fs.appendFile(path.join(root,file),'tampered');await assert.rejects(()=>R.stageRelease(options),/hash\/size/);
    assert.equal(R.compareVersions('1.10.0','1.2.0'),1);assert.throws(()=>R.version('1.2.0-beta'));
    assert.throws(()=>R.validateManifest({...manifest,artifacts:[{...manifest.artifacts[0],file:'../setup.exe'}]}),/path/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a project write cannot cross folders or commit a manifest larger than its reader accepts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'azkript-project-transaction-'));
  try {
    const store = new ProjectStore();
    const other = path.join(root, 'other');
    await fs.mkdir(other);
    const original = await store.open(root, true);
    await fs.copyFile(path.join(root, 'project.azkproj'), path.join(other, 'project.azkproj'));
    await store.open(other);
    const payload = { manifest: original.manifest, expectedRoot: original.root, expectedIdentity: original.identity };
    await assert.rejects(store.save(payload), /active project changed/);
    await store.open(root);
    const scripts = Array.from({ length: 4500 }, (_, index) => ({ path: `script-${index}.fdx`, title: 'x'.repeat(200) }));
    await assert.rejects(store.save({ ...payload, manifest: { ...original.manifest, scripts },
      script: { title: 'New script', contents: '<FinalDraft><Content/></FinalDraft>' } }), /1 MB limit/);
    assert.equal((await store.read()).identity, original.identity);
    assert.deepEqual((await fs.readdir(root)).sort(), ['other', 'project.azkproj']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
