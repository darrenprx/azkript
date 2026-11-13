'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../js/model'),P=require('../js/pagination'),T=require('../js/production-tools');
function fixture(){const d=M.blankDocument();d.titlePage.enabled=false;d.paragraphs=[];for(let i=1;i<=3;i++){const p=M.makeParagraph('Scene Heading',`INT. ROOM ${i} - DAY`);p.pageBreakBefore=i>1;d.paragraphs.push(p,M.makeParagraph('Action',`Unique action on issued page ${i}.`),M.makeParagraph('Character','MARA'),M.makeParagraph('Dialogue',`Line ${i} goes here.`));}return d;}
test('25: issued pages remain identical, overflow gets A/B, later pages stay fixed, and deletions become omitted',()=>{
  const doc=T.lock(fixture()),layout=P.layout(doc);assert.deepEqual(layout.pages.map(p=>p.label),['1','2','3']);assert.equal(T.revisions(doc).pages.length,0);
  const inserted=M.makeParagraph('Action','Expansion '.repeat(1400));doc.paragraphs.splice(4,0,inserted);
  const expanded=P.layout(doc);assert.ok(expanded.pages.some(p=>p.label==='1A'));assert.equal(expanded.pages.find(p=>p.label==='2').blocks[0].paragraph.id,doc.paragraphs[5].id);
  assert.ok(T.preflight(doc,expanded).ok,JSON.stringify(T.preflight(doc,expanded)));
  doc.paragraphs=doc.paragraphs.filter(p=>!doc.production.lock.pages[1].fragments.some(f=>f.id===M.toUuid(p.id)));
  assert.equal(P.layout(doc).pages.find(p=>p.label==='2').omitted,true);
  const packet=T.revisions(doc);assert.ok(packet.rows.some(r=>r.page==='2'&&r.omitted));assert.ok(packet.rows.some(r=>r.page==='1A'));
});
test('25: paragraph spanning pages retains every character under expansion and deletion',()=>{
  const d=fixture();d.paragraphs[1].html='Original '.repeat(2000);let doc=T.lock(d);
  assert.equal(T.revisions(doc).pages.length,0);doc.paragraphs[1].html='Inserted '.repeat(100)+doc.paragraphs[1].html;
  assert.ok(T.preflight(doc,P.layout(doc)).ok,JSON.stringify(T.preflight(doc,P.layout(doc))));
  doc.paragraphs[1].html='Shortened.';assert.ok(T.preflight(doc,P.layout(doc)).ok);
  doc.page.height=12;assert.throws(()=>P.layout(doc),/geometry/);
});
test('25: scene numbers persist across insertions and issued movement is refused',()=>{
  let d=T.lock(fixture());d.paragraphs.splice(4,0,M.makeParagraph('Scene Heading','EXT. INSERT - NIGHT'));
  assert.deepEqual(M.getScenes(d).map(s=>s.number),['1','1A','2','3']);assert.ok(P.layout(d).pages.flatMap(p=>p.blocks).some(b=>b.sceneNumber==='1A'));
  d=T.numberScenes(d);assert.deepEqual(M.getScenes(d).map(s=>s.number),['1','1A','2','3']);
  const p=d.paragraphs.splice(1,1)[0];d.paragraphs.push(p);assert.throws(()=>P.layout(d),/reordered/);
});
test('25: long dual dialogue does not create insertion pages merely by locking, and omitted scenes retain all base pages',()=>{
  const d=fixture();d.paragraphs=d.paragraphs.slice(0,1);
  d.paragraphs.push(M.makeParagraph('Character','ALICE',{dualGroup:'pair',dualSide:0}),M.makeParagraph('Dialogue','Left column longer line. '.repeat(100),{dualGroup:'pair',dualSide:0}),M.makeParagraph('Character','BOB',{dualGroup:'pair',dualSide:1}),M.makeParagraph('Dialogue','Right column line. '.repeat(80),{dualGroup:'pair',dualSide:1}));
  const original=P.layout(d).scriptPageCount,locked=T.lock(d),result=P.layout(locked);assert.equal(result.scriptPageCount,original);assert.ok(result.pages.every(p=>/^\d+$/.test(p.label)));assert.ok(T.preflight(locked,result).ok);
  locked.paragraphs[0].scene.omit=true;const omitted=P.layout(locked);assert.equal(omitted.scriptPageCount,original);assert.ok(omitted.pages.every(p=>p.omitted));assert.ok(T.preflight(locked,omitted).ok);
});
test('25: continued dialogue keeps MORE/CONT\'D markers, and custom starting folios stay stable',()=>{
  const d=fixture();d.paragraphs=d.paragraphs.slice(0,4);d.paragraphs[3].html='Long dialogue continues here. '.repeat(300);d.headerFooter.startingPage=12;
  const locked=T.lock(d),result=P.layout(locked);assert.equal(result.pages[0].label,'12');assert.equal(result.pages[0].blocks.at(-1).kind,'more');assert.ok(result.pages[1].blocks[0].continuation);assert.ok(T.preflight(locked,result).ok);
});
test('26: revision packet has precise actual pages/scenes and deletion notices without requiring revision marks',()=>{
  const d=T.lock(fixture());d.paragraphs[5].html='Changed action.';const r=T.revisions(d);
  assert.deepEqual(r.rows.map(p=>p.page),['2']);assert.deepEqual(r.rows[0].scenes,['2']);assert.match(r.summary,/Changed pages: 2/);
  d.paragraphs.splice(4,4);assert.equal(T.revisions(d).pages[0].omitted,true);
});
test('26: successive revision baselines retain insertion labels and emit withdrawn insertion notices',()=>{
  let d=T.lock(fixture());const p=M.makeParagraph('Action','Expansion '.repeat(900));d.paragraphs.splice(4,0,p);assert.ok(T.revisions(d).pages.some(p=>p.label==='1A'));
  d=T.revisionBaseline(d);assert.equal(T.revisions(d).pages.length,0);d.paragraphs=d.paragraphs.filter(item=>item.id!==p.id);
  const packet=T.revisions(d);assert.ok(packet.removedPages.includes('1A'));assert.ok(packet.pages.some(p=>p.label==='1A'&&p.omitted&&p.withdrawn));
});
test('27/28: native-tag model, breakdown CSV, character/location and shot handoffs include actual page references',()=>{
  let d=fixture();for(const c of T.categories)d=T.tag(d,d.paragraphs[1].id,c,'Copper, key');
  const rows=T.breakdown(d);assert.equal(rows.length,6);assert.equal(rows[0].pages,'1');assert.match(T.csv(rows),/"Copper, key"/);
  assert.match(T.handoff(d,'character sides','MARA').text,/SCENE 3/);assert.doesNotMatch(T.handoff(d,'character sides','OTHER').text,/SCENE 1/);
  assert.match(T.handoff(d,'location scenes','ROOM 2').text,/SCENE 2/);assert.doesNotMatch(T.handoff(d,'location scenes','ROOM 2').text,/SCENE 1/);
  assert.doesNotMatch(T.handoff(d,'dialogue only').text,/Unique action/);
  d.paragraphs.splice(2,0,M.makeParagraph('Shot','CLOSE ON THE KEY'));assert.match(T.handoff(d,'shots').text,/SHOT: CLOSE ON THE KEY \[page 1\]/);
});
test('29: preflight detects missing text, coverage, size, fonts, overflow and revision colors',()=>{
  const d=fixture(),l=P.layout(d);assert.ok(T.preflight(d,l).ok);
  l.pages[0].blocks=[];l.pages[1].lineCount=9000;d.page.width=0;d.revision.history[0].hex='invalid';
  const codes=T.preflight(d,l,{missingFonts:['Unknown'],domIssues:['clipped']}).issues.map(i=>i.code);
  for(const c of ['missing-text','text-coverage','page-size','overflow','revision-color','font','rendered-overflow'])assert.ok(codes.includes(c),c);
});
test('30: Fountain and structured imports expose inferred elements and round-trip text without HTML injection',()=>{
  const d=fixture(),f=T.exportText(d);const r=T.importText(f);assert.deepEqual(r.doc.paragraphs.map(p=>p.type),d.paragraphs.map(p=>p.type));assert.deepEqual(r.doc.paragraphs.map(M.paragraphText),d.paragraphs.map(M.paragraphText));
  d.paragraphs.push(M.makeParagraph('Custom','&lt;script&gt;\nSecond line'));
  const s=T.importText(T.exportText(d,'structured'),'structured');assert.deepEqual(s.doc.paragraphs.map(M.paragraphText),d.paragraphs.map(M.paragraphText));assert.equal(s.doc.paragraphs.at(-1).type,'Custom');assert.doesNotMatch(s.doc.paragraphs.at(-1).html,/<script>/);
  assert.throws(()=>T.importText('x','structured'),/header/);
});
test('31: scene timing, literal pronunciation and speaker profiles are deterministic and omit omitted scenes',()=>{
  const d=fixture();d.production.read={wordsPerMinute:120,pronunciations:{'Line':'Lynn','Lynn':'WRONG'},profiles:{MARA:{voice:'Test voice',rate:1.2,pitch:0.8}}};
  const r=T.readPlan(d);assert.equal(r.scenes.length,3);assert.match(r.items.find(i=>i.speaker==='MARA').text,/Lynn/);assert.doesNotMatch(r.items.find(i=>i.speaker==='MARA').text,/WRONG/);assert.equal(r.items.find(i=>i.speaker==='MARA').profile.voice,'Test voice');
  d.paragraphs[4].scene.omit=true;assert.equal(T.readPlan(d).scenes.length,2);assert.equal(T.readPlan(d).seconds,T.readPlan(d).seconds);
});
test('32: review role is enforced on owner import, approval invalidates on edits and clean copies remove private data',()=>{
  let d=fixture();d.workspaceNotes=[{id:'note',title:'Private',text:'Secret'}];d.paragraphs[0].scene.notes='private';
  const invite=T.invite(d,'reader');assert.throws(()=>T.applyResponse(invite.doc,{kind:'azkript-response',version:1,token:invite.packet.token,copyFingerprint:invite.packet.fingerprint,author:'Reviewer',body:'Forged comment'}),/Read-only/);
  const c=T.invite(d,'commenter'),response=T.respond(c.packet,{author:'Sam',body:'Check prop',paragraphId:c.packet.draft.paragraphs[1].id});d=T.applyResponse(c.doc,response);assert.equal(d.production.review.comments.length,1);assert.throws(()=>T.approve(d,'Owner','owner'),/Resolve/);
  assert.throws(()=>T.applyResponse(d,response),/consumed/);d.production.review.comments[0].resolved=true;
  const a=T.invite(d,'approver');d=T.applyResponse(a.doc,T.respond(a.packet,{author:'Sam',approve:true}));assert.ok(T.approvalValid(d));d.paragraphs[1].html+=' edit';assert.equal(T.approvalValid(d),false);
  const clean=T.reviewCopy(d);assert.deepEqual(clean.production,{});assert.deepEqual(clean.workspaceNotes,[]);assert.equal(clean.paragraphs[0].scene.notes,'');
  const stale=T.invite(d,'commenter');stale.doc.paragraphs[1].html+=' edit';assert.throws(()=>T.applyResponse(stale.doc,T.respond(stale.packet,{author:'Sam',body:'stale'})),/changed draft/);
});
