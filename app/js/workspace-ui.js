/* Workspace tools use the editor's existing history, persistence and dialogs. */
window.FDWorkspaceUI = function (host) {
  'use strict';
  const { state, els, openDialog, closeDialog, toast } = host;
  const T = window.FDWorkspace, M = window.FDModel, E = M.escapeHtml;
  const $ = selector => document.querySelector(selector);
  const KEY = 'azkript.workspace.v1';
  const quickOptions = ['newButton','openButton','saveButton','undoButton','redoButton','exportButton','quickSearchButton','quickNotesButton','quickProjectButton'];
  let prefs = {}, project = null, restoring = false, positionTimer, noteId = null;
  try { prefs = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) {}
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) prefs = {};
  if (!prefs.layouts || typeof prefs.layouts !== 'object' || Array.isArray(prefs.layouts)) prefs.layouts = {};
  if (!prefs.positions || typeof prefs.positions !== 'object' || Array.isArray(prefs.positions)) prefs.positions = {};
  prefs.quick = Array.isArray(prefs.quick) ? prefs.quick.filter(id=>quickOptions.includes(id)) : quickOptions.slice(0,6);
  const notifyError = error => toast('Workspace action failed', error.message || String(error), 'error');
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); return true; }
    catch (error) { notifyError(new Error('Workspace preferences could not be saved.')); return false; }
  }
  function capture() { return T.layout({ ribbonTab: state.ribbonTab, collapsed: els.appShell.classList.contains('ribbon-collapsed'),
    navigator: state.navigatorVisible, inspector: !els.appShell.classList.contains('inspector-closed'), outline: state.showOutline,
    leftWidth: prefs.current?.leftWidth, rightWidth: prefs.current?.rightWidth, split: state.splitView }); }
  function apply(value) {
    const layout = T.layout(value); restoring = true;
    state.navigatorVisible = layout.navigator; state.showOutline = layout.outline; state.splitView = layout.split;
    els.scenesPanel.hidden = !layout.navigator; els.workspace.classList.toggle('no-navigator', !layout.navigator);
    els.appShell.classList.toggle('inspector-closed', !layout.inspector);
    const inspector = $('.inspector'); if (inspector) inspector.inert = !layout.inspector;
    els.workspace.style.setProperty('--workspace-left-width', `${layout.leftWidth}px`);
    els.workspace.style.setProperty('--workspace-right-width', `${layout.rightWidth}px`);
    host.switchRibbonTab(layout.ribbonTab); host.toggleRibbonCollapsed(layout.collapsed);
    host.toggleSplitView(layout.split.enabled); host.renderAll(); host.fitPaper(); restoring = false; prefs.current = layout; persist();
  }
  function quickAccess() {
    for (const button of document.querySelectorAll('.quick-access > button')) button.hidden = !prefs.quick.includes(button.id);
    for (const divider of document.querySelectorAll('.quick-access__divider')) divider.hidden = true;
  }
  function savePosition() {
    if (restoring || !state.doc) return;
    prefs.current = capture();
    const positions = prefs.positions;
    positions[state.doc.documentId] = { selectedId: state.selectedId, scroll: els.paperScroll.scrollTop,
      pageScroll: els.pagePreview.scrollTop, view: state.view, mode: state.mode, zoom: state.zoom, at: Date.now() };
    const entries = Object.entries(positions).sort((a,b) => b[1].at - a[1].at);
    prefs.positions = Object.fromEntries(entries.slice(0,100)); persist();
  }
  function restorePosition() {
    const id = state.doc.documentId, position = prefs.positions[id];
    if (!position) return;
    restoring = true;
    host.setView(position.view); host.setMode(position.mode); state.zoom = Math.min(1.6, Math.max(.6, Number(position.zoom) || 1)); host.fitPaper();
    requestAnimationFrame(() => {
      if (state.doc.documentId !== id) { restoring = false; return; }
      if (state.doc.paragraphs.some(p => p.id === position.selectedId)) host.focusParagraph(position.selectedId, 'start');
      els.paperScroll.scrollTop = Number(position.scroll) || 0; els.pagePreview.scrollTop = Number(position.pageScroll) || 0;
      restoring = false;
    });
  }
  function change(document) {
    state.history.finishBurst(); state.doc = document; host.markDirty(); state.history.record(); host.renderAll();
  }
  function openWorkspace() {
    savePosition();
    const current = capture();
    openDialog({ title: 'Workspace', eyebrow: 'Writing setup', wide: true,
      body: `<div class="workspace-actions"><button class="btn" id="presetWriting">Writing workspace</button><button class="btn" id="presetProduction">Production workspace</button></div>
        <div class="field-grid"><label class="field"><span>Navigator width</span><input class="input" id="layoutLeft" type="number" min="200" max="420" value="${current.leftWidth}"></label>
        <label class="field"><span>Inspector width</span><input class="input" id="layoutRight" type="number" min="240" max="440" value="${current.rightWidth}"></label></div>
        <h3>Quick access</h3><div class="workspace-actions">${quickOptions.map(id => `<label><input type="checkbox" data-quick="${id}" ${prefs.quick.includes(id) ? 'checked' : ''}> ${E($('#'+id).getAttribute('aria-label'))}</label>`).join('')}</div>
        <label class="field"><span>Layout name</span><input class="input" id="layoutName" maxlength="60" placeholder="My writing setup"></label>
        <div class="workspace-actions">${Object.keys(prefs.layouts).map((name,i) => `<button class="btn" data-layout="${i}">${E(name)}</button>`).join('')}</div>
        <h3>Organize your work</h3><div class="workspace-actions"><button class="btn" id="workspaceSearch">Search everything</button><button class="btn" id="workspaceNotes">Linked scratchpad</button><button class="btn" id="workspaceProject">Project folder</button><button class="btn" id="workspaceScenes">Scene operations</button><button class="btn" id="workspaceMilestones">Draft milestones</button><button class="btn" id="workspaceRelease">Release and updates</button></div>`,
      actions: [{ label: 'Save layout', keepOpen: true, onClick: () => {
        const name = $('#layoutName').value.trim();
        if (!name) { $('#layoutName').focus(); return; }
        if (['__proto__','constructor','prototype'].includes(name)) return;
        prefs.layouts[name] = T.layout({ ...capture(), leftWidth: $('#layoutLeft').value, rightWidth: $('#layoutRight').value });
        prefs.quick = [...document.querySelectorAll('[data-quick]:checked')].map(el => el.dataset.quick);
        apply(prefs.layouts[name]); quickAccess(); openWorkspace();
      } }, { label: 'Apply', onClick: () => {
        const value = T.layout({ ...capture(), leftWidth: $('#layoutLeft').value, rightWidth: $('#layoutRight').value });
        prefs.quick = [...document.querySelectorAll('[data-quick]:checked')].map(el => el.dataset.quick);
        apply(value); quickAccess();
      } }, { label: 'Close' }] });
    $('#presetWriting').onclick = () => { apply(T.presets.writing); closeDialog(); };
    $('#presetProduction').onclick = () => { apply(T.presets.production); closeDialog(); };
    document.querySelectorAll('[data-layout]').forEach(button => button.onclick = () => { apply(prefs.layouts[Object.keys(prefs.layouts)[button.dataset.layout]]); closeDialog(); });
    for (const [id, run] of Object.entries({ workspaceSearch: openSearch, workspaceNotes: toggleNotes, workspaceProject: openProject, workspaceScenes: openScenes, workspaceMilestones: openMilestones, workspaceRelease: openRelease }))
      $('#'+id).onclick = () => { closeDialog(run); };
  }
  function jump(row) {
    if (row.paragraphId && state.doc.paragraphs.some(p => p.id === row.paragraphId)) {
        host.setView('script'); host.setMode('write'); host.focusParagraph(row.paragraphId, 'start');
    } else if (row.kind === 'beat') { host.setView('beatboard'); state.selectedBeatId = row.id; host.renderAll(); }
    else if (row.kind === 'character') host.setView('characters');
    if (row.kind === 'note' && state.doc.workspaceNotes?.some(n => n.id === row.id)) { noteId = row.id; showNotes(); }
  }
  function openSearch() {
    const documentId = state.doc.documentId;
    let rows = [], index = 0, timer;
    openDialog({ title: 'Search everything', eyebrow: 'Scenes · notes · beats · characters · tags', wide: true,
      body: `<label class="field"><span>Search</span><input class="input" id="unifiedQuery" autocomplete="off"></label>
        <label class="field"><span>Filter</span><select class="input" id="unifiedFilter">${['all','scene','note','beat','character','tag'].map(kind => `<option value="${kind}">${kind === 'all' ? 'Everything' : kind}</option>`).join('')}</select></label>
        <p id="unifiedStatus" role="status">Enter a search term.</p><div id="unifiedResults" class="workspace-results"></div>`, actions: [{ label: 'Close' }] });
    function render() {
      if (state.doc.documentId !== documentId || !$('#unifiedQuery')) return;
      const result = T.search(state.doc, $('#unifiedQuery').value, $('#unifiedFilter').value); rows = result.rows; index = 0;
      $('#unifiedStatus').textContent = `${result.total} results${result.total > rows.length ? `; showing ${rows.length}` : ''}`;
      $('#unifiedResults').innerHTML = rows.map((row,i) => `<button class="history-version" data-result="${i}"><strong>${E(row.kind)} · ${E(row.title)}</strong><span>${E(row.detail.slice(0,180))}</span></button>`).join('');
      document.querySelectorAll('[data-result]').forEach(button => button.onclick = () => closeDialog(() => jump(rows[button.dataset.result])));
    }
    $('#unifiedQuery').oninput = () => { clearTimeout(timer); timer = setTimeout(render, 120); };
    $('#unifiedFilter').onchange = render;
    els.dialogBody.onkeydown = event => {
      if (!$('#unifiedQuery') || event.isComposing || state.composing) return;
      if (['ArrowDown','ArrowUp'].includes(event.key) && rows.length) {
        event.preventDefault(); const buttons = [...document.querySelectorAll('[data-result]')];
        const active = buttons.indexOf(document.activeElement); index = active < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        buttons[index].focus();
      } else if (event.key === 'Enter' && event.target.id === 'unifiedQuery' && rows.length) { event.preventDefault(); closeDialog(() => jump(rows[0])); }
    };
  }
  // A dock in the editor stage keeps notes out of screenplay paragraphs and printing.
  const dock = document.createElement('aside'); dock.id = 'scratchpadDock'; dock.className = 'scratchpad-dock'; dock.hidden = true;
  dock.setAttribute('aria-label','Linked scratchpad');
  els.editorStage.appendChild(dock);
  function selectedNote() { return state.doc.workspaceNotes?.find(n => n.id === noteId); }
  function showNotes() {
    dock.hidden = false; const notes = state.doc.workspaceNotes || []; if (!selectedNote()) noteId = notes[0]?.id;
    requestAnimationFrame(host.fitPaper);
    const note = selectedNote();
    dock.innerHTML = `<div class="workspace-actions"><strong>Scratchpad</strong><button class="btn" id="newScratch">New note</button><button class="btn" id="closeScratch" aria-label="Close scratchpad">Close</button></div>
      <label class="field"><span>Notes</span><select class="input" id="scratchList"><option value="">Choose a note</option>${notes.map(n => `<option value="${E(n.id)}" ${n.id === noteId ? 'selected' : ''}>${E(n.title)}</option>`).join('')}</select></label>
      ${note ? `<label class="field"><span>Title</span><input class="input" id="scratchTitle" maxlength="200" value="${E(note.title)}"></label>
      <label class="field"><span>Working notes</span><textarea class="input" rows="7" id="scratchText">${E(note.text)}</textarea></label>
      <p class="scratch-reference">${note.quote ? `“${E(note.quote)}”` : 'No quoted selection'} · ${note.paragraphId && state.doc.paragraphs.some(p => p.id === note.paragraphId) ? 'Linked to script' : 'Reference unavailable'}</p>
      <div class="workspace-actions"><button class="btn" id="scratchJump">Go to reference</button><button class="btn" id="scratchLink">Link current selection</button><button class="btn" id="scratchDelete">Delete note</button></div>` : '<p>Create a note to keep research alongside this draft.</p>'}`;
    $('#closeScratch').onclick = () => { dock.hidden = true; host.fitPaper(); };
    $('#newScratch').onclick = () => {
      const next = M.cloneDocument(state.doc), id = M.uid('note'); next.workspaceNotes ||= [];
      next.workspaceNotes.push({ id, title: 'Untitled note', text: '', paragraphId: state.selectedId || '', quote: '' });
      noteId = id; change(next); showNotes(); $('#scratchTitle').focus();
    };
    $('#scratchList').onchange = event => { noteId = event.target.value; showNotes(); };
    if (!note) return;
    const edit = () => { const next = M.cloneDocument(state.doc), target = next.workspaceNotes.find(n => n.id === noteId);
      target.title = $('#scratchTitle').value || 'Untitled note'; target.text = $('#scratchText').value; change(next); };
    $('#scratchTitle').onchange = edit; $('#scratchText').oninput = edit;
    $('#scratchJump').onclick = () => jump({ paragraphId: note.paragraphId });
    $('#scratchLink').onpointerdown = event => event.preventDefault();
    $('#scratchLink').onclick = () => {
      const selection = FDCoreWriting.captureSelection(els.editor); const next = M.cloneDocument(state.doc), target = next.workspaceNotes.find(n => n.id === noteId);
      target.paragraphId = selection?.start.id || state.selectedId || ''; target.quote = (window.getSelection()?.toString() || '').slice(0,1000);
      change(next); showNotes();
    };
    $('#scratchDelete').onclick = () => openDialog({ title: 'Delete this note?', body: `<p>${E(note.title)}</p>`, actions: [{ label:'Cancel' }, { label:'Delete note', kind:'danger', onClick: () => {
      const next = M.cloneDocument(state.doc); next.workspaceNotes = next.workspaceNotes.filter(n => n.id !== noteId); change(next); showNotes();
    } }] });
  }
  function toggleNotes() { if (dock.hidden) showNotes(); else { dock.hidden = true; host.fitPaper(); } }
  function openScenes() {
    const original = state.doc, version = state.editVersion, caret = state.selectedId;
    const scenes = M.getScenes(original);
    openDialog({ title: 'Scene operations', eyebrow: 'Preview before applying', wide: true,
      body: `<label class="field"><span>Operation</span><select class="input" id="sceneOperation">${['split','merge','duplicate','omit','restore','move-up','move-down'].map(op => `<option>${op}</option>`).join('')}</select></label>
      <label class="field"><span>New scene heading (split)</span><input class="input" id="splitHeading" placeholder="INT. NEW SCENE - DAY"></label>
      <p>Split at the active paragraph. Merge keeps the other headings as action text, including their notes.</p>
      <div class="workspace-results">${scenes.map(scene => `<label class="scene-operation-row"><input type="checkbox" data-scene-choice="${E(scene.id)}"> ${E(scene.number)} · ${E(scene.heading)}</label>`).join('')}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Preview', kind:'primary', keepOpen: true, onClick: () => {
        try {
          const ids = [...document.querySelectorAll('[data-scene-choice]:checked')].map(el => el.dataset.sceneChoice);
          const result = T.sceneOperation(original, $('#sceneOperation').value, ids, { paragraphId: caret, title: $('#splitHeading').value });
          openDialog({ title: 'Review scene changes', body: `<ul>${result.details.map(item => `<li>${E(item)}</li>`).join('')}</ul><p>${original.paragraphs.length} → ${result.doc.paragraphs.length} paragraphs. Undo restores this operation.</p>`,
            actions: [{ label:'Back', onClick:openScenes }, { label:'Apply scene changes', kind:'primary', onClick: () => {
              if (state.doc !== original || state.editVersion !== version) { notifyError(new Error('The draft changed. Preview the operation again.')); return; }
              change(result.doc); state.selectedId = result.selectedId; host.focusParagraph(result.selectedId,'start');
            } }] });
        } catch (error) { notifyError(error); }
      } }] });
  }
  async function openMilestones() {
    const current = state.doc;
    try {
      const versions = host.desktop?.listBackups ? await host.desktop.listBackups({ documentId: current.documentId }) : await host.browserBackups.list(current.documentId);
      if (state.doc !== current) return;
      openDialog({ title: 'Draft milestones', eyebrow: 'Named drafts and scene comparison', wide:true,
        body: `<label class="field"><span>Milestone name</span><input class="input" id="milestoneName" maxlength="100" placeholder="First complete draft"></label><div class="workspace-results">${versions.filter(v => v.label?.startsWith('Milestone: ')).map(v => `<button class="history-version" data-milestone="${E(v.id)}"><strong>${E(v.label.slice(11))}</strong><span>${E(new Date(v.createdAt).toLocaleString())}</span></button>`).join('') || '<p>No named milestones yet.</p>'}</div>`,
        actions: [{ label:'Save milestone', keepOpen:true, onClick: async () => {
          const name = $('#milestoneName')?.value.trim(); if (!name) return;
          if (await host.saveVersionSnapshot(`Milestone: ${name}`)) openMilestones();
        } }, { label:'Version history / restore', onClick: host.openVersionHistory }, { label:'Close' }] });
      document.querySelectorAll('[data-milestone]').forEach(button => button.onclick = async () => {
        try {
          const entry = host.desktop?.readBackup ? await host.desktop.readBackup(button.dataset.milestone) : await host.browserBackups.read(button.dataset.milestone);
          if (state.doc !== current || !entry) return;
          const before = entry.document || FDX.parse(entry.contents), diff = T.semanticCompare(before, state.doc);
          const rows = group => group.map(row => `<details><summary>${E(row.kind || row.name)}${row.title ? ` · ${E(row.title)}` : ''}</summary>${row.rows ? row.rows.map(r => `<p>${E(r.kind)} · ${E(r.type)}</p><pre>${E(r.before)}</pre><pre>${E(r.after)}</pre>`).join('') : `<pre>${E(row.before)}</pre><pre>${E(row.after)}</pre>`}</details>`).join('');
          openDialog({ title:entry.label.slice(11), eyebrow:'Compared with current draft', wide:true,
            body:`<h3>Scenes (${diff.scenes.length})</h3><div class="text-diff">${rows(diff.scenes) || '<p>No scene changes.</p>'}</div><h3>Character dialogue (${diff.characters.length})</h3><div class="text-diff">${rows(diff.characters)}</div><p>Other changed fields: ${E(diff.metadataChanged.join(', ') || 'none')}</p>`, actions:[{label:'Back',onClick:openMilestones},{label:'Close'}] });
        } catch(error) { notifyError(error); }
      });
    } catch(error) { notifyError(error); }
  }
  async function openProject() {
    const bridge = host.desktop;
    if (!bridge?.projectOpen) { openDialog({ title:'Project folders', body:'<p>Use the desktop app to manage a project folder with multiple FDX scripts and a shared cast/location bible.</p>', actions:[{label:'Close'}] }); return; }
    openDialog({ title: project?.manifest.title || 'Project folder', eyebrow:'Scripts and shared bible', wide:true,
      body: project ? `<p>${E(project.root)}</p><div class="workspace-actions">${project.manifest.scripts.map((script,i) => `<button class="btn" data-project-script="${i}">${E(script.title)}</button>`).join('')}</div>
        <label class="field"><span>Shared cast bible</span><textarea class="input" rows="6" id="projectCast">${E(project.manifest.bible.cast)}</textarea></label><label class="field"><span>Shared location bible</span><textarea class="input" rows="6" id="projectLocations">${E(project.manifest.bible.locations)}</textarea></label>` : '<p>Choose a folder. New projects store a project.azkproj manifest and independent FDX files.</p>',
      actions: [{label:'Open project',keepOpen:true,onClick:async()=>{ try { const result=await bridge.projectOpen({}); if(result){ project=result; openProject(); } }catch(error){notifyError(error);} }},
        {label:'Create project',keepOpen:true,onClick:async()=>{ try {const result=await bridge.projectOpen({create:true});if(result){project=result;openProject();}}catch(error){notifyError(error);} }},
        ...(project ? [{label:'Add script copy',keepOpen:true,onClick:async()=>{
          try {
            const copy = M.cloneDocument(state.doc); copy.documentId = M.toUuid(M.uid('document'));
            const manifest = { ...project.manifest, bible: { cast: $('#projectCast').value, locations: $('#projectLocations').value } };
            project=await bridge.projectSave({manifest,expectedRoot:project.root,expectedIdentity:project.identity,script:{title:copy.title,contents:FDX.serialize(copy)}});openProject();
          }catch(error){notifyError(error);}
        }},{label:'Save bible',keepOpen:true,onClick:async()=>{
          try {const manifest={...project.manifest,bible:{cast:$('#projectCast').value,locations:$('#projectLocations').value}};project=await bridge.projectSave({manifest,expectedRoot:project.root,expectedIdentity:project.identity});openProject();}catch(error){notifyError(error);}
        }}] : []), {label:'Close'}] });
    document.querySelectorAll('[data-project-script]').forEach(button=>button.onclick=async()=>{
      try {if(!(await host.confirmDiscard('Switching scripts replaces this draft.')))return;
        const payload=await bridge.projectRead(project.manifest.scripts[button.dataset.projectScript].path, project.root);await host.handleFilePayload(payload);closeDialog();
      }catch(error){notifyError(error);}
    });
  }
  function openRelease() {
    const stage = async rollback => {
      try {
        const result = await host.desktop.stageUpdate({rollback});
        if (result) openDialog({title:rollback ? 'Rollback staged' : 'Update staged',body:`<p>${E(result.version)} · ${E(result.sha256)}</p><p>Close Azkript, then run the verified installer from its folder. Keep your previous installer and back up drafts before changing versions.</p>`,actions:[{label:'Show staged files',onClick:()=>host.desktop.showInFolder(result.path)},{label:'Close'}]});
      } catch(error) { notifyError(error); }
    };
    openDialog({ title:'Release and updates', body:`<p>Installed version: ${E(state.appInfo?.version || 'Browser build')}</p><p>Local update packages are verified before staging. Keep the previous installer for rollback; user data stays in your profile.</p><p>Code signing is pending a signing identity. Unsigned packages cannot pass the signed-update gate.</p>`,
      actions:[...(host.desktop?.stageUpdate ? [{label:'Verify local update',keepOpen:true,onClick:()=>stage(false)},{label:'Verify rollback package',keepOpen:true,onClick:()=>stage(true)}]:[]),{label:'Close'}] });
  }
  const button = document.createElement('button'); button.id='workspaceButton';button.className='icon-btn icon-btn--quiet';button.type='button';button.setAttribute('aria-label','Workspace');button.dataset.tooltip='Workspace and project tools';button.innerHTML='<svg><use href="#i-sliders"></use></svg>';button.onclick=openWorkspace;
  $('.titlebar__actions').insertBefore(button, $('#settingsButton'));
  for (const [id,label,symbol,run] of [['quickSearchButton','Search everything','search',openSearch],['quickNotesButton','Linked scratchpad','note',toggleNotes],['quickProjectButton','Project folder','folder',openProject]]) {
    const quick=document.createElement('button');quick.type='button';quick.id=id;quick.className='icon-btn icon-btn--quiet';quick.setAttribute('aria-label',label);quick.dataset.tooltip=label;quick.innerHTML=`<svg><use href="#i-${symbol}"></use></svg>`;quick.onclick=run;$('.quick-access').appendChild(quick);
  }
  document.addEventListener('keydown',event=>{
    if(event.isComposing||state.composing||event.keyCode===229)return;
    if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='f'&&!document.querySelector('dialog[open]')){event.preventDefault();event.stopImmediatePropagation();openSearch();}
  },true);
  for(const scroller of [els.paperScroll,els.pagePreview])scroller.addEventListener('scroll',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(savePosition,350);},{passive:true});
  document.addEventListener('click',()=>{if(!restoring){clearTimeout(positionTimer);positionTimer=setTimeout(savePosition,350);}});
  window.addEventListener('beforeunload',savePosition);
  quickAccess(); if(prefs.current)apply(prefs.current); restorePosition();
  return { beforeLoad:savePosition, afterLoad:()=>{dock.hidden=true;restorePosition();}, commands:()=>[
    {id:'workspace',label:'Workspace layouts and quick access',group:'View',icon:'sliders',run:openWorkspace},
    {id:'unified-search',label:'Search scenes, notes, beats, characters and tags',group:'Navigate',icon:'search',run:openSearch},
    {id:'scratchpad',label:'Linked notes scratchpad',group:'View',icon:'note',run:toggleNotes},
    {id:'project-folder',label:'Project folder and shared bible',group:'File',icon:'folder',run:openProject},
    {id:'scene-operations',label:'Split, merge, duplicate and bulk scene operations',group:'Edit',icon:'scene',run:openScenes},
    {id:'milestones',label:'Draft milestones and semantic comparison',group:'File',icon:'backup',run:openMilestones},
    {id:'release-update',label:'Release and verified local update',group:'Help',icon:'download',run:openRelease},
  ] };
};
