"use strict";

window.AzkriptRenderer.planningViews = function ({
  documentSession,
  editorActions,
  editorState,
  fileActions,
  modalActions,
  pageActions,
  preferences,
  productionActions,
  ribbonActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
  writingTools,
}) {
  const { $, $$, ELEMENTS, PALETTE, clamp, els, escapeHtml, escapeSelector, getCharacters, getLocations, getScenes, getStats, icon, markRevision, paragraphText, plural, revisionEntry, uid } = shared;

  // Azkript complete feature set & dialogs
  function setNavigatorTab(tabName) {
    workspaceState.navTab = tabName || "scenes";
    $$(".navigator-tab").forEach((tab) => {
      const active = tab.dataset.navTab === workspaceState.navTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$("[data-nav-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.navPane !== workspaceState.navTab;
    });
    renderNavigatorSubTabs(workspaceState.sceneQuery.trim().toLowerCase());
  }
  function openBeatDialog(beatId) {
    const beats = documentSession.doc.beats || (documentSession.doc.beats = []);
    const beat = beats.find((b) => b.id === beatId);
    if (!beat) return;
    modalActions.openDialog({
      eyebrow: `Beat Board · ${beat.category === "Structure Point" ? "Structure Marker" : "Beat"}`,
      title: beat.title || "Edit Beat",
      body: `
        <div class="field-grid">
          <label class="field"><span>Beat Title</span><input id="beatTitleInput" type="text" maxlength="140" value="${escapeHtml(beat.title || "")}"></label>
          <label class="field"><span>Goal Page</span><input id="beatGoalPageInput" type="text" maxlength="20" value="${escapeHtml(beat.goalPage || "")}" placeholder="e.g. 12"></label>
        </div>
        <label class="field"><span>Body / Notes</span><textarea id="beatBodyInput" rows="4" maxlength="1000" placeholder="Story beat, conflict, character turn…">${escapeHtml(beat.body || "")}</textarea></label>
        <div class="field-grid">
          <label class="field"><span>Beat Type</span><select id="beatTypeSelect"><option value="Beat"${beat.category !== "Structure Point" ? " selected" : ""}>Story Beat</option><option value="Structure Point"${beat.category === "Structure Point" ? " selected" : ""}>Structure Point</option></select></label>
          <label class="field"><span>Connect to Beat</span><select id="beatConnectSelect"><option value="">No connection</option>${beats
            .filter((b) => b.id !== beat.id)
            .map(
              (b) =>
                `<option value="${escapeHtml(b.id)}"${beat.targetId === b.id ? " selected" : ""}>${escapeHtml(b.title)}</option>`,
            )
            .join("")}</select></label>
        </div>
        <div class="field"><span>Beat Color</span><div class="scene-color-row" id="beatColors">${PALETTE.slice(0, 8)
          .map(
            (color) =>
              `<button type="button" class="scene-color${beat.color === color ? " is-active" : ""}" data-color="${escapeHtml(color)}" style="--scene-color:${color}" aria-label="Color ${color}"></button>`,
          )
          .join("")}</div></div>`,
      actions: [
        {
          label: "Delete beat",
          kind: "danger",
          onClick: () => {
            documentSession.doc.beats = beats.filter((b) => b.id !== beat.id);
            fileActions.markDirty();
            documentSession.history.record();
            renderBeatBoard();
            modalActions.toast("Beat removed", "Beat deleted from the board.", "info", 1800);
          },
        },
        {
          label: "Send to Script",
          onClick: () => sendBeatToScript(beat.id),
        },
        { label: "Cancel" },
        {
          label: "Save Beat",
          kind: "primary",
          onClick: () => {
            beat.title = $("#beatTitleInput", els.dialogBody).value.trim() || "Untitled Beat";
            beat.goalPage = $("#beatGoalPageInput", els.dialogBody).value.trim();
            beat.body = $("#beatBodyInput", els.dialogBody).value.trim();
            beat.category = $("#beatTypeSelect", els.dialogBody).value;
            const target = $("#beatConnectSelect", els.dialogBody).value;
            beat.targetId = target || "";
            const activeColor = $("#beatColors .is-active", els.dialogBody)?.dataset.color;
            if (activeColor) beat.color = activeColor;
            fileActions.markDirty();
            documentSession.history.record();
            renderBeatBoard();
            modalActions.toast("Beat saved", `${beat.title} updated on Beat Board.`, "success", 2000);
          },
        },
      ],
    });
    $$("#beatColors .scene-color", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#beatColors .scene-color", els.dialogBody).forEach((item) => item.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    });
  }
  function addBeat(type = "beat", x = null, y = null) {
    if (!documentSession.doc.beats) documentSession.doc.beats = [];
    const count = documentSession.doc.beats.length;
    const newBeat = {
      id: uid("beat"),
      title: type === "structure" ? `ACT ${Math.min(3, Math.floor(count / 2) + 1)} POINT` : `Beat ${count + 1}`,
      body: type === "structure" ? "Structural milestone or turning point." : "Describe the dramatic action or turning point.",
      color: PALETTE[count % PALETTE.length],
      x: x !== null ? x : 48 + (count % 4) * 280,
      y: y !== null ? y : 48 + Math.floor(count / 4) * 190,
      width: 240,
      category: type === "structure" ? "Structure Point" : "Beat",
      goalPage: String((count + 1) * 10),
      targetId: "",
    };
    documentSession.doc.beats.push(newBeat);
    fileActions.markDirty();
    documentSession.history.record();
    if (workspaceState.view !== "beatboard") workspaceLayout.setView("beatboard");
    else renderBeatBoard();
    openBeatDialog(newBeat.id);
  }
  function alignBeats(mode) {
    if (!mode || !documentSession.doc.beats || !documentSession.doc.beats.length) return;
    const beats = documentSession.doc.beats;
    if (mode === "row") {
      beats.forEach((b, i) => {
        b.x = 40 + i * 265;
        b.y = 72;
      });
    } else if (mode === "column") {
      beats.forEach((b, i) => {
        b.x = 72;
        b.y = 40 + i * 175;
      });
    } else if (mode === "cascade") {
      beats.forEach((b, i) => {
        b.x = 48 + i * 110;
        b.y = 48 + i * 84;
      });
    } else if (mode === "grid") {
      beats.forEach((b, i) => {
        b.x = 40 + (i % 4) * 270;
        b.y = 40 + Math.floor(i / 4) * 185;
      });
    }
    fileActions.markDirty();
    documentSession.history.record();
    renderBeatBoard();
    modalActions.toast("Beats aligned", `Arranged ${beats.length} beats in ${mode} layout.`, "info", 1800);
  }
  function sendBeatToScript(beatId) {
    const beats = documentSession.doc.beats || [];
    const targetBeats = beatId ? beats.filter((b) => b.id === beatId) : beats;
    if (!targetBeats.length) {
      modalActions.toast("No beats to send", "Add a beat on the Beat Board first.", "info", 2000);
      return;
    }
    targetBeats.forEach((beat) => {
      const headingText = beat.title.toUpperCase().startsWith("INT.") || beat.title.toUpperCase().startsWith("EXT.")
        ? beat.title.toUpperCase()
        : `INT. ${beat.title.toUpperCase()} - DAY`;
      documentSession.doc.paragraphs.push(
        editorActions.createParagraph("Scene Heading", escapeHtml(headingText), {
          scene: {
            synopsis: beat.body || "",
            color: beat.color || "#0f6cbd",
            title: beat.title,
            notes: beat.goalPage ? `Goal Page: ${beat.goalPage}` : "",
          },
        }),
      );
      if (beat.body) {
        documentSession.doc.paragraphs.push(editorActions.createParagraph("Action", escapeHtml(beat.body)));
      }
    });
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    workspaceLayout.setView("script");
    modalActions.toast("Sent to Script", `${targetBeats.length} beat${targetBeats.length === 1 ? "" : "s"} appended as screenplay scenes.`, "success");
  }
  function sendCardsToScript() {
    const scenes = getScenes(documentSession.doc);
    let updated = 0;
    scenes.forEach((scene) => {
      const syn = (scene.paragraph.scene?.synopsis || "").trim();
      if (!syn) return;
      const nextPara = documentSession.doc.paragraphs[scene.startIndex + 1];
      if (!nextPara || nextPara.type === "Scene Heading") {
        documentSession.doc.paragraphs.splice(scene.startIndex + 1, 0, editorActions.createParagraph("Action", escapeHtml(syn)));
        updated += 1;
      }
    });
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    workspaceLayout.setView("script");
    modalActions.toast(
      "Index Cards synced to Script",
      updated ? `${updated} card synopses inserted into scene action.` : "All index cards are already synced with script scenes.",
      "success",
    );
  }
  function openCastListOptions() {
    const characters = getCharacters(documentSession.doc);
    const rows = characters.length
      ? characters
          .map(
            (character, index) => `
            <div class="shortcut-row">
              <span style="display:flex;align-items:center;gap:8px"><span class="revision-dot" style="background:${escapeHtml(character.color || "#0f6cbd")}"></span>${escapeHtml(character.name)}</span>
              <input type="text" class="cast-actor-input" data-cast-index="${index}" value="${escapeHtml((documentSession.doc.cast[character.id] && documentSession.doc.cast[character.id].actor) || character.actor || "")}" placeholder="Actor" style="max-width:150px">
            </div>`,
          )
          .join("")
      : `<p class="dialog-note">No speaking characters yet. Write dialogue to populate the cast list.</p>`;
    modalActions.openDialog({
      eyebrow: "Format · Cast",
      title: "Cast List",
      body: `<div class="shortcut-grid" style="grid-template-columns:1fr">${rows}</div><p class="dialog-note">Actor names are stored with the document and appear in reports.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save cast",
          kind: "primary",
          onClick: () => {
            $$("[data-cast-index]", els.dialogBody).forEach((input) => {
              const character = characters[Number(input.dataset.castIndex)];
              if (!character) return;
              documentSession.doc.cast[character.id] = documentSession.doc.cast[character.id] || {};
              documentSession.doc.cast[character.id].actor = input.value.trim();
            });
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            modalActions.toast("Cast list updated", "Actor names are saved with the screenplay.", "success");
          },
        },
      ],
    });
  }
  /* ---------- beat board -------------------------------------------- */
  function toggleBeatSnap() {
    workspaceState.beatSnap = !workspaceState.beatSnap;
    syncBeatSnapButton();
    fileActions.persistPrefs();
    ribbonActions.syncRibbon();
    ribbonActions.ribbonToast("Grid snapping", workspaceState.beatSnap ? "Beats snap to the 24 px story grid." : "Beats move freely.", "info", 1800);
  }
  /* The snap toggle is a standalone control, not a `[data-ribbon-command]` node,
   * so syncRibbon() never touches it. Keep its visual and accessible state in
   * one place — the click handler used to toggle the class only, leaving
   * aria-pressed stuck at its initial "true" while the grid was off. */
  function syncBeatSnapButton() {
    const button = $("#beatSnapToggle");
    if (!button) return;
    button.classList.toggle("is-active", workspaceState.beatSnap);
    button.setAttribute("aria-pressed", String(workspaceState.beatSnap));
  }
  function toggleBeatConnectMode() {
    if (workspaceState.view !== "beatboard") workspaceLayout.setView("beatboard");
    workspaceState.beatConnectMode = !workspaceState.beatConnectMode;
    workspaceState.beatConnectSource = null;
    ribbonActions.ribbonToast(
      "Beat connections",
      workspaceState.beatConnectMode ? "Click a beat, then another, to draw a story arrow." : "Connection mode off.",
      "info",
      2400,
    );
    ribbonActions.syncRibbon();
  }
  function connectBeats(sourceId, targetId) {
    const beats = documentSession.doc.beats || [];
    const source = beats.find((beat) => beat.id === sourceId);
    const target = beats.find((beat) => beat.id === targetId);
    if (!source || !target || source.id === target.id) return;
    source.targetId = target.id;
    fileActions.markDirty();
    documentSession.history.record();
    renderBeatBoard();
    ribbonActions.ribbonToast("Beats connected", `${source.title} → ${target.title}`, "success", 1800);
  }
  function disconnectSelectedBeat() {
    const beatId = workspaceState.selectedBeatId;
    const beats = documentSession.doc.beats || [];
    const beat = beatId ? beats.find((entry) => entry.id === beatId) : null;
    if (!beat || !beat.targetId) {
      ribbonActions.ribbonToast("No connection selected", "Select a connected beat, then disconnect it.", "info", 2200);
      return;
    }
    delete beat.targetId;
    fileActions.markDirty();
    documentSession.history.record();
    renderBeatBoard();
    ribbonActions.ribbonToast("Connection removed", beat.title, "info", 1800);
  }
  function setBeatConnectionColor(color) {
    preferences.beatConnectionColor = color;
    fileActions.persistPrefs();
    const wires = $("#beatBoardWires");
    if (wires) wires.style.setProperty("--beat-wire-color", color);
    renderBeatBoardWires();
    ribbonActions.syncRibbon();
  }
  function focusBeat(beatId) {
    if (!beatId) return;
    workspaceState.selectedBeatId = beatId;
    if (workspaceState.view !== "beatboard") workspaceLayout.setView("beatboard");
    const card = $(`.beat-card[data-beat-id="${escapeSelector(beatId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      card.classList.add("is-selected");
      setTimeout(() => card.classList.remove("is-selected"), 1400);
    }
    ribbonActions.syncRibbon();
  }
  function sendToScriptAction() {
    if (workspaceState.view === "beatboard") {
      sendBeatToScript(workspaceState.selectedBeatId || "");
    } else if (workspaceState.view === "navigator") {
      sendCardsToScript();
    } else {
      ribbonActions.ribbonToast("Nothing to send", "Open the Beat Board or Index Cards to send material into the script.", "info", 2600);
    }
  }
  function openCombineReportsDialog() {
    const options = [
      ["statistics", "Statistics & pacing", true],
      ["scenes", "Scene breakdown", true],
      ["cast", "Cast and dialogue balance", true],
      ["revisions", "Revision notes", false],
    ];
    modalActions.openDialog({
      eyebrow: "Tools · Reports",
      title: "Combine Reports",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${options
            .map(
              ([id, label, checked]) => `
            <label class="shortcut-row" style="cursor:pointer"><span>${escapeHtml(label)}</span><input type="checkbox" data-report-part="${id}" ${checked ? "checked" : ""}></label>`,
            )
            .join("")}
        </div>
        <p class="dialog-note">One readable report is copied to the clipboard — ready for notes, email, or production meetings.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Copy combined report",
          kind: "primary",
          onClick: () => {
            const parts = $$("[data-report-part]", els.dialogBody)
              .filter((input) => input.checked)
              .map((input) => input.dataset.reportPart);
            const text = buildCombinedReport(parts);
            writingTools.copyText(text, "Reports combined", "The combined report is on the clipboard.");
            modalActions.closeDialog();
          },
        },
      ],
    });
  }
  function buildCombinedReport(parts) {
    const stats = getStats(documentSession.doc);
    const scenes = getScenes(documentSession.doc);
    const characters = getCharacters(documentSession.doc);
    const lines = [
      `SCRIPT REPORT — ${documentSession.doc.title || "Untitled Screenplay"}`,
      documentSession.doc.author ? `By ${documentSession.doc.author}` : "",
      `Generated ${new Date().toLocaleString()} · Rev ${documentSession.doc.revision.current}`,
      "",
    ];
    if (parts.includes("statistics")) {
      lines.push(
        "STATISTICS",
        `Pages: ${pageActions.pageCount()} / target ${documentSession.doc.settings.targetPages}`,
        `Words: ${stats.words.toLocaleString()}`,
        `Scenes: ${stats.scenes} · Locations: ${stats.locations} · Speaking roles: ${stats.characters}`,
        `Revised blocks: ${stats.revised} · Reading time: ${stats.readingMinutes} min`,
        "",
      );
    }
    if (parts.includes("scenes")) {
      lines.push("SCENE BREAKDOWN");
      scenes.forEach((scene) => {
        lines.push(`${scene.number}. ${scene.heading || "Untitled"} — ${scene.wordCount} words${scene.omit ? " [omitted]" : ""}`);
        if (scene.synopsis) lines.push(`    ${scene.synopsis}`);
      });
      lines.push("");
    }
    if (parts.includes("cast")) {
      lines.push("CAST & DIALOGUE");
      characters.forEach((character) => {
        lines.push(`${character.name} — ${character.speeches} speeches · ${character.dialogueWords} words${character.actor ? ` · ${character.actor}` : ""}`);
      });
      lines.push("");
    }
    if (parts.includes("revisions")) {
      lines.push("REVISIONS");
      const revision = documentSession.doc.revision;
      const entry = revisionEntry(documentSession.doc, revision.current);
      lines.push(`Active set: Rev ${revision.current} · ${entry.name} (${revision.enabled ? "on" : "off"})`);
      const counts = new Map();
      documentSession.doc.paragraphs.forEach((paragraph) => {
        if (paragraph.revision) counts.set(paragraph.revision, (counts.get(paragraph.revision) || 0) + 1);
      });
      [...counts.entries()].sort((a, b) => a[0] - b[0]).forEach(([id, count]) => {
        lines.push(`Rev ${id}: ${count} marked blocks`);
      });
      lines.push("");
    }
    return lines.filter((line) => line !== undefined).join("\n");
  }
  // scene navigator
  function matchesScene(scene, query) {
    if (!query) return true;
    const haystack = `${scene.heading} ${scene.synopsis} ${scene.notes} ${scene.location} ${scene.timeOfDay}`.toLowerCase();
    return haystack.includes(query);
  }
  function renderScenes() {
    const scenes = getScenes(documentSession.doc);
    const query = workspaceState.sceneQuery.trim().toLowerCase();
    const filtered = scenes.filter((scene) => matchesScene(scene, query));
    const pages = workspaceLayout.scenePageMap();
    els.sceneCount.textContent = String(scenes.length);
    els.sceneList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "scene-list__empty";
      empty.innerHTML = `${icon("scene")}<span>${query ? "No scenes match that search." : "Add a scene heading to begin."}</span><button class="pill-btn" type="button">Add scene</button>`;
      empty.querySelector("button").addEventListener("click", editorActions.insertScene);
      els.sceneList.appendChild(empty);
    } else {
      filtered.forEach((scene, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `scene-item${scene.index - 1 === workspaceState.activeScene ? " is-active" : ""}${scene.omit ? " is-omitted" : ""}`;
        button.style.setProperty("--i", String(index));
        button.style.setProperty("--scene-color", scene.color);
        button.dataset.sceneId = scene.id;
        button.innerHTML = `
          <span class="scene-index">${escapeHtml(scene.number)}</span>
          <span class="scene-item__body">
            <span class="scene-item__heading">${escapeHtml(scene.heading || "Untitled scene")}${scene.revisionCount ? `<span class="revision-dot revision-dot--mini"></span>` : ""}</span>
            <span class="scene-item__meta">${scene.omit ? "Omitted · " : ""}${escapeHtml(scene.title ? `${scene.title} · ` : "")}${escapeHtml(scene.synopsis || `${scene.wordCount} words · ${scene.paragraphs} blocks`)}</span>
          </span>
          <span class="scene-item__page">${scene.omit ? "—" : `${pages.get(scene.id) || scene.startPage}p`}</span>`;
        button.addEventListener("click", () => goToScene(scene));
        fragment.appendChild(button);
      });
      els.sceneList.appendChild(fragment);
    }
    renderNavigatorSubTabs(query);
    if (workspaceState.view === "sceneview") renderSceneView();
    if (workspaceState.view === "reports") renderReports();
  }
  function renderNavigatorSubTabs(query = "") {
    const notesList = $("#navNotesList");
    const charsList = $("#navCharsList");
    const tagsList = $("#navTagsList");
    if (notesList) {
      const notedParas = documentSession.doc.paragraphs.filter((p) => p.note && String(p.note).trim());
      const sceneNotes = getScenes(documentSession.doc).filter((s) => s.notes && String(s.notes).trim());
      const items = [
        ...notedParas.map((p) => ({
          id: p.id,
          title: `ScriptNote · ${p.type}`,
          meta: String(p.note),
          color: "#ca5010",
          onClick: () => {
            workspaceLayout.setView("script");
            editorActions.focusParagraph(p.id, "start");
          },
        })),
        ...sceneNotes.map((s) => ({
          id: s.id,
          title: `Scene ${s.index} · ${s.heading}`,
          meta: String(s.notes),
          color: s.color || "#0f6cbd",
          onClick: () => goToScene(s),
        })),
      ].filter((item) => !query || `${item.title} ${item.meta}`.toLowerCase().includes(query));
      notesList.innerHTML = items.length
        ? items
            .map(
              (item, idx) => `
              <button type="button" class="nav-sub-item" data-nav-note="${idx}" style="--scene-color:${escapeHtml(item.color)}">
                <span class="scene-index">${String(idx + 1).padStart(2, "0")}</span>
                <span class="scene-item__body">
                  <span class="scene-item__heading">${escapeHtml(item.title)}</span>
                  <span class="scene-item__meta">${escapeHtml(item.meta)}</span>
                </span>
              </button>`,
            )
            .join("")
        : `<div class="scene-list__empty">${icon("note")}<span>No ScriptNotes yet.</span><button class="pill-btn" type="button" id="navAddNoteBtn">Add ScriptNote</button></div>`;
      $$("[data-nav-note]", notesList).forEach((btn) => {
        const item = items[Number(btn.dataset.navNote)];
        if (item) btn.addEventListener("click", item.onClick);
      });
      const addBtn = $("#navAddNoteBtn", notesList);
      if (addBtn) addBtn.addEventListener("click", editorActions.openScriptNote);
    }
    if (charsList) {
      const chars = getCharacters(documentSession.doc).filter(
        (c) => !query || `${c.name} ${c.actor} ${c.notes}`.toLowerCase().includes(query),
      );
      charsList.innerHTML = chars.length
        ? chars
            .map(
              (c, idx) => `
              <button type="button" class="nav-sub-item" data-nav-char="${escapeHtml(c.name)}" style="--scene-color:${escapeHtml(c.color)}">
                <span class="scene-index">${escapeHtml(initials(c.name))}</span>
                <span class="scene-item__body">
                  <span class="scene-item__heading">${escapeHtml(c.name)}</span>
                  <span class="scene-item__meta">${c.speeches} speeches · ${c.dialogueWords} words</span>
                </span>
                <span class="scene-item__page">${c.sceneCount}sc</span>
              </button>`,
            )
            .join("")
        : `<div class="scene-list__empty">${icon("users")}<span>No speaking characters yet.</span></div>`;
      $$("[data-nav-char]", charsList).forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = chars.find((c) => c.name === btn.dataset.navChar);
          if (target) jumpToCharacter(target);
        });
      });
    }
    if (tagsList) {
      const tagEntries = [];
      documentSession.doc.paragraphs.forEach((p) => {
        (p.tags || []).forEach((tag) => {
          if (!query || `${tag.label} ${tag.category}`.toLowerCase().includes(query)) {
            tagEntries.push({ paraId: p.id, paraType: p.type, ...tag });
          }
        });
      });
      tagsList.innerHTML = `
        <div style="display:flex;gap:6px;padding:4px 4px 8px">
          <button type="button" class="pill-btn" id="navAddTagBtn" style="flex:1;justify-content:center">${icon("tag")} Tag Paragraph</button>
          <button type="button" class="pill-btn" id="navTagAllCharsBtn" style="flex:1;justify-content:center">${icon("users")} Tag Cast</button>
        </div>
        ${
          tagEntries.length
            ? tagEntries
                .map(
                  (tag, idx) => `
                  <button type="button" class="nav-sub-item" data-nav-tag-para="${escapeHtml(tag.paraId)}" style="--scene-color:${escapeHtml(tag.color || "#0f6cbd")}">
                    <span class="scene-index">${String(idx + 1).padStart(2, "0")}</span>
                    <span class="scene-item__body">
                      <span class="scene-item__heading">${escapeHtml(tag.label)}</span>
                      <span class="scene-item__meta">${escapeHtml(tag.category.toUpperCase())} · ${escapeHtml(tag.paraType)}</span>
                    </span>
                  </button>`,
                )
                .join("")
            : `<div class="scene-list__empty">${icon("tag")}<span>No breakdown tags yet.</span></div>`
        }`;
      $$("[data-nav-tag-para]", tagsList).forEach((btn) => {
        btn.addEventListener("click", () => {
          workspaceLayout.setView("script");
          editorActions.focusParagraph(btn.dataset.navTagPara, "start");
        });
      });
      const addTagBtn = $("#navAddTagBtn", tagsList);
      if (addTagBtn) addTagBtn.addEventListener("click", writingTools.openTagsDialog);
      const tagAllBtn = $("#navTagAllCharsBtn", tagsList);
      if (tagAllBtn) tagAllBtn.addEventListener("click", writingTools.tagAllCharacters);
    }
  }
  function setNavigatorTab(tab) {
    workspaceState.navTab = ["scenes", "notes", "characters", "tags"].includes(tab) ? tab : "scenes";
    $$(".navigator-tab").forEach((btn) => {
      const active = btn.dataset.navTab === workspaceState.navTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (els.sceneList) els.sceneList.hidden = workspaceState.navTab !== "scenes";
    const notesList = $("#navNotesList");
    const charsList = $("#navCharsList");
    const tagsList = $("#navTagsList");
    if (notesList) notesList.hidden = workspaceState.navTab !== "notes";
    if (charsList) charsList.hidden = workspaceState.navTab !== "characters";
    if (tagsList) tagsList.hidden = workspaceState.navTab !== "tags";
  }
  function goToScene(scene) {
    workspaceLayout.setView("script");
    workspaceLayout.setMode("write");
    requestAnimationFrame(() => {
      const el = editorActions.paragraphElement(scene.id);
      if (!el) return;
      editorActions.placeCaret(el, "start");
      editorActions.setActiveParagraph(scene.id);
      editorActions.scrollParagraphIntoView(el, "center", true);
      workspaceState.activeScene = scene.index - 1;
      renderScenes();
      editorActions.renderOutlineAndRuler();
    });
  }
  /* `SCENE_ANCHOR_FRACTION` and `sceneAnchorOffset()` live near the top of this IIFE,
   * just above scrollParagraphIntoView, because that is their first consumer. */
  function updateActiveSceneFromScroll() {
    if (workspaceState.scrollTick) return;
    workspaceState.scrollTick = true;
    requestAnimationFrame(() => {
      workspaceState.scrollTick = false;
      if (workspaceState.mode !== "write" && workspaceState.mode !== "speed") return;
      const headings = $$(".type-scene-heading", els.editor);
      if (!headings.length) return;
      const containerTop = els.paperScroll.getBoundingClientRect().top;
      /* null means the reading viewport is not laid out yet (see sceneAnchorOffset).
       * Nothing has scrolled, so there is no scene position to derive — skipping is
       * correct, and better than measuring against a guessed band. The explicit
       * navigation intent is deliberately NOT consumed here, so it still applies on the
       * first tick that has real geometry. */
      const offset = workspaceLayout.sceneAnchorOffset();
      if (offset == null) return;
      const anchor = containerTop + offset;
      let active = 0;
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= anchor) active = index;
      });
      /* If an explicit navigation just happened and the scroll could not actually put
       * that heading on the anchor line (document start/end clamp), the geometry above
       * reports the previous scene. Prefer the navigation target in that case: the user
       * asked for that scene and the caret is in it.
       *
       * This has to run even when the computed index already equals `state.activeScene`,
       * which is the normal case for a click (goToScene sets activeScene itself before
       * renderScenes). The old code returned early on that equality and so never
       * re-asserted the highlight, leaving the row rendered from geometry. */
      let forced = false;
      const navigatedId = workspaceState.navigatedSceneId;
      if (navigatedId) {
        const scenes = getScenes(documentSession.doc);
        const navigatedIndex = scenes.findIndex((scene) => scene.id === navigatedId);
        const heading = headings[navigatedIndex];
        /* Once the programmatic scroll has finished, stop forcing: from then on the
         * geometry is authoritative and free scrolling must track the viewport. Before
         * that, keep the target pinned so the highlight does not flash through every
         * scene the smooth scroll passes. `state.navigationInFlight` is cleared by the
         * settle timer in scrollParagraphIntoView, or here once the scroll has arrived. */
        const arrived = workspaceState.navigationTarget != null &&
          Math.abs(els.paperScroll.scrollTop - workspaceState.navigationTarget) <= 2;
        if (arrived) workspaceState.navigationInFlight = false;
        const clamped = !heading || heading.getBoundingClientRect().top > anchor + 1;
        if (navigatedIndex >= 0 && (clamped || workspaceState.navigationInFlight)) {
          active = navigatedIndex;
          forced = true;
        }
        /* Consume the intent only when it is no longer needed: a clamped target keeps it
         * for the settle window, then the next tick releases it. */
        if (!workspaceState.navigationInFlight) {
          workspaceState.navigatedSceneId = null;
          workspaceState.navigationTarget = null;
        }
      }
      if (active !== workspaceState.activeScene || forced) {
        workspaceState.activeScene = active;
        /* Highlight by SCENE IDENTITY, not by list position.
         *
         * `renderScenes` builds each row with
         * `scenes.indexOf(scene) === state.activeScene` — a DOCUMENT index. This handler
         * used to highlight by `index` in the DOM list, which is the position within the
         * FILTERED list when the navigator is filtered. As soon as the filter hides any
         * scene the two numbering schemes disagree, so scrolling (or clicking, which
         * runs through here) highlighted the wrong row — one of the "clicking a scene
         * jumps to a previous scene" reports. `data-scene-id` is already on every row;
         * comparing it to the active scene's id is correct regardless of filtering,
         * omission or reordering. */
        const scenes = getScenes(documentSession.doc);
        const activeId = scenes[active] ? scenes[active].id : null;
        $$(".scene-item", els.sceneList).forEach((item) => {
          item.classList.toggle("is-active", activeId != null && item.dataset.sceneId === activeId);
        });
        $$(".outline-segment", els.outlineTrack).forEach((seg, index) => {
          seg.classList.toggle("is-active", index === active);
        });
      }
    });
  }
  // scene view / index cards / beat board / cast / reports
  function sceneEighths(wordCountVal) {
    const eighths = Math.max(1, Math.round((Math.max(12, wordCountVal) / 190) * 8));
    const whole = Math.floor(eighths / 8);
    const rem = eighths % 8;
    if (whole === 0) return `${rem}/8`;
    if (rem === 0) return `${whole}`;
    return `${whole} ${rem}/8`;
  }
  function renderSceneView() {
    const table = $("#sceneViewTable");
    if (!table) return;
    const scenes = scenesWithPages();
    const cols = workspaceState.sceneViewCols || { title: true, summary: true, action: true };
    const scroll = { top: table.scrollTop, left: table.scrollLeft };
    table.style.setProperty('--sv-columns', `36px minmax(140px, 2.4fr) ${cols.title ? 'minmax(92px, 1.1fr) ' : ''}${cols.summary ? 'minmax(96px, 1.2fr) ' : ''}${cols.action ? 'minmax(70px, 1fr) ' : ''}42px 48px 78px`);
    $$("#sceneViewColumnsToggle .segmented__item").forEach((btn) => {
      const col = btn.dataset.svCol;
      const on = Boolean(cols[col]);
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    if (!scenes.length) {
      table.innerHTML = `<div class="scene-list__empty">${icon("table")}<span>No scenes yet. Click New Scene to add one.</span></div>`;
      return;
    }
    table.innerHTML = `
      <div class="sv-row sv-row--head">
        <span>#</span>
        <span>Heading</span>
        ${cols.title ? `<span>Title</span>` : ""}
        ${cols.summary ? `<span>Synopsis</span>` : ""}
        ${cols.action ? `<span>Action</span>` : ""}
        <span>Page</span>
        <span>Length</span>
        <span>Actions</span>
      </div>
      ${scenes
        .map((scene, idx) => {
          const actionPreview = documentSession.doc.paragraphs
            .slice(scene.startIndex + 1, scene.endIndex)
            .map(paragraphText)
            .join(" ")
            .trim();
          return `
            <div class="sv-row${scene.omit ? " is-omitted" : ""}" data-sv-scene="${escapeHtml(scene.id)}" style="--scene-color:${escapeHtml(scene.color || "#0f6cbd")};--i:${idx}">
              <span class="sv-cell sv-cell--num"><i class="sv-color-bar"></i>${escapeHtml(scene.number)}</span>
              <span class="sv-cell sv-cell--heading"><button type="button" class="sv-jump-btn" data-sv-jump="${escapeHtml(scene.id)}" title="${escapeHtml(scene.heading)}">${escapeHtml(scene.heading)}</button></span>
              ${
                cols.title
                  ? `<span class="sv-cell"><input type="text" class="sv-inline-input" data-sv-title="${escapeHtml(scene.id)}" value="${escapeHtml(scene.title || "")}" placeholder="Scene title…" title="${escapeHtml(scene.title || "Scene title")}"></span>`
                  : ""
              }
              ${
                cols.summary
                  ? `<span class="sv-cell"><input type="text" class="sv-inline-input" data-sv-synopsis="${escapeHtml(scene.id)}" value="${escapeHtml(scene.synopsis || "")}" placeholder="Add synopsis…" title="${escapeHtml(scene.synopsis || "Add synopsis")}"></span>`
                  : ""
              }
              ${
                cols.action
                  ? `<span class="sv-cell sv-cell--action" title="${escapeHtml(actionPreview || "—")}">${escapeHtml(speechActions.truncate(actionPreview || "—", 95))}</span>`
                  : ""
              }
              <span class="sv-cell sv-cell--badge">${scene.omit ? "Omit" : `p.${scene.displayPage}`}</span>
              <span class="sv-cell sv-cell--badge">${sceneEighths(scene.wordCount)}</span>
              <span class="sv-cell sv-cell--actions">
                <button type="button" class="icon-btn icon-btn--small" data-sv-move="-1" data-sv-id="${escapeHtml(scene.id)}" ${idx === 0 ? "disabled" : ""} title="Move scene up">↑</button>
                <button type="button" class="icon-btn icon-btn--small" data-sv-move="1" data-sv-id="${escapeHtml(scene.id)}" ${idx === scenes.length - 1 ? "disabled" : ""} title="Move scene down">↓</button>
                <button type="button" class="icon-btn icon-btn--small" data-sv-edit="${escapeHtml(scene.id)}" title="Edit scene card">${icon("pencil")}</button>
              </span>
            </div>`;
        })
        .join("")}`;
    table.scrollTop = scroll.top;
    table.scrollLeft = scroll.left;
    $$("[data-sv-jump]", table).forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = scenes.find((s) => s.id === btn.dataset.svJump);
        if (target) goToScene(target);
      });
    });
    $$("[data-sv-title]", table).forEach((input) => {
      input.addEventListener("change", () => {
        const target = getScenes(documentSession.doc).find((s) => s.id === input.dataset.svTitle);
        if (target) {
          target.paragraph.scene = { ...(target.paragraph.scene || {}), title: input.value.trim() };
          fileActions.markDirty();
          documentSession.history.record();
          renderScenes();
        }
      });
    });
    $$("[data-sv-synopsis]", table).forEach((input) => {
      input.addEventListener("change", () => {
        const target = getScenes(documentSession.doc).find((s) => s.id === input.dataset.svSynopsis);
        if (target) {
          target.paragraph.scene = { ...(target.paragraph.scene || {}), synopsis: input.value };
          fileActions.markDirty();
          documentSession.history.record();
          renderScenes();
        }
      });
    });
    $$("[data-sv-move]", table).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = scenes.findIndex((s) => s.id === btn.dataset.svId);
        const dir = Number(btn.dataset.svMove);
        const neighbor = scenes[idx + dir];
        if (neighbor) {
          reorderScenes(btn.dataset.svId, neighbor.id, dir < 0);
          renderSceneView();
        }
      });
    });
    $$("[data-sv-edit]", table).forEach((btn) => {
      btn.addEventListener("click", () => productionActions.openSceneDetails(btn.dataset.svEdit));
    });
  }
  function renderNavigator() {
    const scenes = getScenes(documentSession.doc);
    const query = workspaceState.navigatorQuery.trim().toLowerCase();
    const filtered = scenes.filter((scene) => matchesScene(scene, query));
    const pages = workspaceLayout.scenePageMap();
    els.sceneGrid.innerHTML = "";
    const cols = Number(workspaceState.cardsAcross) || 0;
    if (cols >= 1 && cols <= 9) {
      els.sceneGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    } else {
      els.sceneGrid.style.removeProperty("grid-template-columns");
    }
    $$("#cardModeSegmented .segmented__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.cardMode === workspaceState.cardMode);
    });
    if (!filtered.length) {
      els.sceneGrid.innerHTML = `<div class="scene-list__empty">${icon("grid")}<span>${query ? "No cards match that search." : "Add a scene heading to start the board."}</span></div>`;
      return;
    }
    filtered.forEach((scene, index) => {
      const card = document.createElement("article");
      card.className = `scene-card${scene.omit ? " is-omitted" : ""}${workspaceState.cardMode === "script" ? " is-script-card" : ""}`;
      card.style.setProperty("--i", String(index));
      card.style.setProperty("--scene-color", scene.color);
      card.dataset.sceneId = scene.id;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `Open scene ${scene.number}: ${scene.heading}`);
      const sceneLines = documentSession.doc.paragraphs
        .slice(scene.startIndex + 1, scene.endIndex)
        .map((p) => `${p.type === "Character" ? `${paragraphText(p)}: ` : ""}${paragraphText(p)}`)
        .filter(Boolean);
      const snippet = sceneLines.join(" ").trim();
      const bodyText =
        workspaceState.cardMode === "script"
          ? snippet || "No script lines in this scene yet."
          : scene.synopsis || snippet || "An empty scene. Open it and give it a first line.";
      card.innerHTML = `
        <div class="scene-card__top">
          <span class="scene-card__number">${escapeHtml(scene.number)}</span>
          <span class="scene-card__page">${scene.omit ? "Omitted" : `Page ${pages.get(scene.id) || scene.startPage} · ${sceneEighths(scene.wordCount)}`}</span>
          <div class="scene-card__actions">
            <button class="icon-btn icon-btn--small" data-card-action="details" data-scene-id="${escapeHtml(scene.id)}" aria-label="Edit scene card" title="Edit scene card">${icon("pencil")}</button>
            <button class="icon-btn icon-btn--small" data-card-action="omit" data-scene-id="${escapeHtml(scene.id)}" aria-label="${scene.omit ? "Restore scene" : "Omit scene"}" title="${scene.omit ? "Restore scene" : "Omit scene"}">${icon("eye-off")}</button>
            <span class="drag-handle" aria-hidden="true">${icon("grip")}</span>
          </div>
        </div>
        <h3>${escapeHtml(scene.heading || "Untitled scene")}</h3>
        ${scene.title ? `<div class="scene-card__title-tag">${escapeHtml(scene.title)}</div>` : ""}
        <p class="scene-card__synopsis">${escapeHtml(bodyText)}</p>
        <div class="scene-card__meta">
          <span>${escapeHtml(scene.location || "Unknown")}</span>
          <span>${escapeHtml(scene.timeOfDay || "Unspecified")}</span>
          <span>${scene.wordCount} words</span>
          ${scene.revisionCount ? `<span class="revision-dot revision-dot--mini" style="--revision-color:${revisionEntry(documentSession.doc, scene.paragraph.revision || 1).hex}"></span>` : ""}
        </div>
        <div class="scene-card__foot">
          <span class="scene-card__bar"><span style="width:${clamp((scene.wordCount / 260) * 100, 6, 100)}%"></span></span>
          <span>${scene.paragraphs} blocks</span>
          <span>${scene.omit ? "Not in page view" : "In draft"}</span>
        </div>`;
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-card-action]")) return;
        goToScene(scene);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("[data-card-action]")) return;
        event.preventDefault();
        goToScene(scene);
      });
      card.querySelector('[data-card-action="details"]').addEventListener("click", (event) => {
        event.stopPropagation();
        productionActions.openSceneDetails(scene.id);
      });
      card.querySelector('[data-card-action="omit"]').addEventListener("click", (event) => {
        event.stopPropagation();
        card.classList.add("is-omitting");
        setTimeout(() => toggleSceneOmit(scene.id), 120);
      });
      card.addEventListener("dragstart", (event) => {
        workspaceState.dragScene = scene.id;
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/x-fd-scene", scene.id);
        document.body.classList.add("is-reordering");
      });
      card.addEventListener("dragend", () => {
        workspaceState.dragScene = null;
        card.classList.remove("is-dragging");
        clearDropHints();
        document.body.classList.remove("is-reordering");
      });
      card.addEventListener("dragover", (event) => {
        if (!workspaceState.dragScene || workspaceState.dragScene === scene.id) return;
        event.preventDefault();
        const rect = card.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        clearDropHints();
        card.classList.add(before ? "drop-before" : "drop-after");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("drop-before", "drop-after");
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const fromId = event.dataTransfer.getData("text/x-fd-scene") || workspaceState.dragScene;
        const before = card.classList.contains("drop-before");
        clearDropHints();
        if (fromId) reorderScenes(fromId, scene.id, before);
      });
      els.sceneGrid.appendChild(card);
    });
  }
  function renderBeatBoard() {
    const canvas = $("#beatBoardCanvas");
    const wires = $("#beatBoardWires");
    if (!canvas || !wires) return;
    const beats = documentSession.doc.beats || [];
    canvas.innerHTML = "";
    beats.forEach((beat, idx) => {
      const el = document.createElement("article");
      el.className = `beat-card${beat.category === "Structure Point" ? " beat-card--structure" : ""}`;
      el.dataset.beatId = beat.id;
      el.style.left = `${beat.x}px`;
      el.style.top = `${beat.y}px`;
      el.style.width = `${beat.width || 248}px`;
      el.style.setProperty("--beat-color", beat.color || PALETTE[idx % PALETTE.length]);
      el.innerHTML = `
        <header class="beat-card__head">
          <span class="beat-card__badge">${escapeHtml(beat.category || "Beat")}</span>
          <div class="beat-card__actions">
            <button type="button" class="icon-btn icon-btn--small" data-beat-edit="${escapeHtml(beat.id)}" title="Edit beat">${icon("pencil")}</button>
            <button type="button" class="icon-btn icon-btn--small" data-beat-send="${escapeHtml(beat.id)}" title="Send beat to script">${icon("script")}</button>
            <button type="button" class="icon-btn icon-btn--small" data-beat-del="${escapeHtml(beat.id)}" title="Delete beat">${icon("trash")}</button>
          </div>
        </header>
        <h3 class="beat-card__title">${escapeHtml(beat.title)}</h3>
        <p class="beat-card__body">${escapeHtml(beat.body || "Double-click or click edit to flesh out this story beat.")}</p>`;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let origX = beat.x;
      let origY = beat.y;
      let moved = false, wireFrame = null;
      el.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        dragging = true;
        moved = false;
        documentSession.history.finishBurst();
        startX = event.clientX;
        startY = event.clientY;
        origX = beat.x;
        origY = beat.y;
      });
      el.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        if (!moved && Math.hypot(event.clientX - startX,event.clientY - startY) < 4) return;
        moved = true;
        el.setPointerCapture(event.pointerId);
        el.classList.add("is-dragging");
        const scale = canvas.getBoundingClientRect().width / canvas.offsetWidth || 1;
        const rawX = Math.max(16, origX + (event.clientX - startX) / scale);
        const rawY = Math.max(16, origY + (event.clientY - startY) / scale);
        beat.x = workspaceState.beatSnap ? Math.round(rawX / 24) * 24 : rawX;
        beat.y = workspaceState.beatSnap ? Math.round(rawY / 24) * 24 : rawY;
        el.style.left = `${beat.x}px`;
        el.style.top = `${beat.y}px`;
        if (!wireFrame) wireFrame = requestAnimationFrame(() => { wireFrame = null; renderBeatBoardWires(); });
      });
      const finishDrag = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("is-dragging");
        if (wireFrame) { cancelAnimationFrame(wireFrame); wireFrame = null; renderBeatBoardWires(); }
        if (moved) { fileActions.markDirty({layout:false}); documentSession.history.record(); }
      };
      el.addEventListener("pointerup", finishDrag);
      el.addEventListener("pointercancel", finishDrag);
      el.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        openBeatDialog(beat.id);
      });
      el.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        if (workspaceState.beatConnectMode) {
          if (!workspaceState.beatConnectSource) {
            workspaceState.beatConnectSource = beat.id;
            workspaceState.selectedBeatId = beat.id;
            el.classList.add("is-connect-source");
            ribbonActions.ribbonToast("Connection started", "Click another beat to draw the story arrow.", "info", 2200);
          } else if (workspaceState.beatConnectSource !== beat.id) {
            connectBeats(workspaceState.beatConnectSource, beat.id);
            workspaceState.beatConnectSource = null;
            $$(".beat-card", canvas).forEach((card) => card.classList.remove("is-connect-source"));
          }
          return;
        }
        workspaceState.selectedBeatId = beat.id;
        $$(".beat-card", canvas).forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.beatId === beat.id);
        });
        ribbonActions.syncRibbon();
      });
      if (workspaceState.beatConnectSource === beat.id) el.classList.add("is-connect-source");
      if (workspaceState.selectedBeatId === beat.id) el.classList.add("is-selected");
      canvas.appendChild(el);
    });
    $$("[data-beat-edit]", canvas).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openBeatDialog(btn.dataset.beatEdit);
      });
    });
    $$("[data-beat-send]", canvas).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        sendBeatToScript(btn.dataset.beatSend);
      });
    });
    $$("[data-beat-del]", canvas).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = btn.closest(".beat-card");
        if (card) {
          card.classList.add("is-exiting");
          setTimeout(() => {
            documentSession.doc.beats = (documentSession.doc.beats || []).filter((b) => b.id !== btn.dataset.beatDel);
            fileActions.markDirty();
            documentSession.history.record();
            renderBeatBoard();
          }, 180);
        } else {
          documentSession.doc.beats = (documentSession.doc.beats || []).filter((b) => b.id !== btn.dataset.beatDel);
          fileActions.markDirty();
          documentSession.history.record();
          renderBeatBoard();
        }
      });
    });
    renderBeatBoardWires();
  }
  function renderBeatBoardWires() {
    const wires = $("#beatBoardWires");
    if (!wires) return;
    const beats = documentSession.doc.beats || [];
    const byId = new Map(beats.map((b) => [b.id, b]));
    const paths = [];
    beats.forEach((beat) => {
      if (!beat.targetId || !byId.has(beat.targetId)) return;
      const target = byId.get(beat.targetId);
      const x1 = beat.x + (beat.width || 248) / 2;
      const y1 = beat.y + 72;
      const x2 = target.x + (target.width || 248) / 2;
      const y2 = target.y + 72;
      const dx = (x2 - x1) * 0.45;
      const color = preferences.beatConnectionColor || beat.color || "#0f6cbd";
      paths.push(
        `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" stroke="${escapeHtml(color)}" stroke-width="2.5" fill="none" stroke-dasharray="${beat.connectorStyle === "double" ? "6 4" : "none"}" marker-end="url(#beatArrow)"/>`,
      );
    });
    wires.innerHTML = `
      <defs>
        <marker id="beatArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor"></path>
        </marker>
      </defs>
      ${paths.join("")}`;
  }
  function clearDropHints() {
    $$(".scene-card.drop-before, .scene-card.drop-after").forEach((card) => {
      card.classList.remove("drop-before", "drop-after");
    });
  }
  function reorderScenes(fromId, toId, before) {
    if (!fromId || !toId || fromId === toId) return;
    const scenes = getScenes(documentSession.doc);
    const from = scenes.find((scene) => scene.id === fromId);
    const to = scenes.find((scene) => scene.id === toId);
    if (!from || !to) return;
    const slice = documentSession.doc.paragraphs.slice(from.startIndex, from.endIndex);
    let target = before ? to.startIndex : to.endIndex;
    if (from.startIndex < target) target -= slice.length;
    const rest = documentSession.doc.paragraphs.filter(
      (_paragraph, index) => index < from.startIndex || index >= from.endIndex,
    );
    target = clamp(target, 0, rest.length);
    rest.splice(target, 0, ...slice);
    documentSession.doc.paragraphs = rest;
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    renderNavigator();
    modalActions.toast("Scene moved", `“${from.heading}” now sits at ${plural(scenes.indexOf(from) + 1, "position")} in the board.`, "success", 2200);
  }
  function toggleSceneOmit(sceneId) {
    const scene = getScenes(documentSession.doc).find((item) => item.id === sceneId);
    if (!scene) return;
    scene.paragraph.scene = {
      ...(scene.paragraph.scene || {}),
      omit: !scene.omit,
    };
    if (documentSession.doc.revision.enabled) markRevision(documentSession.doc, scene.paragraph);
    fileActions.markDirty();
    documentSession.history.record();
    workspaceLayout.renderAll();
    renderNavigator();
    modalActions.toast(
      scene.omit ? "Scene restored" : "Scene omitted",
      scene.omit
        ? `${scene.heading} is back in the printed draft.`
        : `${scene.heading} stays in the editor but is skipped in page view and exports.`,
      "info",
      2600,
    );
  }
  function scenesWithPages() {
    const pages = workspaceLayout.scenePageMap();
    return getScenes(documentSession.doc).map((scene) => ({
      ...scene,
      displayPage: pages.get(scene.id) || scene.startPage,
    }));
  }
  function renderCharacters() {
    const characters = getCharacters(documentSession.doc);
    const stats = getStats(documentSession.doc);
    const maxWords = Math.max(1, ...characters.map((character) => character.dialogueWords));
    els.castCount.textContent = String(characters.filter((character) => character.dialogueWords > 0).length);
    els.castGrid.innerHTML = "";
    characters.forEach((character, index) => {
      const card = document.createElement("article");
      card.className = "cast-card";
      card.style.setProperty("--i", String(index));
      card.style.setProperty("--cast-color", character.color);
      card.dataset.character = character.name;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `${character.name}, ${character.speeches} speeches`);
      const isHighlighted = Boolean((documentSession.doc.characterHighlights || {})[character.name]);
      card.innerHTML = `
        <div class="cast-card__top">
          <span class="cast-avatar">${escapeHtml(initials(character.name))}</span>
          <div><h3>${escapeHtml(character.name)}</h3><span class="cast-card__role">${escapeHtml(character.actor || (character.directions ? `${plural(character.directions, "direction")}` : "Speaking role"))}${isHighlighted ? " · Highlighted" : ""}</span></div>
          <button class="icon-btn icon-btn--small cast-card__profile" data-profile aria-label="Edit character profile" title="Character profile">${icon("pencil")}</button>
        </div>
        <div class="cast-metrics">
          <div class="cast-metric"><strong>${character.speeches}</strong><span>Speeches</span></div>
          <div class="cast-metric"><strong>${character.dialogueWords}</strong><span>Words</span></div>
          <div class="cast-metric"><strong>${character.sceneCount}</strong><span>Scenes</span></div>
        </div>
        <div class="cast-dialogue">
          <div class="cast-dialogue__bar"><span style="width:${(character.dialogueWords / maxWords) * 100}%"></span></div>
          <div class="cast-dialogue__label"><span>Dialogue volume</span><span>${Math.round((character.dialogueWords / Math.max(1, stats.dialogueWords)) * 100)}%</span></div>
        </div>
        <p class="cast-card__note">${escapeHtml(character.notes || "No character note yet. Add one to remember the voice.")}</p>`;
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-profile]")) return;
        jumpToCharacter(character);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("[data-profile]")) return;
        event.preventDefault();
        jumpToCharacter(character);
      });
      card.querySelector("[data-profile]").addEventListener("click", (event) => {
        event.stopPropagation();
        openCastProfile(character);
      });
      els.castGrid.appendChild(card);
    });
    (documentSession.doc.nonSpeaking || []).forEach((ns, index) => {
      const card = document.createElement("article");
      card.className = "cast-card";
      card.style.setProperty("--i", String(characters.length + index));
      card.style.setProperty("--cast-color", ns.color || "#038387");
      card.innerHTML = `
        <div class="cast-card__top">
          <span class="cast-avatar">${escapeHtml(initials(ns.name))}</span>
          <div><h3>${escapeHtml(ns.name)}</h3><span class="cast-card__role">Non-speaking role</span></div>
        </div>
        <p class="cast-card__note">${escapeHtml(ns.notes || "Background / non-speaking character.")}</p>`;
      els.castGrid.appendChild(card);
    });
    if (!characters.length && !(documentSession.doc.nonSpeaking || []).length) {
      els.castGrid.innerHTML = `<div class="scene-list__empty">${icon("users")}<span>No character cues yet. Add a Character paragraph to populate the cast.</span></div>`;
    }
  }
  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  function jumpToCharacter(character) {
    const paragraph = documentSession.doc.paragraphs.find(
      (item) =>
        item.type === "Character" &&
        paragraphText(item).toUpperCase().startsWith(character.name),
    );
    if (paragraph) {
      workspaceLayout.setView("script");
      workspaceLayout.setMode("write");
      editorActions.focusParagraph(paragraph.id, "start");
    }
  }
  function renderReports() {
    const stats = getStats(documentSession.doc);
    const layout = pageActions.getLayout();
    const scenes = scenesWithPages();
    const totalPages = layout.scriptPageCount;
    const statData = [
      ["Words", stats.words.toLocaleString()],
      ["Pages", totalPages],
      ["Scenes", stats.scenes],
      ["Speaking roles", stats.characters],
      ["Locations", stats.locations],
      ["Revised", stats.revised],
    ];
    els.statGrid.innerHTML = statData
      .map(
        ([label, value], index) =>
          `<div class="stat-card" style="--i:${index}"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`,
      )
      .join("");
    $$("#reportTypeTabs .segmented__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.reportType === workspaceState.reportType);
    });
    renderCustomReportPanel(workspaceState.reportType, stats, scenes, totalPages);
    const max = Math.max(1, ...scenes.map((scene) => scene.wordCount));
    els.sceneChart.innerHTML = scenes
      .map((scene, index) => {
        const height = Math.max(5, (scene.wordCount / max) * 220);
        /* The label is a fixed 105px cell and a location name like
         * "EXT. OBSERVATORY RIDGE" is 128px, so it truncates with an ellipsis — which the
         * icon audit flags as "glyph ink cut at the right edge". That truncation is
         * deliberate (the bars must stay equal width for the chart to read), but without a
         * `title` the hidden part was simply unavailable. The full location is now on the
         * element, so hovering reveals it. */
        const labelText = scene.heading.split(" - ")[0] || `Scene ${scene.number}`;
        return `<button class="bar-chart__item${scene.omit ? " is-omitted" : ""}" data-report-scene="${escapeHtml(scene.id)}" style="--i:${index};--bar-color:${scene.color}">
          <span class="bar-chart__bar" style="height:${height}px"><span class="bar-chart__value">${scene.wordCount}</span></span>
          <span class="bar-chart__label" title="${escapeHtml(labelText)}">${escapeHtml(labelText)}</span>
        </button>`;
      })
      .join("");
    els.dialogueDonut.style.setProperty("--dialogue", String(stats.dialogueRatio));
    els.dialoguePercent.textContent = `${stats.dialogueRatio}%`;
    if (stats.longestScene) {
      els.longestScene.innerHTML = `
        <h4>${escapeHtml(stats.longestScene.heading)}</h4>
        <div class="longest-scene__meta"><span>Scene ${escapeHtml(stats.longestScene.number)}</span><span>${stats.longestScene.wordCount} words</span><span>${stats.longestScene.startPage}p</span></div>
        <div class="longest-scene__meter"><span style="width:${clamp((stats.longestScene.wordCount / max) * 100, 8, 100)}%"></span></div>`;
    } else {
      els.longestScene.innerHTML = `<p class="subtle">Add at least one scene heading to see the longest scene.</p>`;
    }
    const target = Math.max(1, documentSession.doc.settings.targetPages);
    const percent = clamp(Math.round((totalPages / target) * 100), 0, 100);
    els.targetReport.innerHTML = `
      <div class="target-report__number"><strong>${totalPages}</strong><span>of ${target} pages</span></div>
      <div class="target-report__track"><span style="width:${percent}%"></span></div>
      <p>${percent >= 90 ? "The draft is at or past the target. Time for a read-through." : `${Math.max(0, target - totalPages)} pages to the target. ${stats.revised ? `${stats.revised} revised blocks.` : "No revisions marked yet."}`}</p>
      <button class="text-btn" id="targetEdit">Edit target</button>`;
    const locations = getLocations(documentSession.doc);
    els.locationList.innerHTML = locations.length
      ? locations
          .slice(0, 8)
          .map(
            (location) => `
            <div class="location-row">
              <span class="location-row__dot" style="background:${location.color}"></span>
              <span class="location-row__name">${escapeHtml(location.name)}</span>
              <span class="location-row__meta">${location.interiors ? "INT" : ""}${location.interiors && location.exteriors ? " · " : ""}${location.exteriors ? "EXT" : ""}</span>
              <strong>${location.scenes}</strong>
            </div>`,
          )
          .join("")
      : `<p class="subtle">Scene headings with INT. or EXT. will appear here.</p>`;
    els.sceneTable.innerHTML = `
      <div class="scene-table__head"><span>#</span><span>Scene</span><span>Location</span><span>Pages</span><span>Words</span><span>Rev</span></div>
      ${scenes
        .map(
          (scene) => `
          <button class="scene-table__row${scene.omit ? " is-omitted" : ""}" data-report-scene="${escapeHtml(scene.id)}">
            <span>${escapeHtml(scene.number)}</span>
            <span>${escapeHtml(scene.heading || "Untitled scene")}${scene.omit ? " <em>omitted</em>" : ""}</span>
            <span>${escapeHtml(scene.location || "—")}</span>
            <span>${scene.omit ? "—" : scene.displayPage}</span>
            <span>${scene.wordCount}</span>
            <span>${scene.revisionCount ? `<i class="revision-dot revision-dot--mini" style="--revision-color:${revisionEntry(documentSession.doc, scene.paragraph.revision || 1).hex}"></i>` : "—"}</span>
          </button>`,
        )
        .join("")}`;
    $$("[data-report-scene]", els.reportsView).forEach((button) => {
      button.addEventListener("click", () => {
        const scene = getScenes(documentSession.doc).find((item) => item.id === button.dataset.reportScene);
        if (scene) goToScene(scene);
      });
    });
    const targetEdit = $("#targetEdit", els.targetReport);
    if (targetEdit) {
      targetEdit.addEventListener("click", () => {
        workspaceLayout.setView("script");
        setInspectorTab("document");
        workspaceLayout.toggleInspector(true);
        els.targetPagesInput.focus();
      });
    }
  }
  function renderCustomReportPanel(type, stats, scenes, totalPages) {
    const card = $("#customReportCard");
    const title = $("#customReportTitle");
    const subtitle = $("#customReportSubtitle");
    const body = $("#customReportBody");
    if (!card || !body) return;
    if (!type || type === "statistics") {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const labels = {
      scene: ["Scene Report", "Chronological breakdown with 8ths page length and synopses"],
      location: ["Location Report", "Interior / Exterior frequency and total scene word counts"],
      character: ["Character Report", "Dialogue speeches, word share, and scene appearances"],
      cast: ["Cast Report", "Speaking and non-speaking cast list with actor & role notes"],
      script: ["Script Report", "Element-by-element block distribution across the screenplay"],
      note: ["ScriptNote Report", "All ScriptNotes and scene production notes"],
      tags: ["Tags Breakdown Report", "Production breakdown tags by category and scene"],
    };
    const [t, s] = labels[type] || ["Report", "Breakdown"];
    if (title) title.textContent = t;
    if (subtitle) subtitle.textContent = s;
    if (type === "scene") {
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Heading</span><span>Title / Synopsis</span><span>Page</span><span>8ths</span><span>Words</span></div>${scenes
        .map(
          (sc) =>
            `<div class="scene-table__row"><span>${escapeHtml(sc.number || String(sc.index))}</span><span>${escapeHtml(sc.heading)}</span><span>${escapeHtml(sc.title || sc.synopsis || "—")}</span><span>p.${sc.displayPage}</span><span>${sceneEighths(sc.wordCount)}</span><span>${sc.wordCount}</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "location") {
      const locs = getLocations(documentSession.doc);
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Location</span><span>INT / EXT</span><span>Scenes</span><span>Words</span><span>Share</span></div>${locs
        .map(
          (loc, i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(loc.name)}</span><span>${loc.interiors ? `INT (${loc.interiors})` : ""} ${loc.exteriors ? `EXT (${loc.exteriors})` : ""}</span><span>${loc.scenes}</span><span>${loc.words}</span><span>${Math.round((loc.scenes / Math.max(1, scenes.length)) * 100)}%</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "character" || type === "cast") {
      const chars = getCharacters(documentSession.doc);
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Character</span><span>Role / Actor</span><span>Speeches</span><span>Words</span><span>Scenes</span></div>${chars
        .map(
          (c, i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(c.name)}</span><span>${escapeHtml(c.actor || "Speaking")}${c.notes ? ` — ${escapeHtml(speechActions.truncate(c.notes, 45))}` : ""}</span><span>${c.speeches}</span><span>${c.dialogueWords}</span><span>${c.sceneCount}</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "script") {
      const counts = {};
      documentSession.doc.paragraphs.forEach((p) => {
        counts[p.type] = (counts[p.type] || 0) + 1;
      });
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Element Type</span><span>Shortcut</span><span>Paragraphs</span><span>Share</span><span>Next Element</span></div>${Object.entries(counts)
        .map(
          ([k, count], i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(k)}</span><span>Alt+${escapeHtml((ELEMENTS[k] && ELEMENTS[k].shortcut) || "—")}</span><span>${count}</span><span>${Math.round((count / Math.max(1, documentSession.doc.paragraphs.length)) * 100)}%</span><span>${escapeHtml((ELEMENTS[k] && ELEMENTS[k].next) || "Action")}</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "note") {
      const notes = [
        ...documentSession.doc.paragraphs
          .filter((p) => p.note)
          .map((p) => ({ kind: `Paragraph (${p.type})`, head: speechActions.truncate(paragraphText(p), 48), text: p.note })),
        ...scenes
          .filter((sc) => sc.notes)
          .map((sc) => ({ kind: `Scene ${sc.index}`, head: sc.heading, text: sc.notes })),
      ];
      body.innerHTML = notes.length
        ? `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Source</span><span>Context</span><span>ScriptNote Text</span><span>Status</span><span>Type</span></div>${notes
            .map(
              (n, i) =>
                `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(n.kind)}</span><span>${escapeHtml(n.head)}</span><span>${escapeHtml(n.text)}</span><span>Active</span><span>Note</span></div>`,
            )
            .join("")}</div>`
        : `<p class="subtle" style="padding:12px">No ScriptNotes in this screenplay yet.</p>`;
    } else if (type === "tags") {
      const tags = [];
      documentSession.doc.paragraphs.forEach((p) => {
        (p.tags || []).forEach((t) => tags.push({ ...t, paraType: p.type, snippet: speechActions.truncate(paragraphText(p), 50) }));
      });
      body.innerHTML = tags.length
        ? `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Tag Item</span><span>Category</span><span>Element</span><span>Script Context</span><span>Color</span></div>${tags
            .map(
              (t, i) =>
                `<div class="scene-table__row"><span>${i + 1}</span><span><strong>${escapeHtml(t.label)}</strong></span><span>${escapeHtml(t.category.toUpperCase())}</span><span>${escapeHtml(t.paraType)}</span><span>${escapeHtml(t.snippet)}</span><span><i class="revision-dot revision-dot--mini" style="--revision-color:${escapeHtml(t.color)}"></i></span></div>`,
            )
            .join("")}</div>`
        : `<p class="subtle" style="padding:12px">No production tags yet. Use Production → Tag All Characters or Insert → Tag.</p>`;
    }
  }
  function buildReportText() {
    const stats = getStats(documentSession.doc);
    const scenes = scenesWithPages();
    const lines = [
      `${documentSession.doc.title || "Untitled Screenplay"}`,
      `by ${documentSession.doc.author || "Unknown"}`,
      "",
      `${stats.words} words · ${pageActions.pageCount()} pages · ${stats.scenes} scenes · ${stats.characters} speaking roles · ${stats.locations} locations`,
      "",
      "SCENES",
      ...scenes.map(
        (scene) =>
          `${scene.number}. ${scene.heading} — ${scene.wordCount} words, p.${scene.displayPage}${scene.omit ? " [omitted]" : ""}`,
      ),
      "",
      "LOCATIONS",
      ...getLocations(documentSession.doc).map((location) => `${location.name} — ${location.scenes} scenes / ${location.words} words`),
      "",
      "CHARACTERS",
      ...getCharacters(documentSession.doc).map(
        (character) => `${character.name} — ${character.speeches} speeches / ${character.dialogueWords} words / ${character.sceneCount} scenes`,
      ),
    ];
    return lines.join("\n");
  }
  // inspector
  function populateElementControls() {
    const options = Object.keys(ELEMENTS)
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
      .join("");
    els.elementSelect.innerHTML = options;
    els.elementChoices.innerHTML = Object.entries(ELEMENTS)
      .map(
        ([type, spec]) =>
          `<button type="button" class="element-choice" data-type="${escapeHtml(type)}">${escapeHtml(spec.label)}<kbd>${escapeHtml(spec.shortcut)}</kbd></button>`,
      )
      .join("");
    els.elementChoices.addEventListener("click", (event) => {
      const button = event.target.closest(".element-choice");
      if (!button) return;
      editorActions.changeElementType(button.dataset.type);
    });
    els.elementSelect.addEventListener("change", () => editorActions.changeElementType(els.elementSelect.value));
  }
  function sceneForParagraphId(id) {
    const index = documentSession.doc.paragraphs.findIndex((paragraph) => paragraph.id === id);
    if (index < 0) return null;
    return getScenes(documentSession.doc).find((scene) => scene.startIndex <= index && index < scene.endIndex) || null;
  }
  function renderInspector() {
    const paragraph = editorActions.activeParagraph() || documentSession.doc.paragraphs[0];
    if (paragraph) {
      editorState.selectedId = paragraph.id;
      editorActions.syncInspectorForParagraph(paragraph.id);
    }
    workspaceLayout.renderInsights();
    els.titleInput.value = documentSession.doc.title;
    els.authorInput.value = documentSession.doc.author;
    els.targetPagesInput.value = String(documentSession.doc.settings.targetPages);
    els.sceneNumbersToggle.classList.toggle("is-on", documentSession.doc.settings.sceneNumbers);
    els.sceneNumbersToggle.setAttribute("aria-checked", String(documentSession.doc.settings.sceneNumbers));
    $$(".theme-swatch").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.themeChoice === preferences.theme);
    });
    renderSceneInspector();
    workspaceLayout.renderRevisionChrome();
  }
  function renderSceneInspector() {
    const paragraph = editorActions.activeParagraph();
    const scene = paragraph ? sceneForParagraphId(paragraph.id) : null;
    if (!scene) {
      els.sceneInspectorEmpty.hidden = false;
      els.sceneInspectorFields.hidden = true;
      return;
    }
    els.sceneInspectorEmpty.hidden = true;
    els.sceneInspectorFields.hidden = false;
    els.sceneInspectorDot.style.background = scene.color;
    els.sceneInspectorTitle.textContent = scene.heading;
    const displayPage = workspaceLayout.scenePageMap().get(scene.id) || scene.startPage;
    els.sceneInspectorMeta.textContent = `Scene ${scene.number} · ${scene.wordCount} words · ${scene.omit ? "omitted" : `page ${displayPage}`}`;
    if (document.activeElement !== els.sceneNumberInput || els.sceneNumberInput.dataset.sceneId !== scene.id) {
      els.sceneNumberInput.value = scene.paragraph.scene?.number || "";
    }
    els.sceneNumberInput.dataset.sceneId = scene.id;
    els.sceneNumberInput.placeholder = scene.automaticNumber;
    const sceneTitleInput = $("#sceneTitleInput");
    if (sceneTitleInput) sceneTitleInput.value = scene.paragraph.scene?.title || "";
    els.sceneSynopsis.value = scene.paragraph.scene?.synopsis || "";
    els.sceneNotes.value = scene.paragraph.scene?.notes || "";
    els.sceneOmitToggle.classList.toggle("is-on", scene.omit);
    els.sceneOmitToggle.setAttribute("aria-checked", String(scene.omit));
    els.sceneColorRow.innerHTML = [
      "",
      ...PALETTE.slice(0, 6),
    ]
      .map(
        (color, index) =>
          `<button type="button" class="scene-color${index === 0 ? " scene-color--none" : ""}${(scene.paragraph.scene?.color || "") === color ? " is-active" : ""}" data-color="${escapeHtml(color)}" style="${color ? `--scene-color:${color}` : ""}" aria-label="${color ? `Use ${color}` : "No color"}">${index === 0 ? "None" : ""}</button>`,
      )
      .join("");
  }
  function updateActiveScene(patch) {
    const paragraph = editorActions.activeParagraph();
    const scene = paragraph ? sceneForParagraphId(paragraph.id) : null;
    if (!scene) return;
    if (Object.entries(patch).every(([field, value]) => scene.paragraph.scene?.[field] === value)) return;
    scene.paragraph.scene = {
      ...(scene.paragraph.scene || {}),
      ...patch,
    };
    fileActions.markDirty();
    documentSession.history.schedule();
    editorActions.scheduleChrome();
    if (workspaceState.view === "sceneview") renderSceneView();
    if (workspaceState.view === "navigator") renderNavigator();
  }
  function setInspectorTab(tab) {
    workspaceState.inspectorTab = tab;
    workspaceLayout.renderViewChrome();
    if (tab === "insights") workspaceLayout.renderInsights();
    if (tab === "scene") renderSceneInspector();
    if (tab === "document") {
      els.targetPagesInput.value = String(documentSession.doc.settings.targetPages);
      workspaceLayout.renderRevisionChrome();
    }
  }
  async function copyOutline() {
    const scenes = scenesWithPages();
    const text = scenes
      .map(
        (scene) =>
          `${scene.number}. ${scene.heading} — ${scene.wordCount} words (p.${scene.displayPage})${scene.omit ? " [omitted]" : ""}`,
      )
      .join("\n");
    await writingTools.copyText(text, "Outline copied", `${scenes.length} scenes copied to the clipboard.`);
  }
  async function copyReport() {
    await writingTools.copyText(buildReportText(), "Report copied", "The full script report is on the clipboard.");
  }
  function openCastProfile(character) {
    const cast = documentSession.doc.cast[character.id] || {};
    const voices = speechActions.getSpeechVoices();
    const voiceOptions = [
      `<option value="">Auto voice</option>`,
      ...voices.map(
        (voice) =>
          `<option value="${escapeHtml(voice.voiceURI)}"${cast.voiceURI === voice.voiceURI ? " selected" : ""}>${escapeHtml(voice.name)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ""}</option>`,
      ),
    ].join("");
    modalActions.openDialog({
      eyebrow: "Character",
      title: character.name,
      body: `
        <div class="cast-profile">
          <span class="cast-avatar cast-avatar--large" style="--cast-color:${character.color}">${escapeHtml(initials(character.name))}</span>
          <div class="cast-profile__fields">
            <label class="field"><span>Actor / role</span><input id="castActor" type="text" maxlength="120" value="${escapeHtml(cast.actor || character.actor || "")}" placeholder="Who plays this part?"></label>
            <label class="field"><span>Voice for table read</span><select id="castVoice">${voiceOptions}</select></label>
            <label class="field"><span>Character note</span><textarea id="castNotes" rows="4" maxlength="800" placeholder="Voice, want, wound, secret…">${escapeHtml(cast.notes || character.notes || "")}</textarea></label>
          </div>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save profile",
          kind: "primary",
          onClick: () => {
            documentSession.doc.cast[character.id] = {
              ...(documentSession.doc.cast[character.id] || {}),
              actor: $("#castActor", els.dialogBody).value.trim(),
              voiceURI: $("#castVoice", els.dialogBody).value,
              notes: $("#castNotes", els.dialogBody).value.trim(),
              color: character.color,
            };
            fileActions.markDirty();
            documentSession.history.record();
            renderCharacters();
            if (speechActions.isReadDockOpen()) speechActions.rebuildReadItems();
            modalActions.toast("Character updated", `${character.name} is ready for the read-through.`, "success");
          },
        },
      ],
    });
  }
  function resetDocumentNavigation() {
    clearTimeout(workspaceState.navigationSettleTimer);
    clearTimeout(workspaceState.sceneTimer);
    workspaceState.navigationSettleTimer = workspaceState.sceneTimer = null;
    workspaceState.navigationInFlight = false;
    workspaceState.navigationTarget = workspaceState.navigatedSceneId = null;
    workspaceState.activeScene = 0;
    workspaceState.selectedBeatId = workspaceState.beatConnectSource = workspaceState.dragScene = null;
    workspaceState.beatConnectMode = false;
  }

  return {
    resetDocumentNavigation,
    addBeat,
    alignBeats,
    copyOutline,
    copyReport,
    disconnectSelectedBeat,
    focusBeat,
    goToScene,
    openCastListOptions,
    openCombineReportsDialog,
    populateElementControls,
    renderBeatBoard,
    renderCharacters,
    renderInspector,
    renderNavigator,
    renderNavigatorSubTabs,
    renderReports,
    renderSceneInspector,
    renderSceneView,
    renderScenes,
    sceneForParagraphId,
    sendBeatToScript,
    sendCardsToScript,
    sendToScriptAction,
    setBeatConnectionColor,
    setInspectorTab,
    setNavigatorTab,
    toggleBeatConnectMode,
    toggleBeatSnap,
    toggleSceneOmit,
    updateActiveScene,
    updateActiveSceneFromScroll
  };
};
