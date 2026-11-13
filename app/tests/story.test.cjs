'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const M=require('../js/model'),T=require('../js/story-tools'),P=require('../js/production-tools'),W=require('../js/writing-tools');
function fixture(){const d=M.blankDocument();d.titlePage.enabled=false;d.paragraphs=[];for(let i=1;i<=3;i++)d.paragraphs.push(M.makeParagraph('Scene Heading',`INT. ROOM ${i} - DAY`),M.makeParagraph('Action',`A key is on table ${i}.`),M.makeParagraph('Character',i===2?'SAM':'MARA'),M.makeParagraph('Dialogue',`Line ${i} has a different cue.`));d.beats=[{id:'beat-one',title:'Discovery',goalPage:'12',x:24,y:24}];return M.normalizeDocument(d);}
const scenes=d=>M.getScenes(d).map(T.id);
test('33: lane resize and linked spans preserve body and identity; invalid spans cannot mutate the draft',()=>{
  const original=fixture();let d=T.lane(original,{name:'A plot',height:200});const l=T.data(d).lanes[0];
  d=T.timeline(d,{laneId:l.id,sceneId:scenes(d)[0],beatId:'beat-one',start:3,end:9,goal:'Find key'});
  assert.deepEqual(d.paragraphs,original.paragraphs);assert.equal(d.documentId,original.documentId);
  d=T.lane(d,{...l,height:320});assert.equal(T.data(d).lanes[0].height,320);
  assert.throws(()=>T.timeline(d,{laneId:l.id,sceneId:scenes(d)[0],start:9,end:2}),/End page/);
  assert.throws(()=>T.remove(d,'lanes',l.id),/events first/);assert.equal(T.data(d).timeline.length,1);
});
test('34: facts follow reordered scenes, knowledge facts coexist, cleared and omitted evidence cannot satisfy requirements',()=>{
  let d=fixture(), [a,b,c]=scenes(d);
  const add=(sceneId,state,operation,kind='knowledge')=>{d=T.fact(d,{sceneId,entity:'Mara',kind,state,operation,evidence:'On-screen evidence'});};
  add(a,'key location','establish');add(a,'door code','establish');add(b,'key location','require');add(b,'door code','require');
  assert.ok(T.continuity(d).every(f=>!f.issue));add(b,'door code','clear');add(c,'door code','require');assert.match(T.continuity(d).at(-1).issue,/before it is established/);
  d.paragraphs[0].scene.omit=true;assert.match(T.continuity(d).find(f=>f.sceneId===b).issue,/before it is established/);
  d.paragraphs=d.paragraphs.slice(4);assert.ok(T.continuity(d).some(f=>f.heading==='Missing scene'));
});
test('35: arc observations require evidence and support relationships without modifying dialogue',()=>{
  const original=fixture(),d=T.arc(original,{sceneId:scenes(original)[1],character:'Mara',other:'Sam',value:-3,evidence:'Sam hides the key.'});
  assert.equal(T.data(d).arcs[0].value,-3);assert.deepEqual(d.paragraphs,original.paragraphs);
  assert.throws(()=>T.arc(d,{sceneId:scenes(d)[0],character:'Mara',evidence:''}),/evidence/);
  assert.throws(()=>T.arc(d,{sceneId:scenes(d)[0],character:'Mara',other:'Mara',evidence:'x'}),/different/);
});
test('36: branch reorder and alternate ending leave main untouched; merge preview rejects stale edits and retains a return branch',()=>{
  const original=fixture();let d=T.captureBranch(original,'Different ending'),branch=T.data(d).branches[0];
  d=T.editBranch(d,branch.id,{sceneId:scenes(d)[2],move:-1});
  let alternate=T.branchDocument(d,branch.id);const last=scenes(alternate).at(-1);
  d=T.editBranch(d,branch.id,{sceneId:last,ending:'A new ending.\n\nThe key stays behind.'});
  assert.deepEqual(d.paragraphs,original.paragraphs);const preview=T.previewBranch(d,branch.id),merged=T.mergeBranch(d,preview);
  assert.equal(M.getScenes(merged)[1].heading,'INT. ROOM 3 - DAY');assert.match(M.paragraphText(merged.paragraphs.at(-1)),/key stays behind/);
  assert.deepEqual(T.data(merged).branches.at(-1).paragraphs,original.paragraphs);
  const back=T.previewBranch(merged,T.data(merged).branches.at(-1).id);assert.deepEqual(T.mergeBranch(merged,back).paragraphs,original.paragraphs);
  d.paragraphs[1].html='Main draft changed';assert.throws(()=>T.mergeBranch(d,preview),/main draft changed/);
});
test('36: alternate endings retain literal punctuation/newlines and Fountain dialogue elements',()=>{
  let d=T.captureBranch(fixture(),'Ending formats'),b=T.data(d).branches[0],last=scenes(d).at(-1);
  const ending='Mara & Sam <leave>.\n"Together," she says.';
  d=T.editBranch(d,b.id,{sceneId:last,ending});assert.equal(M.paragraphText(T.branchDocument(d,b.id).paragraphs.at(-1)),ending);
  d=T.editBranch(d,b.id,{sceneId:last,format:'fountain',ending:'@MARA\nKeep the key.\n\n!She leaves.'});
  assert.deepEqual(T.branchDocument(d,b.id).paragraphs.slice(-3).map(p=>p.type),['Character','Dialogue','Action']);
  assert.match(T.previewBranch(d,b.id).rows.at(-1).afterText,/Dialogue: Keep the key/);
});
test('36: branch modifications after preview, issued pagination and native retained graphs stop merge',()=>{
  let d=T.captureBranch(fixture(),'Branch'),b=T.data(d).branches[0],preview=T.previewBranch(d,b.id);
  d=T.editBranch(d,b.id,{sceneId:scenes(d)[0],omit:true});assert.throws(()=>T.mergeBranch(d,preview),/stale/);
  const issued=P.lock(fixture());const locked=T.captureBranch(issued,'Issued');assert.throws(()=>T.previewBranch(locked,T.data(locked).branches[0].id),/Unlock/);
  d.nativeMetadata=[{name:'TagData',xml:'<TagData/>'}];d=T.captureBranch(d,'Native branch');assert.throws(()=>T.previewBranch(d,T.data(d).branches.at(-1).id),/native production/);
});
test('37: unscored scenes stay unscored; linked beat intensity and explicit scene intensity are separate from dialogue density',()=>{
  let d=fixture(),a=scenes(d)[0];assert.equal(T.sceneRows(d)[0].intensity,null);
  d=T.lane(d,{name:'Story'});d=T.timeline(d,{laneId:T.data(d).lanes[0].id,sceneId:a,beatId:'beat-one',start:1,end:2});
  d=T.pacing(d,{beatId:'beat-one',intensity:8});assert.equal(T.sceneRows(d)[0].intensity,8);
  d=T.pacing(d,{sceneId:a,intensity:2});const row=T.sceneRows(d)[0];assert.equal(row.intensity,2);assert.ok(row.dialogueDensity>0&&row.dialogueDensity<1);assert.ok(row.seconds>0);assert.ok(row.pages);
});
test('38: media is embedded, validated and bounded; animatics sort scene/shot order and exclude omitted scenes',()=>{
  let d=fixture(),result=T.media(d,{data:'data:image/png;base64,iVBORw0KGgo=',name:'Frame',credit:'Own work'});d=result.document;
  const [a,b]=scenes(d);d=T.shot(d,{sceneId:b,title:'Later scene',assetId:result.assetId,seconds:4,order:1});d=T.shot(d,{sceneId:a,title:'Opening',seconds:2,order:0});
  assert.deepEqual(T.animatic(d).map(s=>[s.title,s.start,s.end]),[['Opening',0,2],['Later scene',2,6]]);
  d.paragraphs[0].scene.omit=true;assert.equal(T.animatic(d).length,1);assert.throws(()=>T.remove(d,'assets',result.assetId),/linked shots/);
  assert.throws(()=>T.media(d,{data:'data:image/svg+xml;base64,PHN2Zz4='}),/PNG/);assert.throws(()=>T.media(d,{data:'data:image/png;base64,'+'A'.repeat(T.MEDIA_BUDGET)}),/budget/);
});
test('39: role prompts retain partner cues, adjust silence and attach takes to stable dialogue identities',()=>{
  let d=fixture(),plan=T.rehearsal(d,'Mara',5);assert.deepEqual(plan.map(p=>p.own),[true,false,true]);
  assert.equal(plan[0].seconds-T.rehearsal(d,'Mara',0)[0].seconds,5);
  const media=T.media(d,{data:'data:audio/webm;base64,GkXfo0Ag',name:'Take'});d=T.recording(media.document,{paragraphId:plan[0].paragraphId,assetId:media.assetId,actor:'Actor'});
  assert.equal(T.data(d).recordings[0].transcript,plan[0].text);assert.throws(()=>T.recording(d,{paragraphId:scenes(d)[0],assetId:media.assetId}),/dialogue/);
  d.paragraphs[0].scene.omit=true;assert.equal(T.rehearsal(d,'Mara').length,2);
});
test('40: rewrite impact follows transitive links, detects changed scene content, handles missing scenes and acknowledgments',()=>{
  let d=fixture(),a=scenes(d)[0];d=T.node(d,{sceneId:a,kind:'asset',title:'Copper key'});const asset=T.data(d).nodes.at(-1);
  d=T.node(d,{sceneId:scenes(d)[1],kind:'schedule',title:'Key pickup',date:'2026-11-08'});const schedule=T.data(d).nodes.at(-1);
  d=T.link(d,{from:asset.id,to:schedule.id,label:'needed for'});assert.equal(T.impact(d,a).length,3);
  assert.throws(()=>T.link(d,{from:asset.id,to:asset.id}),/different/);
  d.paragraphs[1].html='Key changes to silver.';assert.ok(T.graph(d).nodes.find(n=>n.id===asset.id).changed);
  d=T.acknowledge(d,asset.id);assert.equal(T.graph(d).nodes.find(n=>n.id===asset.id).changed,false);
  d=T.shot(d,{sceneId:a,title:'Key insert',seconds:2});const shot=T.data(d).shots[0];d.paragraphs[1].html='A different key insert.';
  assert.equal(T.graph(d).nodes.find(n=>n.id===shot.id).changed,true);d=T.acknowledge(d,shot.id);assert.equal(T.graph(d).nodes.find(n=>n.id===shot.id).changed,false);
  d.paragraphs=d.paragraphs.slice(4);assert.ok(T.graph(d).nodes.find(n=>n.id===asset.id).missing);assert.ok(T.graph(d).edges.some(e=>e.missing));
});
test('story changes are recoverable metadata and clean review exports remove branches, images and recordings',()=>{
  const original=fixture(),d=T.captureBranch(T.lane(original,{name:'Private plan'}),'Private ending');
  assert.deepEqual(M.cloneDocument(d).story,d.story);assert.ok(W.compareDocuments(original,d).metadataChanged.includes('story'));
  assert.deepEqual(P.reviewCopy(d).story,{});assert.doesNotMatch(JSON.stringify(P.invite(d,'reader').packet),/Private ending|Private plan/);
});
