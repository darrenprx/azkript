/* Local organization primitives shared by browser, desktop and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./writing-tools.js'));
  else root.FDWorkspace = factory(root.FDModel, root.FDWritingTools);
})(typeof self !== 'undefined' ? self : this, function (M, W) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => String(value || '');
  const presets = {
    writing: { ribbonTab: 'home', collapsed: true, navigator: true, inspector: false, outline: false },
    production: { ribbonTab: 'production', collapsed: false, navigator: true, inspector: true, outline: true },
  };
  function layout(value = {}) {
    value = value && typeof value === 'object' ? value : {};
    return { ribbonTab: ['home','file','edit','view','format','insert','document','tools','production','help'].includes(value.ribbonTab) ? value.ribbonTab : 'home',
      collapsed: !!value.collapsed, navigator: value.navigator !== false, inspector: value.inspector !== false,
      outline: value.outline !== false, leftWidth: Math.min(420, Math.max(200, Number(value.leftWidth) || 268)),
      rightWidth: Math.min(440, Math.max(240, Number(value.rightWidth) || 304)),
      split: { enabled: !!value.split?.enabled, orientation: value.split?.orientation === 'horizontal' ? 'horizontal' : 'vertical',
        swapped: !!value.split?.swapped, mode: ['cards','sceneview','script','outline'].includes(value.split?.mode) ? value.split.mode : 'cards' } };
  }
  function search(doc, query, filter = 'all', limit = 200) {
    const terms = text(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return { rows: [], total: 0 };
    const rows = []; let total = 0;
    const add = row => {
      if (filter !== 'all' && row.kind !== filter) return;
      if (!terms.every(term => `${row.title} ${row.detail}`.toLocaleLowerCase().includes(term))) return;
      total++; if (rows.length < limit) rows.push(row);
    };
    for (const scene of M.getScenes(doc)) {
      add({ kind: 'scene', id: scene.id, paragraphId: scene.id,
        title: scene.title || scene.heading, detail: `${scene.heading} ${scene.synopsis || ''} ${scene.notes || ''}` });
      if (scene.notes) add({kind:'note',id:scene.id,paragraphId:scene.id,title:scene.title || scene.heading,detail:scene.notes});
    }
    for (const p of doc.paragraphs) {
      if (p.note) add({ kind: 'note', id: p.id, paragraphId: p.id, title: M.paragraphText(p), detail: typeof p.note === 'string' ? p.note : JSON.stringify(p.note) });
      for (const tag of p.tags || []) add({ kind: 'tag', id: p.id, paragraphId: p.id, title: typeof tag === 'string' ? tag : tag.name || tag.label || JSON.stringify(tag), detail: M.paragraphText(p) });
    }
    for (const note of doc.workspaceNotes || []) add({ kind: 'note', id: note.id, paragraphId: note.paragraphId || note.sceneId, title: note.title || 'Scratchpad', detail: note.text || '' });
    for (const beat of doc.beats || []) add({ kind: 'beat', id: beat.id, paragraphId: beat.sceneId, title: beat.title || 'Beat', detail: `${beat.text || ''} ${beat.body || ''} ${beat.summary || ''}` });
    for (const cast of M.getCharacters(doc)) add({ kind: 'character', id: cast.name, paragraphId: doc.paragraphs.find(p => p.type === 'Character' && M.paragraphText(p).trim().toUpperCase() === cast.name)?.id,
      title: cast.name, detail: JSON.stringify(doc.cast?.[cast.name] || {}) });
    return { rows, total };
  }
  function sceneOperation(document, operation, sceneIds, options = {}) {
    const doc = M.cloneDocument(document), scenes = M.getScenes(doc);
    const selected = scenes.filter(scene => sceneIds.includes(scene.id));
    if (!selected.length || selected.length !== new Set(sceneIds).size) throw new Error('Select existing scenes.');
    const range = scene => [scene.startIndex, scene.endIndex];
    // endIndex in the model is exclusive.
    const ids = new Set(selected.flatMap(scene => doc.paragraphs.slice(...range(scene)).map(p => p.id)));
    const details = [];
    if (operation === 'duplicate') {
      if (document.sourceFDX?.xml && /<(?:TagData|Cast|Actors|DisplayBoards|BeatBoard|LockedPages|Writer)\b/i.test(document.sourceFDX.xml))
        throw new Error('Duplicate scenes in a copy without native production reference graphs.');
      for (const scene of [...selected].reverse()) {
        const clones = copy(doc.paragraphs.slice(...range(scene))), mapping = new Map(), groups = new Map();
        for (const p of clones) { const old = p.id; p.id = M.uid('p'); mapping.set(old, p.id);
          if (p.dualGroup) { if (!groups.has(p.dualGroup)) groups.set(p.dualGroup, M.uid('dual')); p.dualGroup = groups.get(p.dualGroup); }
          // Native identity/reference fields cannot be copied to a new paragraph.
          delete p.native; delete p.nativeId; delete p.sourceId;
        }
        if (clones[0]?.scene) clones[0].scene.number = '';
        doc.paragraphs.splice(scene.endIndex, 0, ...clones);
        details.push(`Duplicate ${scene.title} (${clones.length} paragraphs)`);
      }
    } else if (operation === 'split') {
      if (selected.length !== 1) throw new Error('Choose one scene to split.');
      const scene = selected[0], index = doc.paragraphs.findIndex(p => p.id === options.paragraphId);
      if (index <= scene.startIndex || index >= scene.endIndex) throw new Error('Place the caret inside the scene after its heading.');
      if (doc.paragraphs[index].dualGroup && doc.paragraphs[index - 1]?.dualGroup === doc.paragraphs[index].dualGroup)
        throw new Error('Split before or after the complete dual-dialogue block.');
      if (['Dialogue', 'Parenthetical'].includes(doc.paragraphs[index].type)) throw new Error('Split before a character cue or action paragraph.');
      const heading = M.makeParagraph('Scene Heading', text(options.title).trim() || 'INT. NEW SCENE - DAY');
      doc.paragraphs.splice(index, 0, heading); details.push(`Insert a new scene before paragraph ${index + 1}`);
    } else if (operation === 'merge') {
      if (selected.length < 2) throw new Error('Select at least two adjacent scenes.');
      const indexes = selected.map(scene => scenes.indexOf(scene));
      if (indexes.some((index, i) => i && index !== indexes[i - 1] + 1)) throw new Error('Only adjacent scenes can be merged.');
      // Retain all headings and their metadata as Action text rather than silently dropping notes.
      const first = doc.paragraphs[selected[0].startIndex];
      for (const scene of selected.slice(1)) {
        const p = doc.paragraphs[scene.startIndex]; p.type = 'Action';
        const annotations = [scene.title, scene.synopsis, scene.notes].filter(Boolean).join('\n');
        if (annotations) first.scene.notes = [first.scene.notes, `${scene.heading}\n${annotations}`].filter(Boolean).join('\n\n');
        details.push(`Keep ${scene.heading} as action text and retain annotations in the merged scene`);
      }
    } else if (operation === 'omit' || operation === 'restore') {
      for (const scene of selected) { const p = doc.paragraphs[scene.startIndex]; p.scene = { ...p.scene, omit: operation === 'omit' }; }
      details.push(`${operation === 'omit' ? 'Omit' : 'Restore'} ${selected.length} scenes`);
    } else if (operation === 'move-up' || operation === 'move-down') {
      const first = scenes.indexOf(selected[0]), last = scenes.indexOf(selected.at(-1));
      if (last - first + 1 !== selected.length) throw new Error('Select adjacent scenes to move together.');
      const neighbor = operation === 'move-up' ? scenes[first - 1] : scenes[last + 1];
      if (!neighbor) throw new Error('The selected scenes are already at the boundary.');
      const block = doc.paragraphs.filter(p => ids.has(p.id));
      const anchor = operation === 'move-up' ? neighbor.id : doc.paragraphs[neighbor.endIndex]?.id;
      doc.paragraphs = doc.paragraphs.filter(p => !ids.has(p.id));
      const target = anchor ? doc.paragraphs.findIndex(p => p.id === anchor) : doc.paragraphs.length;
      doc.paragraphs.splice(target, 0, ...block); details.push(`Move ${selected.length} scenes ${operation === 'move-up' ? 'up' : 'down'}`);
    } else throw new Error('Unknown scene operation.');
    return { doc, details, selectedId: selected[0].id };
  }
  function semanticCompare(before, after) {
    const diff = W.compareDocuments(before, after, 10000), scenes = [], characters = [];
    const oldScenes = M.getScenes(before), newScenes = M.getScenes(after);
    const sceneId = scene => M.toUuid(scene.id);
    const oldIds = new Set(oldScenes.map(sceneId)), newIds = new Set(newScenes.map(sceneId));
    const sharedRanks = (entries, ids) => new Map(entries.map(sceneId).filter(id => ids.has(id)).map((id, index) => [id, index]));
    const oldRanks = sharedRanks(oldScenes, newIds), newRanks = sharedRanks(newScenes, oldIds);
    const paragraphScenes = (doc, entries) => {
      const index = new Map();
      for (const scene of entries) {
        const id = sceneId(scene);
        for (let i = scene.startIndex; i < scene.endIndex; i++) index.set(M.toUuid(doc.paragraphs[i].id), id);
      }
      return index;
    };
    const oldMap = paragraphScenes(before, oldScenes), newMap = paragraphScenes(after, newScenes);
    const byScene = new Map();
    for (const row of diff.rows) {
      for (const id of new Set([oldMap.get(row.id), newMap.get(row.id)])) {
        if (!id) continue;
        if (!byScene.has(id)) byScene.set(id, []);
        byScene.get(id).push(row);
      }
    }
    for (const scene of [...newScenes, ...oldScenes.filter(scene => !newIds.has(sceneId(scene)))]) {
      const id = sceneId(scene);
      const kind = !oldIds.has(id) ? 'added' : !newIds.has(id) ? 'removed' : oldRanks.get(id) !== newRanks.get(id) ? 'moved' : 'changed';
      const rows = byScene.get(id) || [];
      if (rows.length || kind !== 'changed') scenes.push({ id: scene.id, title: scene.title || scene.heading, kind, rows });
    }
    const dialogue = doc => {
      const result = new Map();
      let speaker = '';
      for (const p of doc.paragraphs) {
        if (p.type === 'Character') speaker = M.characterKey(M.paragraphText(p));
        else if (p.type === 'Dialogue' && speaker) {
          if (!result.has(speaker)) result.set(speaker, []);
          result.get(speaker).push(M.paragraphText(p));
        } else if (p.type !== 'Parenthetical') speaker = '';
      }
      return result;
    };
    const old = dialogue(before), next = dialogue(after);
    for (const name of new Set([...old.keys(), ...next.keys()])) if (JSON.stringify(old.get(name)) !== JSON.stringify(next.get(name))) characters.push({ name, before: (old.get(name) || []).join('\n'), after: (next.get(name) || []).join('\n') });
    return { ...diff, scenes, characters };
  }
  function project(value) {
    if (!value || value.format !== 'azkript-project' || value.version !== 1 || !Array.isArray(value.scripts)) throw new Error('Unsupported project manifest.');
    const seen = new Set();
    const scripts = value.scripts.map(script => {
      const p = text(script?.path);
      if (!p || p.includes('\\') || p.includes(':') || p.startsWith('/') || p.split('/').some(s => !s || s === '.' || s === '..' || /[. ]$|[<>"|?*\u0000-\u001f]/.test(s) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) || !/\.fdx$/i.test(p)) throw new Error('Project scripts must be relative FDX paths within the project folder.');
      if (seen.has(p.toLowerCase())) throw new Error('Duplicate script path.'); seen.add(p.toLowerCase());
      return { path: p, title: text(script.title).slice(0, 200) || p };
    });
    return { format: 'azkript-project', version: 1, id: text(value.id) || M.uid('project'), title: text(value.title).slice(0, 200) || 'Untitled project', scripts,
      bible: { cast: text(value.bible?.cast).slice(0, 100000), locations: text(value.bible?.locations).slice(0, 100000) } };
  }
  return { presets, layout, search, sceneOperation, semanticCompare, project };
});
