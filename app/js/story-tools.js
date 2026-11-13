/* Scene-linked story planning. No network services or inferred creative scores. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./pagination.js'), require('./production-tools.js'));
  else root.FDStory = factory(root.FDModel, root.FDPagination, root.FDProduction);
})(typeof self !== 'undefined' ? self : this, function (M, P, Production) {
  'use strict';
  const id = value => M.toUuid(typeof value === 'string' ? value : value.id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const text = (value, limit = 2000) => String(value || '').slice(0, limit);
  const MEDIA_BUDGET = 2000000;
  function data(doc) {
    const s = doc.story || {};
    const rows = name => Array.isArray(s[name]) ? s[name].filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
    const strings = (row, fields) => ({ ...row, ...Object.fromEntries(['id', ...fields].map(key => [key, text(row[key], key === 'evidence' ? 2000 : 500)])) });
    return { version: 1,
      lanes: rows('lanes').map(row => ({ ...strings(row, ['name']), height: number(row.height, 80, 360, 120) })),
      timeline: rows('timeline').map(row => ({ ...strings(row, ['laneId','sceneId','beatId','goal']), start: number(row.start, 1, 10000, 1), end: number(row.end, 1, 10000, 1) })),
      facts: rows('facts').map(row => strings(row, ['kind','operation','entity','state','sceneId','evidence'])),
      arcs: rows('arcs').map(row => ({ ...strings(row, ['character','other','sceneId','evidence']), value: number(row.value, -5, 5, 0) })),
      branches: rows('branches'),
      pacing: rows('pacing').map(row => ({ ...row, intensity: number(row.intensity, 0, 10, 0) })),
      shots: rows('shots').map(row => ({ ...strings(row, ['sceneId','title','lane','assetId']), seconds: number(row.seconds, .25, 600, 3), order: number(row.order, 0, 100000, 0) })),
      assets: rows('assets').map(row => ({ ...strings(row, ['name','credit']), data: typeof row.data === 'string' ? row.data : '' })),
      recordings: rows('recordings'), nodes: rows('nodes'), links: rows('links') };
  }
  function change(doc, operation) { const next = M.cloneDocument(doc); next.story = copy(data(next)); operation(next.story, next); return next; }
  function scene(doc, sceneId) {
    const found = M.getScenes(doc).find(s => id(s) === id(sceneId));
    if (!found) throw new Error('The linked scene is missing. Choose an existing scene.');
    return found;
  }
  function evidence(doc, value) { scene(doc, value.sceneId); return { sceneId: id(value.sceneId), evidence: text(value.evidence) }; }
  function replace(list, row) { const at = list.findIndex(r => r.id === row.id); if (at < 0) list.push(row); else list[at] = row; }
  function remove(doc, collection, rowId) {
    if (!['lanes','timeline','facts','arcs','branches','pacing','shots','assets','recordings','nodes','links'].includes(collection)) throw new Error('Unknown story collection.');
    return change(doc, s => {
      if (collection === 'lanes' && s.timeline.some(t => t.laneId === rowId)) throw new Error('Move or remove this lane’s events first.');
      if (collection === 'assets' && [...s.shots, ...s.recordings].some(t => t.assetId === rowId)) throw new Error('Remove the linked shots or recordings first.');
      s[collection] = s[collection].filter(r => r.id !== rowId);
      if (collection === 'nodes' || collection === 'shots') s.links = s.links.filter(l => l.from !== rowId && l.to !== rowId);
    });
  }
  function lane(doc, value) { return change(doc, s => replace(s.lanes, { id: value.id || M.uid('lane'), name: text(value.name, 100) || 'Story lane', height: number(value.height, 80, 360, 120) })); }
  function timeline(doc, value) {
    const e = evidence(doc, value), s = data(doc);
    if (!s.lanes.some(l => l.id === value.laneId)) throw new Error('Choose a timeline lane.');
    if (value.beatId && !doc.beats.some(b => b.id === value.beatId)) throw new Error('The linked beat no longer exists.');
    const start = number(value.start, 1, 10000, 1), end = number(value.end, 1, 10000, start);
    if (end < start) throw new Error('End page must follow the start page.');
    return change(doc, s => replace(s.timeline, { id: value.id || M.uid('event'), ...e, laneId: value.laneId,
      beatId: text(value.beatId, 200), start, end, goal: text(value.goal, 500) }));
  }
  function sceneRows(doc, options) {
    const pages = P.layout(doc, options), refs = new Map();
    for (const page of pages.pages.filter(p => p.kind === 'script')) for (const b of P.pageParagraphs(page)) {
      const key = id(b.paragraph); if (!refs.has(key)) refs.set(key, []);
      if (!refs.get(key).includes(String(page.label ?? page.number))) refs.get(key).push(String(page.label ?? page.number));
    }
    const wpm = number(doc.production?.read?.wordsPerMinute, 60, 300, 150);
    return M.getScenes(doc).map(s => {
      const paragraphs = doc.paragraphs.slice(s.startIndex, s.endIndex), words = paragraphs.reduce((sum, p) => sum + M.wordCount(M.paragraphText(p)), 0);
      const dialogue = paragraphs.filter(p => p.type === 'Dialogue').reduce((sum, p) => sum + M.wordCount(M.paragraphText(p)), 0);
      const pageLabels = [...new Set(paragraphs.flatMap(p => refs.get(id(p)) || []))];
      return { ...s, key: id(s), pages: pageLabels.join(', '), words, dialogueDensity: words ? dialogue / words : 0,
        seconds: Math.round(words / wpm * 60), characters: [...new Set(paragraphs.filter(p => p.type === 'Character').map(p => M.paragraphText(p).trim()))],
        props: [...new Set(paragraphs.flatMap(p => (p.tags || []).filter(t => t.category === 'props').map(t => t.label)))],
        intensity: sceneIntensity(doc, id(s)) };
    });
  }
  function fact(doc, value) {
    const e = evidence(doc, value);
    if (!['character','location','prop','knowledge'].includes(value.kind)) throw new Error('Choose a continuity category.');
    if (!['establish','require','clear'].includes(value.operation)) throw new Error('Choose establish, require or clear.');
    if (!text(value.entity).trim() || !text(value.state).trim()) throw new Error('Enter an entity and a state or fact.');
    return change(doc, s => replace(s.facts, { id: value.id || M.uid('fact'), ...e, kind: value.kind,
      entity: text(value.entity, 200).trim(), state: text(value.state, 500).trim(), operation: value.operation }));
  }
  function continuity(doc) {
    const s = data(doc), scenes = M.getScenes(doc), known = new Map(), rows = [];
    for (const sc of scenes) for (const f of s.facts.filter(f => f.sceneId === id(sc))) {
      let issue = sc.omit ? 'Scene omitted; this fact does not establish continuity.' : '';
      const k = f.kind + ':' + f.entity.toLowerCase() + (f.kind === 'knowledge' ? ':' + f.state : ''), current = known.get(k);
      if (!sc.omit) {
        if (f.operation === 'require' && current?.state !== f.state) issue = current ? `Requires “${f.state}”; last established state is “${current.state}”.` : `Requires “${f.state}” before it is established.`;
        if (f.operation === 'establish') known.set(k, { state: f.state, sceneId: id(sc) });
        if (f.operation === 'clear') {
          if (current?.state !== f.state) issue = 'Clears a state that is not currently established.';
          else known.delete(k);
        }
      }
      rows.push({ ...f, heading: sc.heading, issue, sourceSceneId: current?.sceneId || '' });
    }
    for (const f of s.facts) if (!scenes.some(sc => id(sc) === f.sceneId)) rows.push({ ...f, issue: 'Linked scene is missing.', heading: 'Missing scene' });
    return rows;
  }
  function arc(doc, value) {
    const e = evidence(doc, value);
    if (!text(value.character).trim() || !e.evidence.trim()) throw new Error('Enter a character and scene evidence.');
    if (value.other && value.other.trim().toLowerCase() === value.character.trim().toLowerCase()) throw new Error('A relationship needs two different characters.');
    return change(doc, s => replace(s.arcs, { id: value.id || M.uid('arc'), ...e, character: text(value.character, 200).trim(),
      other: text(value.other, 200).trim(), value: number(value.value, -5, 5, 0) }));
  }
  function bodySignature(doc) {
    const normalized=M.normalizeDocument({...doc,story:{}});
    return JSON.stringify({body:Production.fingerprint(normalized),extras:normalized.paragraphs.map(p=>({id:id(p),note:p.note||'',alts:p.alts||[],activeAlt:p.activeAlt||0,image:p.image||null})),lock:normalized.production?.lock||null});
  }
  function captureBranch(doc, name) {
    if (!text(name).trim()) throw new Error('Name this branch.');
    return change(doc, (s, next) => s.branches.push({ id: M.uid('branch'), name: text(name, 100).trim(), base: bodySignature(next),
      paragraphs: copy(next.paragraphs), createdAt: new Date().toISOString() }));
  }
  function branchDocument(doc, branchId) {
    const b = data(doc).branches.find(b => b.id === branchId); if (!b) throw new Error('Choose a saved branch.');
    return M.normalizeDocument({ ...doc, paragraphs: b.paragraphs });
  }
  function editBranch(doc, branchId, value) {
    const bdoc = branchDocument(doc, branchId), scenes = M.getScenes(bdoc), sc = scenes.find(s=>id(s)===id(value.sceneId));
    if (!sc) throw new Error('The linked scene is missing.');
    if (value.move) {
      const at = scenes.indexOf(sc), neighbor = scenes[at + Math.sign(value.move)];
      if (!neighbor) return doc;
      const blocks = new Map(scenes.map(s => [id(s), bdoc.paragraphs.slice(s.startIndex, s.endIndex)]));
      [scenes[at], scenes[at + Math.sign(value.move)]] = [scenes[at + Math.sign(value.move)], scenes[at]];
      bdoc.paragraphs = [...bdoc.paragraphs.slice(0, scenes.reduce((min,s) => Math.min(min,s.startIndex), Infinity)), ...scenes.flatMap(s => blocks.get(id(s)))];
    }
    if (value.omit !== undefined) sc.paragraph.scene = { ...sc.paragraph.scene, omit: !!value.omit };
    if (value.ending !== undefined) {
      if (sc !== scenes.at(-1)) throw new Error('Select the last scene to replace the ending.');
      const lines = value.format === 'fountain' ? Production.importText(text(value.ending,100000),'fountain').doc.paragraphs
        : text(value.ending, 100000).split(/\n\s*\n/).filter(s => s.trim()).map(t => {const p=M.makeParagraph('Action',t.trim());p.html=p.html.replace(/\n/g,'<br>');return p;});
      if (!lines.length) throw new Error('Enter the alternate ending.');
      if (lines.some(p=>p.type==='Scene Heading')) throw new Error('Write the alternate ending inside the selected last scene; leave out scene headings.');
      bdoc.paragraphs.splice(sc.startIndex + 1, sc.endIndex - sc.startIndex - 1, ...lines);
    }
    return change(doc, s => { s.branches.find(b => b.id === branchId).paragraphs = copy(bdoc.paragraphs); });
  }
  function previewBranch(doc, branchId) {
    const branch = data(doc).branches.find(b => b.id === branchId), alternate = branchDocument(doc, branchId);
    if (branch.base !== bodySignature(doc)) throw new Error('The main draft changed after this branch was captured. Capture a fresh branch before merging.');
    if (doc.production?.lock) throw new Error('Unlock issued pagination before merging a story branch.');
    if (doc.nativeMetadata?.length || doc.sourceFDX?.sections?.some(name => /TagData|LockedPages|DisplayBoards|Production/i.test(name))) {
      throw new Error('Retained native production references need an independent copy before structural merging.');
    }
    const current = M.getScenes(doc), next = M.getScenes(alternate), byId=new Map(current.map(s=>[id(s),s]));
    return { branchId, signature: bodySignature(doc), target: JSON.stringify(branch.paragraphs), rows: next.map((s,index) => {
      const old=byId.get(id(s)), before=old?doc.paragraphs.slice(old.startIndex,old.endIndex):[],after=alternate.paragraphs.slice(s.startIndex,s.endIndex);
      return {sceneId:id(s),heading:s.heading,before:old?.index||0,after:index+1,omitted:s.omit,changed:JSON.stringify(before)!==JSON.stringify(after),
        beforeText:before.map(p=>p.type+': '+M.paragraphText(p)).join('\n'),afterText:after.map(p=>p.type+': '+M.paragraphText(p)).join('\n')};
    }) };
  }
  function mergeBranch(doc, preview) {
    const checked = previewBranch(doc, preview.branchId), branch = data(doc).branches.find(b => b.id === preview.branchId);
    if (preview.signature !== checked.signature || preview.target !== checked.target) throw new Error('The branch preview is stale. Preview again.');
    return change(doc, (s, next) => {
      s.branches.push({ id: M.uid('branch'), name: 'Before merge: ' + branch.name, base: bodySignature({ ...next, paragraphs: branch.paragraphs }), paragraphs: copy(next.paragraphs), createdAt: new Date().toISOString() });
      next.paragraphs = copy(branch.paragraphs);
    });
  }
  function pacing(doc, value) {
    if (value.beatId) {
      if (!doc.beats.some(b=>b.id===value.beatId)) throw new Error('Choose an existing beat.');
      return change(doc, s=>replace(s.pacing,{id:value.beatId,beatId:value.beatId,intensity:number(value.intensity,0,10,0)}));
    }
    scene(doc, value.sceneId);
    return change(doc, s => replace(s.pacing, { id: id(value.sceneId), sceneId: id(value.sceneId), intensity: number(value.intensity, 0, 10, 0) }));
  }
  function sceneIntensity(doc, sceneId) {
    const s=data(doc), explicit=s.pacing.find(p=>p.sceneId===sceneId);
    if(explicit)return explicit.intensity;
    const beatIds=new Set(s.timeline.filter(t=>t.sceneId===sceneId).map(t=>t.beatId)), values=s.pacing.filter(p=>p.beatId&&beatIds.has(p.beatId)).map(p=>p.intensity);
    return values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10 : null;
  }
  function media(doc, value) {
    const url = String(value.data || '');
    if (!/^data:(image\/(png|jpeg|webp)|audio\/(webm|ogg|wav)(;codecs=[a-z0-9-]+)?);base64,[a-zA-Z0-9+/=]+$/.test(url)) throw new Error('Use a PNG/JPEG/WebP image or WebM/Ogg/WAV audio file.');
    const s = data(doc), size = s.assets.filter(a => a.id !== value.id).reduce((sum,a) => sum + a.data.length, 0) + url.length;
    if (size > MEDIA_BUDGET) throw new Error('Embedded media budget is 2 MB per draft. Remove unused media or use a smaller file.');
    const row = { id: value.id || M.uid('asset'), name: text(value.name, 200) || 'User media', credit: text(value.credit, 500), data: url };
    return { document: change(doc, s => replace(s.assets, row)), assetId: row.id };
  }
  function shot(doc, value) {
    const e = evidence(doc, value);
    if (value.assetId && !data(doc).assets.some(a => a.id === value.assetId && a.data.startsWith('data:image/'))) throw new Error('Choose an image asset.');
    if (!text(value.title).trim()) throw new Error('Name the shot.');
    return change(doc, s => replace(s.shots, { id: value.id || M.uid('shot'), ...e, title: text(value.title,200),
      lane: text(value.lane, 100) || 'Storyboard', assetId: text(value.assetId,200), seconds: number(value.seconds,.25,600,3),
      order: number(value.order,0,100000,s.shots.length), baseline:sceneSignature(doc,value.sceneId) }));
  }
  function animatic(doc, laneName) {
    const scenes = M.getScenes(doc), available = new Map(scenes.filter(s => !s.omit).map(s => [id(s),s.index]));
    let at = 0;
    return data(doc).shots.filter(s => available.has(s.sceneId) && (!laneName || s.lane === laneName))
      .sort((a,b) => available.get(a.sceneId)-available.get(b.sceneId) || a.order-b.order)
      .map(s => { const row = { ...s, start: at, end: at + s.seconds }; at = row.end; return row; });
  }
  function rehearsal(doc, role, silence = 2) {
    const result = [], scenes = new Map(M.getScenes(doc).map(s=>[id(s),s])); let sc = null, speaker = '';
    for (const p of doc.paragraphs) {
      if (p.type === 'Scene Heading') { sc = scenes.get(id(p)); speaker = ''; }
      if (sc?.omit) continue;
      if (p.type === 'Character') speaker = M.paragraphText(p).trim();
      if (p.type !== 'Dialogue' || !M.paragraphText(p).trim()) continue;
      const own = speaker.replace(/\s*\([^)]*\)\s*$/,'').toLowerCase() === String(role).trim().toLowerCase();
      result.push({ paragraphId: id(p), sceneId: sc ? id(sc) : '', speaker, text: M.paragraphText(p), own,
        seconds: Math.max(1,M.wordCount(M.paragraphText(p))/150*60)+(own ? number(silence,0,30,2) : 0) });
    }
    return result;
  }
  function recording(doc, value) {
    const p = doc.paragraphs.find(p => id(p) === id(value.paragraphId));
    if (!p || p.type !== 'Dialogue') throw new Error('Link recordings to a dialogue paragraph.');
    if (!data(doc).assets.some(a => a.id === value.assetId && a.data.startsWith('data:audio/'))) throw new Error('Choose an audio recording.');
    return change(doc, s => replace(s.recordings, { id: value.id || M.uid('take'), paragraphId: id(p), assetId: value.assetId,
      actor: text(value.actor,200), transcript: M.paragraphText(p), createdAt: new Date().toISOString() }));
  }
  function node(doc, value) {
    const e = evidence(doc, value);
    if (!['asset','schedule','revision'].includes(value.kind)) throw new Error('Choose asset, schedule or revision.');
    if (!text(value.title).trim()) throw new Error('Name the production item.');
    if (value.date && !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('Use a calendar date.');
    return change(doc, s => replace(s.nodes, { id: value.id || M.uid('node'), ...e, kind: value.kind,
      title: text(value.title,200), date: text(value.date,10), baseline: sceneSignature(doc, value.sceneId) }));
  }
  function sceneSignature(doc, sceneId) { const s = scene(doc,sceneId); return JSON.stringify(doc.paragraphs.slice(s.startIndex,s.endIndex).map(p => ({type:p.type,text:M.paragraphText(p),revision:p.revision,omit:p.scene?.omit}))); }
  function graph(doc) {
    const s = data(doc), scenes = M.getScenes(doc), ids = new Set(scenes.map(sc => id(sc)));
    const nodes = [...scenes.map(sc => ({id:id(sc),kind:'scene',title:sc.heading,sceneId:id(sc),missing:false,changed:false})),
      ...s.shots.map(sh => ({...sh,kind:'shot',missing:!ids.has(sh.sceneId),changed:ids.has(sh.sceneId)&&!!sh.baseline&&sh.baseline!==sceneSignature(doc,sh.sceneId)})),
      ...s.nodes.map(n => ({...n,missing:!ids.has(n.sceneId),changed:ids.has(n.sceneId) && n.baseline !== sceneSignature(doc,n.sceneId)}))];
    const keys = new Set(nodes.map(n => n.id));
    const edges = [...nodes.filter(n => n.kind !== 'scene').map(n => ({from:n.sceneId,to:n.id,automatic:true})), ...s.links];
    return { nodes, edges:edges.map(e => ({...e,missing:!keys.has(e.from)||!keys.has(e.to)})) };
  }
  function link(doc, value) {
    const g = graph(doc), keys = new Set(g.nodes.map(n => n.id));
    if (!keys.has(value.from) || !keys.has(value.to) || value.from === value.to) throw new Error('Choose two different existing graph items.');
    if (g.edges.some(e => e.from === value.from && e.to === value.to)) throw new Error('These items are already linked.');
    return change(doc, s => s.links.push({id:M.uid('link'),from:value.from,to:value.to,label:text(value.label,200)||'affects'}));
  }
  function impact(doc, sceneId) {
    const g = graph(doc), seen = new Set([id(sceneId)]); let grew = true;
    while (grew) { grew = false; for (const e of g.edges) if (!e.missing && seen.has(e.from) && !seen.has(e.to)) { seen.add(e.to); grew = true; } }
    return g.nodes.filter(n => seen.has(n.id));
  }
  function acknowledge(doc, nodeId) { return change(doc, (s, next) => { const n = [...s.nodes,...s.shots].find(n => n.id === nodeId); if (!n) throw new Error('Item missing.'); n.baseline = sceneSignature(next,n.sceneId); }); }
  return { id, data, change, remove, lane, timeline, sceneRows, fact, continuity, arc, captureBranch, branchDocument, editBranch,
    previewBranch, mergeBranch, pacing, media, shot, animatic, rehearsal, recording, node, graph, link, impact, acknowledge, MEDIA_BUDGET };
});
