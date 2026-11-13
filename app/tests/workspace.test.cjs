'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../js/model'),T=require('../js/workspace-tools');
test('unified search filters notes, tags, beats, scenes and cast with literal AND terms',()=>{
  const d=M.sampleDocument();d.workspaceNotes=[{id:'n',title:'Continuity',text:'red bicycle',paragraphId:d.paragraphs[0].id}];
  d.paragraphs[1].tags=['red bicycle'];d.beats=[{id:'b',title:'Bicycle',text:'red bicycle returns'}];
  assert.deepEqual(new Set(T.search(d,'red bicycle').rows.map(r=>r.kind)),new Set(['note','tag','beat']));
  assert.equal(T.search(d,'bicycle','note').rows.length,1);assert.equal(T.search(d,'[').total,0);
  assert.equal(T.search(d,'').total,0);
});
test('bulk scene operations are immutable, retain text/metadata and assign fresh clone identities',()=>{
  const d=M.sampleDocument(),s=M.getScenes(d),snapshot=JSON.stringify(d);
  const result=T.sceneOperation(d,'duplicate',[s[0].id,s[1].id]);
  assert.equal(new Set(result.doc.paragraphs.map(p=>p.id)).size,result.doc.paragraphs.length);
  assert.equal(JSON.stringify(d),snapshot);assert.equal(M.getScenes(result.doc).length,s.length+2);
  const merge=T.sceneOperation(d,'merge',[s[0].id,s[1].id]).doc;
  assert.deepEqual(merge.paragraphs.map(M.paragraphText),d.paragraphs.map(M.paragraphText));
  assert.equal(M.getScenes(merge).length,s.length-1);
  assert.throws(()=>T.sceneOperation(d,'merge',[s[0].id,s[2].id]),/adjacent/);
  const up=T.sceneOperation(d,'move-up',[s[1].id]).doc;assert.equal(M.getScenes(up)[0].id,s[1].id);
  const down=T.sceneOperation(d,'move-down',[s[0].id]).doc;assert.equal(M.getScenes(down)[1].id,s[0].id);
  assert.ok(T.sceneOperation(d,'omit',[s[0].id]).doc.paragraphs[0].scene.omit);
});
test('scene split refuses dialogue and dual-dialogue boundaries and native graph duplication',()=>{
  const d=M.sampleDocument(),s=M.getScenes(d)[0];
  const action=d.paragraphs.find(p=>p.type==='Action');
  assert.equal(M.getScenes(T.sceneOperation(d,'split',[s.id],{paragraphId:action.id,title:'EXT. ROAD - DAY'}).doc).length,M.getScenes(d).length+1);
  assert.throws(()=>T.sceneOperation(d,'split',[s.id],{paragraphId:d.paragraphs.find(p=>p.type==='Dialogue').id}),/character cue/);
  d.sourceFDX={xml:'<FinalDraft><Cast/></FinalDraft>'};assert.throws(()=>T.sceneOperation(d,'duplicate',[s.id]),/reference graphs/);
});
test('semantic comparison groups changed dialogue by stable scene and speaker',()=>{
  const d=M.sampleDocument(),next=M.cloneDocument(d),p=next.paragraphs.find(p=>p.type==='Dialogue');p.html='A completely new speech.';
  const diff=T.semanticCompare(d,next);assert.equal(diff.scenes.length,1);assert.equal(diff.characters.length,1);
  assert.match(diff.characters[0].after,/completely new/);assert.equal(diff.counts.changed,1);
  next.workspaceNotes=[{id:'n',text:'New note'}];assert.ok(T.semanticCompare(d,next).metadataChanged.includes('workspaceNotes'));
});
test('project manifests refuse absolute, traversing and duplicate file names',()=>{
  const input={format:'azkript-project',version:1,scripts:[],bible:{cast:'Mara'}};
  for(const p of ['../script.fdx','C:/script.fdx','/script.fdx','folder\\script.fdx','x//script.fdx','script.fdxt'])
    assert.throws(()=>T.project({...input,scripts:[{path:p}]}));
  assert.throws(()=>T.project({...input,scripts:[{path:'a.fdx'},{path:'A.fdx'}]}),/Duplicate/);
  assert.equal(T.project({...input,scripts:[{path:'episodes/one.fdx'}]}).bible.cast,'Mara');
});
