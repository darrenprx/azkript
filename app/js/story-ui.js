/* Story tools use the shared history, modal, scene navigation and saved model. */
window.FDStoryUI = function (host) {
  'use strict';
  const { state, openDialog, closeDialog, toast } = host, T = FDStory, M = FDModel, E = M.escapeHtml;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  let dispose = () => {}, rowCache = null;
  const sdata = () => T.data(state.doc);
  function rows() {
    if (!rowCache || rowCache.document !== state.doc || rowCache.version !== state.editVersion)
      rowCache = { document: state.doc, version: state.editVersion, rows: T.sceneRows(state.doc, host.layoutOptions()) };
    return rowCache.rows;
  }
  function safe(fn) { return (...args) => { try { const result = fn(...args); if (result?.catch) result.catch(error); return result; } catch (e) { error(e); } }; }
  function error(e) { toast('Story action needs attention', e.message || String(e), 'error', 6500); }
  function change(doc, body = false) {
    state.history.finishBurst(); state.doc = M.normalizeDocument(doc); host.markDirty({layout:body});
    if (body) host.renderAll(); else host.refreshPlanning();
    state.history.record();
  }
  function bind(selector, fn) { $$(selector).forEach(el => el.onclick = safe(() => fn(el))); }
  function value(id) { return $('#'+id).value; }
  function field(label, id, content = '', attrs = '') { return `<label class="field"><span>${E(label)}</span><input class="input" id="${id}" value="${E(String(content))}" ${attrs}></label>`; }
  function select(label, id, options) { return `<label class="field"><span>${E(label)}</span><select class="input" id="${id}">${options}</select></label>`; }
  const option = (id, label) => `<option value="${E(String(id))}">${E(String(label))}</option>`;
  const choices = list => list.map(x => option(x,x)).join('');
  function sceneSelect(id = 'storyScene', list = rows()) { return select('Linked scene', id, list.map(s => option(s.key || T.id(s), `${s.number || s.index} · ${s.heading}${s.pages ? ' · p. '+s.pages : ''}${s.omit ? ' · omitted' : ''}`)).join('')); }
  function jump(sceneId) {
    const sc = M.getScenes(state.doc).find(s => T.id(s) === sceneId);
    if (!sc) return error(new Error('The linked scene is missing.'));
    closeDialog(() => { host.setView('script'); host.setMode('write'); host.focusParagraph(sc.id,'start'); });
  }
  function sceneButton(sceneId, label = 'Open scene') { return `<button class="btn" data-story-jump="${E(sceneId)}">${E(label)}</button>`; }
  function deleteButton(collection, id) { return `<button class="btn" data-story-remove="${collection}" data-row="${E(id)}">Remove</button>`; }
  const actions = [ ['timeline','Story timeline',timeline], ['continuity','Continuity map',continuity],
    ['arcs','Character arcs and relationships',arcs], ['branches','Alternate orders and endings',branches],
    ['pacing','Tension and pacing',pacing], ['storyboard','Storyboard and animatic',storyboard],
    ['rehearsal','Rehearsal and recordings',rehearsal], ['graph','Production graph',graph] ];
  function show(title, body, extra = []) {
    dispose();
    openDialog({ title, eyebrow:'Story studio · 1.2.0', wide:true, body:`<div id="storyRoot" class="story-studio">${body}</div>`,
      actions:[{label:'Story studio',keepOpen:true,onClick:hub}, ...extra.map(a => ({keepOpen:true,...a,onClick:safe(a.onClick)})), {label:'Close'}] });
    const root = $('#storyRoot'), cleanup = [];
    const observer = new MutationObserver(() => {
      if (!root.isConnected || !$('#appDialog').open || $('#appDialog').classList.contains('is-closing')) dispose();
    });
    observer.observe($('#appDialog'),{childList:true,subtree:true,attributes:true,attributeFilter:['open','class']});
    dispose = () => { observer.disconnect(); cleanup.splice(0).forEach(fn => fn()); };
    bind('[data-story-jump]', el => jump(el.dataset.storyJump));
    return fn => cleanup.push(fn);
  }
  function removals(refresh) { bind('[data-story-remove]', el => { change(T.remove(state.doc,el.dataset.storyRemove,el.dataset.row)); refresh(); }); }
  function hub() {
    show('Story studio', `<p>Plan structure, track scene evidence, explore alternate drafts and follow production dependencies.</p><div class="story-hub">${actions.map(([id,label]) => `<button class="btn" id="story-${id}">${E(label)}</button>`).join('')}</div><p class="dialog-note">Story planning and embedded media travel in Azkript’s FDX data. Other editors may discard them.</p>`);
    actions.forEach(([id,,fn]) => $('#story-'+id).onclick = safe(fn));
  }
  function timelineLane(lane, entries, beats, maximum) {
    const ends=[],events=entries.filter(e=>e.laneId===lane.id).slice().sort((a,b)=>a.start-b.start).map(e=>{
      let level=ends.findIndex(end=>end<e.start);if(level<0)level=ends.length;ends[level]=e.end;
      return `<div class="story-event" data-event="${E(e.id)}" style="top:${level*42+4}px;left:${(e.start-1)/maximum*100}%;width:${Math.max(1,e.end-e.start+1)/maximum*100}%"><button class="story-event__handle" data-edge="start" aria-label="Resize start of ${E(e.goal||'event')}">‹</button><button class="story-event__label" data-story-jump="${E(e.sceneId)}">${E(e.goal||beats.get(e.beatId)?.title||'Scene')}<small>p. ${e.start}–${e.end}${beats.get(e.beatId)?.goalPage?' · beat goal '+E(beats.get(e.beatId).goalPage):''}</small></button><button class="story-event__handle" data-edge="end" aria-label="Resize end of ${E(e.goal||'event')}">›</button></div>`;
    });
    return `<section class="story-lane" style="height:${lane.height}px" data-lane="${E(lane.id)}"><header><strong>${E(lane.name)}</strong><label>Height <input type="range" min="80" max="360" value="${lane.height}" aria-label="${E(lane.name)} lane height" data-lane-height="${E(lane.id)}"></label>${deleteButton('lanes',lane.id)}</header><div class="story-lane__viewport"><div class="story-lane__track" style="height:${Math.max(1,ends.length)*42+8}px">${events.join('')}</div></div></section>`;
  }
  function timeline() {
    const s = sdata(), scenes = rows(), beats = new Map(state.doc.beats.map(b => [b.id,b]));
    const maximum = Math.max(10, ...s.timeline.map(e => e.end), ...scenes.map(sc => Number(sc.pages.split(',')[0]) || 1));
    const cleanup = show('Interactive story timeline', `<p>Scene links use current pages. Planned spans and beat goal pages remain writer-controlled. Drag an event to move it; use its handles to resize. Keyboard fields provide the same controls.</p>
      <div class="workspace-actions">${scenes.map(sc => sceneButton(sc.key,`${sc.number} · p. ${sc.pages || '—'}`)).join('')}</div>
      <div class="story-timeline" style="--timeline-pages:${maximum}">${s.lanes.map(l=>timelineLane(l,s.timeline,beats,maximum)).join('') || '<p>Add a lane, then add scene events.</p>'}</div>
      <details><summary>Add a lane</summary>${field('Lane name','laneName')}<button class="btn" id="laneAdd">Add lane</button></details>
      <div class="field-grid">${select('Event','eventEdit',option('','New event')+s.timeline.map(e=>option(e.id,e.goal||'Scene event')).join(''))}${select('Lane','eventLane',s.lanes.map(l=>option(l.id,l.name)).join(''))}${sceneSelect()}${select('Beat','eventBeat',option('','No linked beat')+state.doc.beats.map(b=>option(b.id,b.title)).join(''))}${field('Start page','eventStart',1,'type="number" min="1" max="10000"')}${field('End page','eventEnd',2,'type="number" min="1" max="10000"')}</div>${field('Beat goal / event label','eventGoal','', 'maxlength="500"')}`,
      [{label:'Save timeline event',kind:'primary',onClick:()=>{change(T.timeline(state.doc,{id:value('eventEdit'),laneId:value('eventLane'),sceneId:value('storyScene'),beatId:value('eventBeat'),start:value('eventStart'),end:value('eventEnd'),goal:value('eventGoal')}));timeline();}},
        {label:'Remove selected event',onClick:()=>{change(T.remove(state.doc,'timeline',value('eventEdit')));timeline();}}]);
    $('#laneAdd').onclick = safe(()=>{change(T.lane(state.doc,{name:value('laneName')}));timeline();});
    $('#eventEdit').onchange = () => {const e=s.timeline.find(e=>e.id===value('eventEdit'));if(e)for(const [key,id]of Object.entries({laneId:'eventLane',sceneId:'storyScene',beatId:'eventBeat',start:'eventStart',end:'eventEnd',goal:'eventGoal'}))$('#'+id).value=e[key];};
    $$('[data-lane-height]').forEach(input=>{input.oninput=()=>input.closest('.story-lane').style.height=input.value+'px';input.onchange=safe(()=>{change(T.lane(state.doc,{...s.lanes.find(l=>l.id===input.dataset.laneHeight),height:input.value}));});});
    $$('[data-event]').forEach(el => {
      let drag, suppressClick=false;
      el.onpointerdown = event => {
        if (event.button !== 0) return;
        suppressClick=false;
        event.preventDefault();
        el.setPointerCapture(event.pointerId);
        const item=s.timeline.find(e=>e.id===el.dataset.event), track=el.parentElement;
        drag={x:event.clientX,item,edge:event.target.dataset.edge,width:track.getBoundingClientRect().width,moved:false,version:state.editVersion};
      };
      el.onpointermove = event => {
        if(!drag)return;const delta=Math.round((event.clientX-drag.x)/drag.width*maximum);if(!delta&&!drag.moved)return;
        drag.moved=true;suppressClick=true;el.setPointerCapture(event.pointerId);
        const start=drag.edge==='end'?drag.item.start:Math.max(1,drag.item.start+delta),end=drag.edge==='start'?drag.item.end:Math.max(start,drag.item.end+delta);
        drag.next={...drag.item,start:Math.min(start,end),end};el.style.left=(drag.next.start-1)/maximum*100+'%';el.style.width=(drag.next.end-drag.next.start+1)/maximum*100+'%';
      };
      el.onpointerup = safe(()=>{const d=drag;drag=null;if(d?.moved){if(d.version!==state.editVersion)throw new Error('The timeline changed during the drag. Try again.');change(T.timeline(state.doc,d.next));timeline();}});
      el.onpointercancel = ()=>{drag=null;timeline();};
      el.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}},true);
    });
    removals(timeline);
    cleanup(()=>{});
  }
  function continuity() {
    const facts=T.continuity(state.doc), scenes=rows();
    show('Continuity across scenes', `<p>Scene order drives explicit establish → require → clear checks. These checks use your facts; they do not infer what a character knows from dialogue.</p>
      <div class="story-list">${scenes.map(s=>`<article class="story-card"><h3>${E(s.heading)}</h3><p>Cast: ${E(s.characters.join(', ')||'—')} · Location: ${E(s.location||'—')} · Tagged props: ${E(s.props.join(', ')||'—')}</p>${sceneButton(s.key,`Scene ${s.number} · p. ${s.pages||'—'}`)}</article>`).join('')}</div>
      <h3>Continuity evidence</h3><div class="story-list">${facts.map(f=>`<article class="story-card ${f.issue?'story-issue':''}"><strong>${E(f.entity)} · ${E(f.kind)} · ${E(f.operation)} “${E(f.state)}”</strong><p>${E(f.evidence)}</p><p>${E(f.issue||'Consistent with established facts.')}</p>${sceneButton(f.sceneId,f.heading)}${f.sourceSceneId?sceneButton(f.sourceSceneId,'Previous evidence'):''}${deleteButton('facts',f.id)}</article>`).join('')||'<p>No explicit continuity facts yet.</p>'}</div>
      <div class="field-grid">${sceneSelect()}${select('Category','factKind',choices(['character','location','prop','knowledge']))}${field('Character, object, place or knower','factEntity')}${select('Operation','factOperation',choices(['establish','require','clear']))}${field('State / fact','factState')}</div>${field('Scene evidence','factEvidence')}`,
      [{label:'Add continuity fact',kind:'primary',onClick:()=>{change(T.fact(state.doc,{sceneId:value('storyScene'),kind:value('factKind'),entity:value('factEntity'),state:value('factState'),operation:value('factOperation'),evidence:value('factEvidence')}));continuity();}}]);
    removals(continuity);
  }
  function arcs() {
    const entries=sdata().arcs, names=[...new Set(entries.flatMap(a=>[a.character,a.other]).filter(Boolean))], w=720,h=Math.max(200,names.length*65);
    const positions=new Map(names.map((name,i)=>[name,{x:i%2?530:160,y:45+Math.floor(i/2)*95}]));
    const plot=`<svg class="story-graph" viewBox="0 0 ${w} ${h}" role="img" aria-label="Scene-evidenced character relationships">${entries.filter(a=>a.other).map(a=>{const p=positions.get(a.character),q=positions.get(a.other);return `<g><path d="M${p.x} ${p.y} L${q.x} ${q.y}"/><text x="${(p.x+q.x)/2}" y="${(p.y+q.y)/2-8}">${a.value>0?'+':''}${a.value}</text></g>`;}).join('')}${names.map(name=>{const p=positions.get(name);return `<g><circle cx="${p.x}" cy="${p.y}" r="22"/><text x="${p.x}" y="${p.y+38}">${E(name)}</text></g>`;}).join('')}</svg>`;
    show('Character arcs and relationships', `<p>Record a character’s state or a relationship from −5 to +5, with evidence from a scene. Values express your interpretation.</p>${entries.length?plot:'<p>Add evidence to start the graph.</p>'}
      <div class="story-list">${entries.slice().sort((a,b)=>rows().findIndex(s=>s.key===a.sceneId)-rows().findIndex(s=>s.key===b.sceneId)).map(a=>`<article class="story-card"><strong>${E(a.character)}${a.other?' ↔ '+E(a.other):' arc'} · ${a.value>0?'+':''}${a.value}</strong><meter min="-5" max="5" value="${a.value}">${a.value}</meter><p>${E(a.evidence)}</p>${sceneButton(a.sceneId)}${deleteButton('arcs',a.id)}</article>`).join('')}</div>
      <div class="field-grid">${sceneSelect()}${field('Character','arcCharacter')}${field('Related character (optional)','arcOther')}${field('State / relationship value','arcValue',0,'type="number" min="-5" max="5" step="1"')}</div>${field('Scene-linked evidence','arcEvidence')}`,
      [{label:'Add arc evidence',kind:'primary',onClick:()=>{change(T.arc(state.doc,{sceneId:value('storyScene'),character:value('arcCharacter'),other:value('arcOther'),value:value('arcValue'),evidence:value('arcEvidence')}));arcs();}}]);
    removals(arcs);
  }
  function branches(selected = '') {
    const list=sdata().branches, branch=list.find(b=>b.id===selected)||list[0];
    const scenes=branch?M.getScenes(T.branchDocument(state.doc,branch.id)):[];
    let preview;
    show('Alternate scene orders and endings', `<p>Each branch captures the screenplay body. Experiment here, preview the merge, then apply it as one undo step. A merge also retains the prior main draft as a return branch.</p>
      <div class="workspace-actions">${field('Branch name','branchName')}<button class="btn" id="branchCapture">Capture current draft</button></div>${select('Saved branch','branchSelect',list.map(b=>option(b.id,b.name)).join(''))}
      <div class="story-list">${scenes.map((s,i)=>`<article class="story-card"><strong>${i+1} · ${E(s.heading)}${s.omit?' · omitted':''}</strong><div class="workspace-actions"><button class="btn" data-branch-move="-1" data-scene="${T.id(s)}" ${i===0?'disabled':''}>Move up</button><button class="btn" data-branch-move="1" data-scene="${T.id(s)}" ${i===scenes.length-1?'disabled':''}>Move down</button><button class="btn" data-branch-omit="${T.id(s)}">${s.omit?'Restore':'Omit'}</button></div></article>`).join('')}</div>
      ${branch?`${select('Ending format','branchEndingFormat',option('action','Action paragraphs')+option('fountain','Fountain dialogue/action'))}<label class="field"><span>Alternate ending (replaces the branch’s last scene body)</span><textarea class="input" id="branchEnding" rows="5" placeholder="Action: separate paragraphs with blank lines. Fountain: use @CHARACTER, dialogue and !action; leave out scene headings."></textarea></label><button class="btn" id="branchEndingSave">Save alternate ending</button><button class="btn" id="branchDelete">Delete selected branch</button>`:''}<div id="branchPreview" role="status"></div>`,
      [{label:'Preview branch merge',onClick:()=>{if(!branch)throw new Error('Capture a branch first.');preview=T.previewBranch(state.doc,branch.id);$('#branchPreview').innerHTML=`<h3>Merge preview: ${E(branch.name)}</h3>${preview.rows.map(r=>`<p>${r.before} → ${r.after} · ${E(r.heading)}${r.omitted?' · omitted':''}${r.changed?' · content changed':''}</p>${r.changed?`<details><summary>Compare scene text</summary><h4>Main draft</h4><pre class="story-diff">${E(r.beforeText)}</pre><h4>Branch</h4><pre class="story-diff">${E(r.afterText)}</pre></details>`:''}`).join('')}`;}},
        {label:'Apply previewed merge',kind:'primary',onClick:()=>{if(!preview)throw new Error('Preview this branch before applying it.');change(T.mergeBranch(state.doc,preview),true);branches(branch.id);toast('Branch merged','Undo restores the previous draft; a return branch was also saved.','success');}}]);
    if(branch)$('#branchSelect').value=branch.id;
    $('#branchSelect').onchange=()=>branches(value('branchSelect'));
    $('#branchCapture').onclick=safe(()=>{change(T.captureBranch(state.doc,value('branchName')));branches(sdata().branches.at(-1).id);});
    bind('[data-branch-move]',el=>{change(T.editBranch(state.doc,branch.id,{sceneId:el.dataset.scene,move:Number(el.dataset.branchMove)}));branches(branch.id);});
    bind('[data-branch-omit]',el=>{const sc=scenes.find(s=>T.id(s)===el.dataset.branchOmit);change(T.editBranch(state.doc,branch.id,{sceneId:T.id(sc),omit:!sc.omit}));branches(branch.id);});
    if(branch){$('#branchEndingSave').onclick=safe(()=>{change(T.editBranch(state.doc,branch.id,{sceneId:T.id(scenes.at(-1)),ending:value('branchEnding'),format:value('branchEndingFormat')}));branches(branch.id);});$('#branchDelete').onclick=safe(()=>{change(T.remove(state.doc,'branches',branch.id));branches();});}
  }
  function pacing() {
    const scenes=rows(), max=Math.max(1,...scenes.map(s=>s.seconds));
    show('Tension and pacing map', `<p>Intensity is assigned by you (0–10). Dialogue density and estimated read duration are measured separately. Empty intensity values remain unscored.</p>
      <div class="story-pacing" role="list">${scenes.map(s=>`<article class="story-card" role="listitem"><h3>${E(s.heading)}${s.omit?' · omitted':''}</h3><div class="story-pacing__bars"><span>Intensity: ${s.intensity??'unscored'}</span><meter min="0" max="10" value="${s.intensity??0}">${s.intensity??'unscored'}</meter><span>Dialogue: ${Math.round(s.dialogueDensity*100)}%</span><meter min="0" max="1" value="${s.dialogueDensity}"></meter><span>Duration: ${s.seconds}s</span><meter min="0" max="${max}" value="${s.seconds}"></meter></div>${sceneButton(s.key,`Scene ${s.number} · p. ${s.pages||'—'}`)}</article>`).join('')}</div>
      <div class="field-grid">${sceneSelect()}${select('Intensity target','pacingBeat',option('','Selected scene')+state.doc.beats.map(b=>option(b.id,'Beat: '+b.title)).join(''))}${field('Writer-assigned intensity','pacingIntensity',5,'type="number" min="0" max="10"')}</div>
      <p>Beat goals: ${state.doc.beats.map(b=>`${E(b.title)} (p. ${E(b.goalPage||'—')} · intensity ${sdata().pacing.find(p=>p.beatId===b.id)?.intensity??'unscored'})`).join(' · ')||'No beats yet.'}</p><p>Scene intensity uses an explicit scene value, or the mean of its linked, scored beats.</p>`,
      [{label:'Save intensity',kind:'primary',onClick:()=>{change(T.pacing(state.doc,{sceneId:value('storyScene'),beatId:value('pacingBeat'),intensity:value('pacingIntensity')}));pacing();}},
        {label:'Clear intensity',onClick:()=>{change(T.remove(state.doc,'pacing',value('pacingBeat')||value('storyScene')));pacing();}},
        {label:'Export pacing CSV',onClick:()=>download('pacing.csv',FDProduction.csv(scenes.map(s=>({scene:s.number,heading:s.heading,pages:s.pages,intensity:s.intensity??'',dialoguePercent:Math.round(s.dialogueDensity*100),estimatedSeconds:s.seconds,omitted:s.omit}))))}]);
  }
  function download(name, contents, type='text/plain') {
    const url=URL.createObjectURL(new Blob([contents],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function fileData(file) {
    if (!file || file.size>1000000) return Promise.reject(new Error('Choose a media file smaller than 1 MB.'));
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('The media file could not be read.'));r.readAsDataURL(file);});
  }
  function storyboard() {
    const s=sdata(), shots=T.animatic(state.doc), assets=new Map(s.assets.map(a=>[a.id,a])); let timer=null, index=0;
    const cleanup=show('Storyboard and animatic lanes', `<p>Add your own or licensed images and credit their source. Shot timing and scene links are saved with the draft. Embedded media budget: ${(s.assets.reduce((n,a)=>n+a.data.length,0)/1000000).toFixed(2)} / 2 MB.</p>
      <div class="field-grid">${sceneSelect()}${field('Shot title','shotTitle')}${field('Lane','shotLane','Storyboard')}${field('Duration (seconds)','shotSeconds',3,'type="number" min="0.25" max="600" step="0.25"')}${field('Order within scene','shotOrder',s.shots.length,'type="number" min="0"')}${select('Existing image','shotAsset',option('','No image')+s.assets.filter(a=>a.data.startsWith('data:image/')).map(a=>option(a.id,a.name)).join(''))}</div>
      <label class="field"><span>New image (PNG/JPEG/WebP, under 1 MB)</span><input class="input" type="file" id="shotFile" accept="image/png,image/jpeg,image/webp"></label>${field('Image credit / license','shotCredit')}
      <div class="workspace-actions"><button class="btn" id="shotPlay">Play animatic</button><button class="btn" id="shotStop">Stop animatic</button>${select('Preview lane','animaticLane',option('','All lanes')+choices([...new Set(shots.map(s=>s.lane))]))}</div>
      <figure class="story-player" id="animaticPlayer"><p>Choose Play animatic to preview shots in scene order.</p></figure>
      <div class="story-shots">${shots.map(sh=>`<article class="story-card">${assets.get(sh.assetId)?`<img loading="lazy" src="${E(assets.get(sh.assetId).data)}" alt="${E(sh.title)}">`:''}<h3>${E(sh.title)}</h3><p>${E(sh.lane)} · ${sh.start.toFixed(1)}–${sh.end.toFixed(1)}s (${sh.seconds}s) · order ${sh.order}</p><small>${E(assets.get(sh.assetId)?.credit||'No image credit')}</small><div class="workspace-actions">${sceneButton(sh.sceneId)}<button class="btn" data-shot-edit="${E(sh.id)}">Edit shot</button>${deleteButton('shots',sh.id)}</div></article>`).join('')}</div>
      <details><summary>Manage embedded media</summary>${s.assets.map(a=>`<p>${E(a.name)} ${deleteButton('assets',a.id)}</p>`).join('')}</details>`,
      [{label:'Save storyboard shot',kind:'primary',onClick:async()=>{
        const docId=state.doc.documentId,version=state.editVersion,root=$('#storyRoot'),params={sceneId:value('storyScene'),title:value('shotTitle'),lane:value('shotLane'),seconds:value('shotSeconds'),order:value('shotOrder'),assetId:value('shotAsset'),id:$('#shotTitle').dataset.shotId||''},file=$('#shotFile').files[0],credit=value('shotCredit');
        const url=file?await fileData(file):null;if(!root.isConnected)return;if(docId!==state.doc.documentId||version!==state.editVersion)throw new Error('The draft changed while loading the image. Try again.');
        let next=state.doc;if(url){const result=T.media(next,{data:url,name:file.name,credit});next=result.document;params.assetId=result.assetId;}change(T.shot(next,params));storyboard();
      }}]);
    bind('[data-shot-edit]',el=>{const sh=s.shots.find(s=>s.id===el.dataset.shotEdit);$('#shotTitle').dataset.shotId=sh.id;for(const [key,id]of Object.entries({sceneId:'storyScene',title:'shotTitle',lane:'shotLane',seconds:'shotSeconds',order:'shotOrder',assetId:'shotAsset'}))$('#'+id).value=sh[key];$('#shotTitle').focus();});
    const stop=()=>{clearTimeout(timer);timer=null;};cleanup(stop);
    $('#shotStop').onclick=stop;
    $('#shotPlay').onclick=()=>{stop();index=0;const list=T.animatic(state.doc,value('animaticLane'));function frame(){if(index>=list.length){$('#animaticPlayer').innerHTML='<p>Animatic complete.</p>';return;}const sh=list[index++],asset=assets.get(sh.assetId);$('#animaticPlayer').innerHTML=`${asset?`<img src="${E(asset.data)}" alt="${E(sh.title)}">`:''}<figcaption>${E(sh.title)} · ${sh.seconds}s · ${E(sh.lane)}</figcaption>`;timer=setTimeout(frame,sh.seconds*1000);}frame();};
    removals(storyboard);
  }
  function rehearsal() {
    const characters=M.getCharacters(state.doc).map(c=>c.name), s=sdata();let items=[],index=0,timer=null,recorder=null,stream=null,stopped=false,playSequence=0,recordPending=false;
    const cleanup=show('Rehearsal and actor recordings', `<p>Choose your role. Your lines start hidden; partner cues can be spoken on Play. Silence adds time for your response. Recordings stay in the draft; microphone access starts only when you press Record (maximum 45 seconds per take).</p>
      <div class="field-grid">${select('Your role','rehearsalRole',choices(characters))}${field('Extra silence (seconds)','rehearsalSilence',2,'type="number" min="0" max="30"')}${field('Actor / take label','recordActor')}</div>
      <div class="workspace-actions"><button class="btn" id="rehearsalStart">Start rehearsal</button><button class="btn" id="rehearsalPlay">Play cues</button><button class="btn" id="rehearsalStop">Stop cues</button><button class="btn" id="rehearsalBack">Previous line</button><button class="btn" id="rehearsalNext">Next line</button><button class="btn" id="rehearsalReveal">Reveal your line</button></div>
      <article class="story-card" id="rehearsalPrompt" aria-live="polite">Choose Start rehearsal.</article>
      <div class="workspace-actions"><button class="btn" id="rehearsalRecord">Record take</button><button class="btn" id="rehearsalRecordStop" disabled>Stop recording</button><span id="recordStatus" role="status"></span></div>
      <label class="field"><span>Or attach an actor recording (WebM/Ogg/WAV, under 1 MB) to the current role line</span><input class="input" id="recordFile" type="file" accept="audio/webm,audio/ogg,audio/wav"></label><button class="btn" id="recordAttach">Attach recording</button>
      <h3>Saved takes</h3><div class="story-list">${s.recordings.map(r=>{const a=s.assets.find(a=>a.id===r.assetId),p=state.doc.paragraphs.find(p=>T.id(p)===r.paragraphId);return `<article class="story-card"><strong>${E(r.actor||'Actor take')}</strong><p>${E(r.transcript)}</p><p>${!p?'Linked line is missing.':M.paragraphText(p)!==r.transcript?'The linked line has changed since this take.':''}</p>${a?`<audio controls preload="none" src="${E(a.data)}"></audio>`:''}${deleteButton('recordings',r.id)}</article>`;}).join('')}</div>`);
    function stop(){playSequence++;clearTimeout(timer);timer=null;window.speechSynthesis?.cancel();}
    cleanup(()=>{stopped=true;stop();if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());$$('#storyRoot audio').forEach(a=>a.pause());});
    function prompt(reveal=false){const p=items[index];if(!p){$('#rehearsalPrompt').textContent='Rehearsal complete.';return;}$('#rehearsalPrompt').innerHTML=`<strong>${index+1}/${items.length} · ${E(p.speaker)}${p.own?' · your role':''}</strong><p>${p.own&&!reveal?'Your line is hidden. Rehearse from the cue, then reveal to check.':E(p.text)}</p><small>${p.seconds.toFixed(1)}s including silence</small>`;}
    function start(){stop();items=T.rehearsal(state.doc,value('rehearsalRole'),value('rehearsalSilence'));index=0;prompt();}
    $('#rehearsalStart').onclick=start;$('#rehearsalRole').onchange=start;$('#rehearsalSilence').onchange=start;
    $('#rehearsalNext').onclick=()=>{stop();index=Math.min(items.length,index+1);prompt();};$('#rehearsalBack').onclick=()=>{stop();index=Math.max(0,index-1);prompt();};$('#rehearsalReveal').onclick=()=>prompt(true);$('#rehearsalStop').onclick=stop;
    $('#rehearsalPlay').onclick=()=>{stop();if(!items.length)start();const sequence=playSequence;function next(){if(sequence!==playSequence||stopped)return;const p=items[index];prompt();if(!p)return;let advanced=false;const advance=()=>{if(advanced||stopped||sequence!==playSequence)return;advanced=true;clearTimeout(timer);index++;next();};if(!p.own&&window.speechSynthesis){const u=new SpeechSynthesisUtterance(p.text);u.onend=()=>{if(advanced||stopped||sequence!==playSequence)return;clearTimeout(timer);timer=setTimeout(advance,400);};u.onerror=advance;timer=setTimeout(()=>{if(sequence!==playSequence)return;advanced=true;window.speechSynthesis.cancel();advanced=false;advance();},Math.max(10000,p.seconds*3000));window.speechSynthesis.speak(u);}else timer=setTimeout(advance,p.seconds*1000);}next();};
    function target(){const p=items[index];if(!p?.own)throw new Error('Start rehearsal and choose one of your role’s dialogue lines before recording.');return {...p,actor:value('recordActor'),documentId:state.doc.documentId};}
    async function attach(blob,t){const root=$('#storyRoot'),url=await fileData(blob);if(stopped||!root?.isConnected)return;if(state.doc.documentId!==t.documentId||!state.doc.paragraphs.some(p=>T.id(p)===t.paragraphId&&M.paragraphText(p)===t.text))throw new Error('The recorded line changed. Attach this take again after selecting its line.');const result=T.media(state.doc,{data:url,name:'Actor take',credit:t.actor});change(T.recording(result.document,{paragraphId:t.paragraphId,assetId:result.assetId,actor:t.actor}));rehearsal();}
    $('#recordAttach').onclick=safe(async()=>{const t=target(),file=$('#recordFile').files[0];if(!file)throw new Error('Choose an audio file.');await attach(file,t);});
    $('#rehearsalRecord').onclick=safe(async()=>{
      const t=target();if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Microphone recording is unavailable here. Attach an actor audio file instead.');
      if(recordPending||recorder?.state==='recording')return;recordPending=true;$('#rehearsalRecord').disabled=true;
      try{stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});}catch(e){recordPending=false;if(!stopped)$('#rehearsalRecord').disabled=false;throw e;}recordPending=false;if(stopped){stream.getTracks().forEach(t=>t.stop());return;}
      const chunks=[];let limit;
      try {recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=safe(async()=>{clearTimeout(limit);stream.getTracks().forEach(t=>t.stop());if(!stopped){$('#rehearsalRecord').disabled=false;$('#rehearsalRecordStop').disabled=true;$('#recordStatus').textContent='';await attach(new Blob(chunks,{type:recorder.mimeType.split(';')[0]}),t);}});recorder.onerror=()=>{stream.getTracks().forEach(t=>t.stop());if(!stopped){$('#rehearsalRecord').disabled=false;$('#recordStatus').textContent='Recording failed. Try again or attach an audio file.';}};recorder.start();}
      catch(e){stream.getTracks().forEach(t=>t.stop());$('#rehearsalRecord').disabled=false;throw e;}
      $('#rehearsalRecord').disabled=true;$('#rehearsalRecordStop').disabled=false;$('#recordStatus').textContent='Recording…';limit=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},45000);cleanup(()=>clearTimeout(limit));
    });
    $('#rehearsalRecordStop').onclick=()=>{if(recorder?.state==='recording')recorder.stop();};
    removals(rehearsal);
  }
  function graph() {
    const g=T.graph(state.doc), positions=new Map(), counts={};
    for(const n of g.nodes){const column={scene:0,shot:1,asset:2,schedule:3,revision:4}[n.kind];const row=counts[column]||0;counts[column]=row+1;positions.set(n.id,{x:80+column*150,y:40+row*65});}
    const height=Math.max(180,...Object.values(counts).map(n=>n*65+40));
    show('Screenplay to production graph', `<p>Links run from a scene or source item to its dependent work. Scene edits mark linked production items for review; selecting a scene traces downstream effects.</p>
      <svg class="story-graph" viewBox="0 0 840 ${height}" role="img" aria-label="Scenes, shots, assets, schedules and revisions">${g.edges.filter(e=>!e.missing).map(e=>{const a=positions.get(e.from),b=positions.get(e.to);return `<path d="M${a.x} ${a.y} L${b.x} ${b.y}"/>`;}).join('')}${g.nodes.map(n=>{const p=positions.get(n.id);return `<g><circle cx="${p.x}" cy="${p.y}" r="8" class="${n.changed||n.missing?'story-graph__changed':''}"/><text x="${p.x}" y="${p.y+22}">${E(n.kind)}: ${E(n.title.slice(0,18))}</text></g>`;}).join('')}</svg>
      <div class="field-grid">${sceneSelect()}${select('Production item type','graphKind',choices(['asset','schedule','revision']))}${field('Item title','graphTitle')}${field('Scheduled date','graphDate','','type="date"')}${field('Evidence / revision reference','graphEvidence')}</div>
      <div class="workspace-actions"><button class="btn" id="graphImpact">Trace selected scene impact</button></div><div id="graphImpactResult" role="status"></div>
      <div class="field-grid">${select('Source','graphFrom',g.nodes.map(n=>option(n.id,`${n.kind}: ${n.title}`)).join(''))}${select('Dependent item','graphTo',g.nodes.map(n=>option(n.id,`${n.kind}: ${n.title}`)).join(''))}${field('Relationship','graphLabel','affects')}</div><button class="btn" id="graphLink">Link production items</button>
      <h3>Production items</h3><div class="story-list">${g.nodes.filter(n=>n.kind!=='scene').map(n=>`<article class="story-card ${n.changed||n.missing?'story-issue':''}"><strong>${E(n.kind)} · ${E(n.title)}</strong><p>${E(n.date||'')} ${E(n.evidence||'')}</p><p>${n.missing?'Linked scene missing.':n.changed?'Scene changed since this item was reviewed.':'Current scene reference.'}</p>${sceneButton(n.sceneId)}<button class="btn" data-graph-ack="${E(n.id)}">Mark reviewed</button>${deleteButton(n.kind==='shot'?'shots':'nodes',n.id)}</article>`).join('')}</div>
      <h3>Dependency links</h3>${g.edges.map(e=>`<p>${E(g.nodes.find(n=>n.id===e.from)?.title||'Missing source')} → ${E(g.nodes.find(n=>n.id===e.to)?.title||'Missing target')} · ${E(e.label||'scene reference')}${e.missing?' · broken link':''} ${e.id?deleteButton('links',e.id):''}</p>`).join('')}`,
      [{label:'Add production item',kind:'primary',onClick:()=>{change(T.node(state.doc,{sceneId:value('storyScene'),kind:value('graphKind'),title:value('graphTitle'),date:value('graphDate'),evidence:value('graphEvidence')}));graph();}},
        {label:'Export production graph',onClick:()=>download('production-graph.json',JSON.stringify(T.graph(state.doc),null,2),'application/json')}]);
    $('#graphImpact').onclick=safe(()=>{$('#graphImpactResult').textContent=T.impact(state.doc,value('storyScene')).map(n=>`${n.kind}: ${n.title}${n.changed?' (needs review)':''}`).join(' → ');});
    $('#graphLink').onclick=safe(()=>{change(T.link(state.doc,{from:value('graphFrom'),to:value('graphTo'),label:value('graphLabel')}));graph();});
    bind('[data-graph-ack]',el=>{change(T.acknowledge(state.doc,el.dataset.graphAck));graph();});removals(graph);
  }
  const button=document.createElement('button');button.id='storyToolsButton';button.type='button';button.className='icon-btn icon-btn--quiet';
  button.setAttribute('aria-label','Story studio');button.dataset.tooltip='Story studio';button.innerHTML='<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="#i-board"></use></svg>';
  button.onclick=safe(hub);$('.titlebar__actions').insertBefore(button,$('#productionToolsButton'));
  return { hub, commands:()=>actions.map(([id,label,run])=>({id:'story-'+id,label,group:'Story studio',icon:'board',run:safe(run)})), dispose };
};
