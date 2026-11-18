"use strict";

window.AzkriptRenderer.settingsActions = function ({
  desktopActions,
  desktopState,
  documentSession,
  editorActions,
  editorState,
  fileActions,
  modalActions,
  pageActions,
  preferences,
  productionActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
  writingTools,
}) {
  const { $, $$, ACCENT_THEMES, LINE_SPACING_OPTIONS, PAGE_PRESETS, PAPER_TINTS, SCRIPT_FONT, SCRIPT_FONT_CHOICES, blankDocument, clamp, desktop, els, escapeHtml, getCharacters, getStats, icon, isDesktop, normalizeScriptFont, sampleDocument, scriptFontLabel } = shared;

  /* ---------- tools dialogs ---------------------------------------- */
  function openCollaborationDialog() {
    modalActions.openDialog({
      eyebrow: "Tools · Collaboration",
      title: "Collaboration Files",
      body: `
        <p class="dialog-note">Azkript works on local files. Share a draft by sending the FDX package, then merge notes manually or with ScriptCompare.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <button type="button" class="shortcut-row" data-collab="export" style="border:0;background:transparent;text-align:left"><span>${icon("download")} Export a sharing copy</span><strong>FDX</strong></button>
          <button type="button" class="shortcut-row" data-collab="compare" style="border:0;background:transparent;text-align:left"><span>${icon("compare")} Compare with another draft</span><strong>ScriptCompare</strong></button>
          <button type="button" class="shortcut-row" data-collab="summary" style="border:0;background:transparent;text-align:left"><span>${icon("users")} Share the collaboration summary</span><strong>Clipboard</strong></button>
        </div>
        <p class="dialog-note">Live co-writing is not available. Share a review packet or an exported copy.</p>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-collab]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.collab;
        modalActions.closeDialog();
        if (action === "export") fileActions.exportFDX();
        else if (action === "compare") writingTools.openScriptCompareDialog();
        else {
          const stats = getStats(documentSession.doc);
          const summary = [
            `COLLABORATION SUMMARY — ${documentSession.doc.title || "Untitled Screenplay"}`,
            `By ${documentSession.doc.author || "Unknown writer"}`,
            `${stats.words} words · ${stats.scenes} scenes · ${pageActions.pageCount()} pages`,
            `Revision set: Rev ${documentSession.doc.revision.current} (${documentSession.doc.revision.enabled ? "on" : "off"})`,
            `Characters: ${getCharacters(documentSession.doc).map((character) => character.name).join(", ") || "none"}`,
          ].join("\n");
          writingTools.copyText(summary, "Collaboration summary copied", "Paste it with the shared file.");
        }
      });
    });
  }
  /* ---------- help & account --------------------------------------- */
  function appVersionString() {
    if (desktopState.appInfo && desktopState.appInfo.version) return desktopState.appInfo.version;
    return "1.2.0";
  }
  function openWebsite(url) {
    if (!url) return;
    if (isDesktop && desktop && desktop.openExternal) {
      desktop.openExternal(url).catch(() => {});
      modalActions.toast("Opening browser", url, "info", 2200);
      return;
    }
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      modalActions.toast("Link unavailable", url, "warning", 2600);
    }
  }
  function openWelcomeDialog() {
    modalActions.openDialog({
      eyebrow: "Help · Welcome",
      title: "Welcome to Azkript",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <button type="button" class="shortcut-row" data-welcome="template" style="border:0;background:transparent;text-align:left"><span>${icon("template")} Start from a template</span><strong>Feature · Short · TV</strong></button>
          <button type="button" class="shortcut-row" data-welcome="sample" style="border:0;background:transparent;text-align:left"><span>${icon("script")} Open the sample script</span><strong>Learn the workspace</strong></button>
          <button type="button" class="shortcut-row" data-welcome="guide" style="border:0;background:transparent;text-align:left"><span>${icon("book")} Read the user guide</span><strong>Shortcuts</strong></button>
        </div>
        <p class="dialog-note"><kbd>Ctrl</kbd> + <kbd>K</kbd> opens the command palette. The ribbon is always available at the top of the workspace.</p>`,
      actions: [{ label: "Start writing", kind: "primary" }],
    });
    $$("[data-welcome]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        modalActions.closeDialog();
        if (button.dataset.welcome === "template") desktopActions.showStartCenter();
        else if (button.dataset.welcome === "sample") loadSample();
        else openHelp();
      });
    });
  }
  function openWhatsNewDialog() {
    const items = [
      ["Ribbon workspace", "Home, File, Edit, View, Format, Insert, Document, Tools, Production and Help now live in one Fluent ribbon."],
      ["Quick access", "New, Open, Save, Undo, Redo and Export sit in the titlebar, one click away."],
      ["Ribbon-native views", "Normal, Page, Speed, Scene, Cards, Beat Board, Split and Appearance controls are grouped by task."],
      ["Production depth", "Revision sets, A-page locking, tags, target length and Format Assistant are wired into the document."],
      ["Tracked changes", "Track edits, accept or reject them, and jump between changed blocks."],
      ["Richer formatting", "Paragraph alignment, spacing, leading, text color and highlighter now apply to the script."],
      ["Table read transport", "Play, stop, rewind and fast-forward from the Tools tab."],
    ];
    modalActions.openDialog({
      eyebrow: "Help · What's New",
      title: `What's new in ${appVersionString()}`,
      body: `<div class="shortcut-grid" style="grid-template-columns:1fr">${items
        .map(
          ([title, description]) =>
            `<div class="shortcut-row" style="align-items:flex-start"><span><strong>${escapeHtml(title)}</strong><br><span class="subtle">${escapeHtml(description)}</span></span></div>`,
        )
        .join("")}</div>`,
      actions: [{ label: "Excellent", kind: "primary" }],
    });
  }
  function openGetHelpDialog() {
    modalActions.openDialog({
      eyebrow: "Help · Get Help",
      title: "Get Help",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <button type="button" class="shortcut-row" data-gethelp="guide" style="border:0;background:transparent;text-align:left"><span>${icon("book")} User guide & shortcuts</span><strong>F1</strong></button>
          <button type="button" class="shortcut-row" data-gethelp="tutorials" style="border:0;background:transparent;text-align:left"><span>${icon("sparkle")} Idea to Draft tutorials</span><strong>Learn</strong></button>
          <button type="button" class="shortcut-row" data-gethelp="feedback" style="border:0;background:transparent;text-align:left"><span>${icon("feedback")} Send feedback</span><strong>Email</strong></button>
          <button type="button" class="shortcut-row" data-gethelp="about" style="border:0;background:transparent;text-align:left"><span>${icon("info")} About Azkript</span><strong>Version</strong></button>
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-gethelp]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.gethelp;
        modalActions.closeDialog();
        if (action === "guide") openHelp();
        else if (action === "tutorials") openTutorialsDialog();
        else if (action === "feedback") openFeedbackDialog();
        else openAboutDialog();
      });
    });
  }
  function openTutorialsDialog() {
    const tutorials = [
      ["Start with a scene", "Build a scene heading, action and dialogue the studio-standard way.", () => { loadSample(); }],
      ["Structure the story", "Use the Beat Board and Outline Editor to plan acts and turning points.", () => { workspaceLayout.setView("beatboard"); }],
      ["Write production-ready pages", "Revision colors, A-pages and locked pages for a production draft.", () => { productionActions.openRevisionManager(); }],
      ["Run a table read", "Hear your screenplay with per-character voices and follow the highlighted page.", () => { speechActions.openReadDock(false); }],
    ];
    modalActions.openDialog({
      eyebrow: "Help · Learn",
      title: "Idea to Draft Tutorials",
      body: `
        <p class="dialog-note">Four short, hands-on paths. Each one opens the workspace exactly where the lesson begins.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">${tutorials
          .map(
            ([title, description], index) =>
              `<button type="button" class="shortcut-row" data-tutorial="${index}" style="border:0;background:transparent;text-align:left;width:100%"><span>${icon("book")} <strong>${escapeHtml(title)}</strong><br><span class="subtle">${escapeHtml(description)}</span></span></button>`,
          )
          .join("")}</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-tutorial]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const tutorial = tutorials[Number(button.dataset.tutorial)];
        modalActions.closeDialog();
        if (tutorial) tutorial[2]();
      });
    });
  }
  function openSamplesDialog() {
    const samples = [
      ["The Last Signal", "A feature opening: scene headings, action, dual dialogue and a revision pass.", () => loadSample()],
      ["Feature template", "A blank feature screenplay with the standard element flow.", () => { fileActions.newDocument("feature", true); }],
      ["TV pilot template", "A pilot structure ready for act breaks and teaser scenes.", () => { fileActions.newDocument("tv", true); }],
      ["Stage play template", "Acts, scenes and stage-direction conventions.", () => { fileActions.newDocument("stage", true); }],
    ];
    modalActions.openDialog({
      eyebrow: "Help · Samples",
      title: "Sample Scripts & Templates",
      body: `<div class="shortcut-grid" style="grid-template-columns:1fr">${samples
        .map(
          ([title, description], index) =>
            `<button type="button" class="shortcut-row" data-sample="${index}" style="border:0;background:transparent;text-align:left;width:100%"><span>${icon("script")} <strong>${escapeHtml(title)}</strong><br><span class="subtle">${escapeHtml(description)}</span></span></button>`,
        )
        .join("")}</div>`,
      actions: [{ label: "Cancel" }],
    });
    $$("[data-sample]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const sample = samples[Number(button.dataset.sample)];
        modalActions.closeDialog();
        if (sample) sample[2]();
      });
    });
  }
  function openCheckUpdatesDialog() {
    const version = appVersionString();
    modalActions.openDialog({
      eyebrow: "Help · Updates",
      title: "Release and Updates",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Installed version</span><strong>${escapeHtml(version)}</strong></div>
          <div class="shortcut-row"><span>Channel</span><strong>Independent build</strong></div>
          <div class="shortcut-row"><span>Verification</span><strong>Manual packages</strong></div>
        </div>
        <p class="dialog-note">Use Workspace → Release and updates to verify a local update or rollback package. Azkript does not contact an update server. Unsigned beta packages cannot pass the signed-update gate.</p>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
  }
  function openFeedbackDialog() {
    modalActions.openDialog({
      eyebrow: "Help · Feedback",
      title: "Submit Feedback",
      body: `
        <label class="field"><span>What should improve?</span><textarea id="feedbackText" rows="5" maxlength="2000" placeholder="Describe the workflow, bug or idea…"></textarea></label>
        <p class="dialog-note">Copy your feedback, then open the project's issue tracker. Use a synthetic example and remove private script text and personal file paths before sharing.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Copy feedback",
          onClick: () => {
            const text = $("#feedbackText", els.dialogBody).value.trim();
            if (!text) return;
            writingTools.copyText(
              `Azkript feedback\nVersion: ${appVersionString()}\n\n${text}`,
              "Feedback copied",
              "Paste it into your email or issue tracker.",
            );
          },
        },
        {
          label: "Open issue tracker",
          kind: "primary",
          onClick: () => {
            openWebsite('https://github.com/darrenprx/azkript/issues/new/choose');
          },
        },
      ],
    });
  }
  function openAccountDialog() {
    const profile = workspaceLayout.normalizeProfile();
    modalActions.openDialog({
      eyebrow: "Help · Account",
      title: "Manage Account",
      body: `
        <label class="field"><span>Display name</span><input id="accountName" type="text" maxlength="60" value="${escapeHtml(profile.name)}"></label>
        <label class="field"><span>Role</span><select id="accountRole">
          <option value="Writer"${profile.role === "Writer" ? " selected" : ""}>Writer</option>
          <option value="Showrunner"${profile.role === "Showrunner" ? " selected" : ""}>Showrunner</option>
          <option value="Producer"${profile.role === "Producer" ? " selected" : ""}>Producer</option>
          <option value="Script Coordinator"${profile.role === "Script Coordinator" ? " selected" : ""}>Script Coordinator</option>
        </select></label>
        <p class="dialog-note">The profile is stored locally with your workspace preferences. No account sign-in or cloud sync is performed by this build.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save profile",
          kind: "primary",
          onClick: () => {
            preferences.profile = {
              name: $("#accountName", els.dialogBody).value.trim() || "Local Writer",
              role: $("#accountRole", els.dialogBody).value,
            };
            workspaceLayout.applyProfile();
            modalActions.closeDialog();
            modalActions.toast("Profile saved", "The workspace now greets you by name.", "success");
          },
        },
      ],
    });
  }
  function signOutAction() {
    modalActions.confirmAction("Sign out of the local profile?", "The display name and initials will be cleared from this workspace.", "Sign out", () => {
      preferences.profile = { name: "Local Writer", role: "Writer" };
      workspaceLayout.applyProfile();
      modalActions.toast("Signed out", "The local profile is cleared. Your screenplay is untouched.", "info");
    });
  }
  function openAboutDialog() {
    modalActions.openDialog({
      eyebrow: "Help · About",
      title: "Azkript",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Version</span><strong>${escapeHtml(appVersionString())}</strong></div>
          <div class="shortcut-row"><span>Document format</span><strong>FDX v6 (screenplay interchange)</strong></div>          <div class="shortcut-row"><span>Runtime</span><strong>${isDesktop ? "Electron desktop" : "Browser workspace"}</strong></div>
          <div class="shortcut-row"><span>License</span><strong>GPLv3 only · Free software</strong></div>
        </div>
        <p class="dialog-note">Copyright (C) 2026 Darren Meng. You may use, modify and redistribute Azkript under the GNU General Public License version 3. Azkript comes without warranty. The full license and third-party notices are included with the application source.</p>
        <p class="dialog-note">Azkript is an independent screenplay editor and is not affiliated with any third-party publisher. FDX/FDXT compatibility is implemented independently; exact pagination parity with other editors is not certified.</p>`,      actions: [
        { label: "License and source", onClick: () => openWebsite("https://github.com/darrenprx/azkript") },
        { label: "Close", kind: "primary" },
      ],
    });
  }
  // settings, help, document details, page setup
  function currentPagePreset(page) {
    for (const [key, preset] of Object.entries(PAGE_PRESETS)) {
      if (Math.abs(page.width - preset.width) < 0.05 && Math.abs(page.height - preset.height) < 0.05) {
        return key;
      }
    }
    return "custom";
  }
  function resetPreferencesToDefaults() {
    preferences.theme = "light";
    preferences.accentColor = "cobalt";
    preferences.paperTint = "ivory";
    preferences.uiDensity = "comfortable";
    preferences.ambientGlow = true;
    preferences.reducedMotionPref = false;
    preferences.lineSpacing = "normal";
    preferences.smartTypeEnabled = true;
    preferences.autoUppercase = false;
    preferences.spellcheck = true;
    preferences.highlightActiveLine = true;
    preferences.typewriterScroll = false;
    preferences.typewriterMode = "off";
    preferences.autosaveDelay = 650;
    preferences.zoom = 1;
    workspaceState.mode = "write";
    preferences.font = SCRIPT_FONT;    preferences.fontSize = 12;
    preferences.showGuides = true;
    preferences.showInvisibles = false;
    preferences.autosave = true;
    preferences.startCenterOnLaunch = true;
    preferences.readRate = 1;
    preferences.showOutlineInScript = true;
    preferences.showStructureLines = false;
    preferences.hideScriptNotes = false;
    preferences.navigatorVisible = true;
    preferences.textColor = "#171614";
    preferences.highlightColor = "#ffe9a3";
    preferences.beatConnectionColor = "#0f6cbd";
    preferences.profile = { name: "Local Writer", role: "Writer" };
    documentSession.lastBackupAt = 0;
    editorState.trackedBaseline = null;
    documentSession.doc.settings = {
      ...documentSession.doc.settings,
      sceneNumbers: true,
      sceneNumberSide: "both",
      pageNumbers: true,
      showMore: true,
      smartQuotes: true,
    };
    pageActions.invalidateLayout();
    workspaceLayout.applyTheme(preferences.theme, false);
    workspaceLayout.applyStudioAppearance();
    workspaceLayout.setMode(workspaceState.mode);
    workspaceLayout.renderAll();
    workspaceLayout.syncPrefsUI();
    fileActions.persistPrefs();
    modalActions.toast("Preferences reset", "Azkript settings are back to their defaults.", "info", 2400);
  }
  function openSettings() {
    const info = desktopState.appInfo;
    const presetKey = currentPagePreset(documentSession.doc.page);
    const fonts = SCRIPT_FONT_CHOICES.map((choice) => choice.value);    const zoomChoices = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];
    const currentZoom = zoomChoices.includes(Number(preferences.zoom)) ? Number(preferences.zoom) : 1;
    modalActions.openDialog({
      eyebrow: "Preferences",
      title: "Azkript settings",
      wide: true,
      body: `
        <div class="settings-nav" role="tablist" aria-label="Settings categories">
          <button type="button" class="settings-nav__tab is-active" data-settings-tab="all" role="tab" aria-selected="true">All</button>
          <button type="button" class="settings-nav__tab" data-settings-tab="appearance" role="tab" aria-selected="false">Appearance</button>
          <button type="button" class="settings-nav__tab" data-settings-tab="editor" role="tab" aria-selected="false">Editor</button>
          <button type="button" class="settings-nav__tab" data-settings-tab="page" role="tab" aria-selected="false">Page &amp; Format</button>
          <button type="button" class="settings-nav__tab" data-settings-tab="tools" role="tab" aria-selected="false">Tools &amp; Audio</button>
        </div>
        <section class="settings-section" data-settings-section="appearance">
          <h3 class="settings-section__title">Appearance &amp; Workspace</h3>
          <div class="field-grid">
            <label class="field"><span>Interface theme</span><select id="settingsTheme"><option value="light"${preferences.theme === "light" ? " selected" : ""}>Light</option><option value="dark"${preferences.theme === "dark" ? " selected" : ""}>Dark</option><option value="midnight"${preferences.theme === "midnight" ? " selected" : ""}>Midnight Mode</option><option value="system"${preferences.theme === "system" ? " selected" : ""}>Follow system</option></select></label>
            <label class="field"><span>Paper surface tint</span><select id="settingsPaperTint">${Object.entries(PAPER_TINTS).map(([key, item]) => `<option value="${key}"${preferences.paperTint === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
            <label class="field"><span>Interface density</span><select id="settingsDensity"><option value="comfortable"${preferences.uiDensity === "comfortable" ? " selected" : ""}>Comfortable</option><option value="compact"${preferences.uiDensity === "compact" ? " selected" : ""}>Compact</option><option value="spacious"${preferences.uiDensity === "spacious" ? " selected" : ""}>Spacious</option></select></label>
            <label class="field"><span>Default view mode</span><select id="settingsMode"><option value="write"${workspaceState.mode === "write" ? " selected" : ""}>Normal / Write view (continuous)</option><option value="page"${workspaceState.mode === "page" ? " selected" : ""}>Page preview (paginated)</option><option value="speed"${workspaceState.mode === "speed" ? " selected" : ""}>Speed view (action collapsed)</option></select></label>
            <label class="field"><span>Default zoom level</span><select id="settingsZoom">${zoomChoices.map((z) => `<option value="${z}"${currentZoom === z ? " selected" : ""}>${Math.round(z * 100)}%</option>`).join("")}</select></label>
            <label class="field"><span>Accent color</span><select id="settingsAccent">${Object.entries(ACCENT_THEMES).map(([key, item]) => `<option value="${key}"${preferences.accentColor === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
          </div>
          <div class="settings-swatches" id="settingsAccentSwatches" role="group" aria-label="Accent color swatches">
            ${Object.entries(ACCENT_THEMES)
              .map(
                ([key, item]) =>
                  `<button type="button" class="accent-swatch${preferences.accentColor === key ? " is-active" : ""}" data-accent-choice="${key}" style="--swatch-color:${item.swatch}" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}"><span></span>${escapeHtml(item.label.split(" ").pop())}</button>`,
              )
              .join("")}
          </div>
          <div class="setting-line"><div><strong>Ambient background glow</strong><span>Show subtle color aurora behind the workspace shell.</span></div><button type="button" class="switch ${preferences.ambientGlow ? "is-on" : ""}" data-setting="ambientGlow" role="switch" aria-checked="${preferences.ambientGlow}"><span></span></button></div>
          <div class="setting-line"><div><strong>Reduced motion</strong><span>Minimize page-turn, view, and button ripple animations.</span></div><button type="button" class="switch ${preferences.reducedMotionPref ? "is-on" : ""}" data-setting="reducedMotion" role="switch" aria-checked="${preferences.reducedMotionPref}"><span></span></button></div>
          <div class="setting-line"><div><strong>Show Start Center on launch</strong><span>Open the recent files and templates screen at startup.</span></div><button type="button" class="switch ${preferences.startCenterOnLaunch ? "is-on" : ""}" data-setting="startCenter" role="switch" aria-checked="${preferences.startCenterOnLaunch}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="editor">
          <h3 class="settings-section__title">Editor &amp; Typography</h3>
          <div class="field-grid">
            <label class="field"><span>Script font</span><select id="settingsFont">${fonts.map((f) => `<option value="${escapeHtml(f)}"${normalizeScriptFont(preferences.font) === f ? " selected" : ""}>${escapeHtml(scriptFontLabel(f))}</option>`).join("")}</select></label>            <label class="field"><span>Font size (pt)</span><input id="settingsFontSize" type="number" min="8" max="24" value="${preferences.fontSize}"></label>
          </div>
          <label class="field"><span>Line spacing</span><select id="settingsLineSpacing">${Object.entries(LINE_SPACING_OPTIONS).map(([key, item]) => `<option value="${key}"${preferences.lineSpacing === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
          <div class="setting-line"><div><strong>SmartType autocomplete</strong><span>Suggest characters, locations, times of day, and transitions as you type.</span></div><button type="button" class="switch ${preferences.smartTypeEnabled ? "is-on" : ""}" data-setting="smartType" role="switch" aria-checked="${preferences.smartTypeEnabled}"><span></span></button></div>
          <div class="setting-line"><div><strong>Smart quotes &amp; dashes</strong><span>Convert double hyphens to em-dashes, triple dots to ellipses, and store smart quote preference in FDX.</span></div><button type="button" class="switch ${documentSession.doc.settings.smartQuotes ? "is-on" : ""}" data-setting="smartQuotes" role="switch" aria-checked="${documentSession.doc.settings.smartQuotes}"><span></span></button></div>
          <div class="setting-line"><div><strong>Auto-uppercase headings &amp; cues</strong><span>Normalize scene headings, character names, shots, and transitions to uppercase on Enter.</span></div><button type="button" class="switch ${preferences.autoUppercase ? "is-on" : ""}" data-setting="autoUppercase" role="switch" aria-checked="${preferences.autoUppercase}"><span></span></button></div>
          <div class="setting-line"><div><strong>Spellcheck</strong><span>Underline misspelled words in the screenplay editor.</span></div><button type="button" class="switch ${preferences.spellcheck ? "is-on" : ""}" data-setting="spellcheck" role="switch" aria-checked="${preferences.spellcheck}"><span></span></button></div>
          <div class="setting-line"><div><strong>Highlight active paragraph</strong><span>Tint and accent-mark the currently focused screenplay block.</span></div><button type="button" class="switch ${preferences.highlightActiveLine ? "is-on" : ""}" data-setting="highlightActive" role="switch" aria-checked="${preferences.highlightActiveLine}"><span></span></button></div>
          <div class="setting-line"><div><strong>Typewriter scroll</strong><span>Keep the active line vertically centered while writing in continuous mode.</span></div><button type="button" class="switch ${preferences.typewriterScroll ? "is-on" : ""}" data-setting="typewriterScroll" role="switch" aria-checked="${preferences.typewriterScroll}"><span></span></button></div>
          <div class="setting-line"><div><strong>Ruler guides</strong><span>Show the 0.5-inch margin grid on the page.</span></div><button type="button" class="switch ${preferences.showGuides ? "is-on" : ""}" data-setting="guides" role="switch" aria-checked="${preferences.showGuides}"><span></span></button></div>
          <div class="setting-line"><div><strong>Invisibles</strong><span>Show a paragraph mark in empty elements.</span></div><button type="button" class="switch ${preferences.showInvisibles ? "is-on" : ""}" data-setting="invisibles" role="switch" aria-checked="${preferences.showInvisibles}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="page">
          <h3 class="settings-section__title">Page Layout &amp; Script Format</h3>
          <div class="field-grid">
            <label class="field"><span>Page size preset</span><select id="settingsPagePreset">${Object.entries(PAGE_PRESETS).map(([key, item]) => `<option value="${key}"${presetKey === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}<option value="custom"${presetKey === "custom" ? " selected" : ""}>Custom (${documentSession.doc.page.width} × ${documentSession.doc.page.height} in)</option></select></label>
            <label class="field"><span>Target length (pages)</span><input id="settingsTarget" type="number" min="1" max="999" value="${documentSession.doc.settings.targetPages}"></label>
          </div>
          <label class="field"><span>Scene number placement</span><select id="settingsSceneNumberSide"><option value="both"${(documentSession.doc.settings.sceneNumberSide || "both") === "both" ? " selected" : ""}>Both margins (Left &amp; Right)</option><option value="left"${documentSession.doc.settings.sceneNumberSide === "left" ? " selected" : ""}>Left margin only</option><option value="right"${documentSession.doc.settings.sceneNumberSide === "right" ? " selected" : ""}>Right margin only</option></select></label>
          <div class="setting-line"><div><strong>Scene numbers</strong><span>Show automatic scene numbers in the editor and page view.</span></div><button type="button" class="switch ${documentSession.doc.settings.sceneNumbers ? "is-on" : ""}" data-setting="sceneNumbers" role="switch" aria-checked="${documentSession.doc.settings.sceneNumbers}"><span></span></button></div>
          <div class="setting-line"><div><strong>Page numbers in header</strong><span>Show numbered folios in the top-right header of script pages.</span></div><button type="button" class="switch ${documentSession.doc.settings.pageNumbers !== false ? "is-on" : ""}" data-setting="pageNumbers" role="switch" aria-checked="${documentSession.doc.settings.pageNumbers !== false}"><span></span></button></div>
          <div class="setting-line"><div><strong>(MORE) / (CONT'D) markers</strong><span>Automatically mark dialogue split across page breaks.</span></div><button type="button" class="switch ${documentSession.doc.settings.showMore !== false ? "is-on" : ""}" data-setting="showMore" role="switch" aria-checked="${documentSession.doc.settings.showMore !== false}"><span></span></button></div>
          <div class="setting-line"><div><strong>Title page</strong><span>Include the title page in page view and PDF exports.</span></div><button type="button" class="switch ${documentSession.doc.titlePage.enabled ? "is-on" : ""}" data-setting="titlePage" role="switch" aria-checked="${documentSession.doc.titlePage.enabled}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="tools">
          <h3 class="settings-section__title">Tools, Audio &amp; Storage</h3>
          <div class="setting-line"><div><strong>Autosave recovery</strong><span>Keep a crash-safe copy while the desktop app is open.</span></div><button type="button" class="switch ${preferences.autosave ? "is-on" : ""}" data-setting="autosave" role="switch" aria-checked="${preferences.autosave}"><span></span></button></div>
          <div class="field-grid" style="margin-top:10px">
            <label class="field"><span>Autosave delay</span><select id="settingsAutosaveInterval"><option value="400"${preferences.autosaveDelay === 400 ? " selected" : ""}>Fast (0.4s)</option><option value="650"${preferences.autosaveDelay === 650 ? " selected" : ""}>Standard (0.65s)</option><option value="1500"${preferences.autosaveDelay === 1500 ? " selected" : ""}>Relaxed (1.5s)</option><option value="3000"${preferences.autosaveDelay === 3000 ? " selected" : ""}>Every 3 seconds</option><option value="5000"${preferences.autosaveDelay === 5000 ? " selected" : ""}>Every 5 seconds</option></select></label>
            <label class="field"><span>Table read speed</span><select id="settingsReadRate"><option value="0.8"${Number(preferences.readRate) === 0.8 ? " selected" : ""}>0.8× (Measured)</option><option value="1"${Number(preferences.readRate) === 1 ? " selected" : ""}>1.0× (Natural)</option><option value="1.2"${Number(preferences.readRate) === 1.2 ? " selected" : ""}>1.2× (Brisk)</option><option value="1.5"${Number(preferences.readRate) === 1.5 ? " selected" : ""}>1.5× (Fast)</option></select></label>
          </div>
          ${
            isDesktop && info
              ? `<div class="dialog-note">${escapeHtml(info.version)} · Electron ${escapeHtml(info.electron)} · ${escapeHtml(info.platform)}<br>${escapeHtml(info.userData)}</div><button class="wide-btn" type="button" id="revealData">${icon("folder")} Show app data folder</button>`
              : `<div class="dialog-note">Browser mode. Install the desktop build for native files, PDF, and recovery.</div>`
          }
        </section>`,
      actions: [
        { label: "Reset defaults", onClick: () => resetPreferencesToDefaults() },
        { label: "Load sample", onClick: () => loadSample() },
        {
          label: "Clear local data",
          kind: "danger",
          onClick: () =>
            modalActions.confirmAction(
              "Clear local data?",
              isDesktop ? "This clears the local working draft and its active recovery copy. Export FDX first to keep a portable backup."
                : "This clears the draft stored in this browser. Export FDX first to keep a portable backup.",
              "Clear data",
              () => {
                if (documentSession.saving) {
                  modalActions.toast("Save in progress", "Wait for the current save to finish before clearing local data.", "info");
                  return;
                }
                try {
                  /* Clear every spelling this document may be stored under,
                   * including pre-rename keys: leaving one behind resurrects
                   * the deleted draft on the next load. */
                  localStorage.removeItem(fileActions.DOC_KEY);
                  localStorage.removeItem(fileActions.LEGACY_DOC_KEY);
                  for (const key of fileActions.RENAMED_DOC_KEYS) localStorage.removeItem(key);
                } catch {}
                fileActions.loadDocument(blankDocument(), { clearRecovery: true, persist: false });
                modalActions.toast("Local data cleared", "A fresh document is open.", "warning");
              },
            ),
        },
        { label: "Done", kind: "primary" },
      ],
    });
    $$(".settings-nav__tab", els.dialogBody).forEach((tab) => {
      tab.addEventListener("click", () => {
        const category = tab.dataset.settingsTab;
        $$(".settings-nav__tab", els.dialogBody).forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        $$(".settings-section", els.dialogBody).forEach((section) => {
          section.hidden = category !== "all" && section.dataset.settingsSection !== category;
        });
      });
    });
    const getSwitchValue = (key) => {
      switch (key) {
        case "autosave":
          return preferences.autosave;
        case "guides":
          return preferences.showGuides;
        case "invisibles":
          return preferences.showInvisibles;
        case "sceneNumbers":
          return documentSession.doc.settings.sceneNumbers;
        case "pageNumbers":
          return documentSession.doc.settings.pageNumbers !== false;
        case "showMore":
          return documentSession.doc.settings.showMore !== false;
        case "titlePage":
          return documentSession.doc.titlePage.enabled;
        case "startCenter":
          return preferences.startCenterOnLaunch;
        case "ambientGlow":
          return preferences.ambientGlow;
        case "reducedMotion":
          return preferences.reducedMotionPref;
        case "smartType":
          return preferences.smartTypeEnabled;
        case "smartQuotes":
          return documentSession.doc.settings.smartQuotes !== false;
        case "autoUppercase":
          return preferences.autoUppercase;
        case "spellcheck":
          return preferences.spellcheck;
        case "highlightActive":
          return preferences.highlightActiveLine;
        case "typewriterScroll":
          return preferences.typewriterScroll;
        default:
          return false;
      }
    };
    $$(".switch[data-setting]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.setting;
        if (key === "autosave") preferences.autosave = !preferences.autosave;
        if (key === "guides") {
          preferences.showGuides = !preferences.showGuides;
          els.paper.classList.toggle("has-guides", preferences.showGuides);
        }
        if (key === "invisibles") {
          preferences.showInvisibles = !preferences.showInvisibles;
          els.paper.classList.toggle("has-invisibles", preferences.showInvisibles);
        }
        if (key === "sceneNumbers") {
          documentSession.doc.settings.sceneNumbers = !documentSession.doc.settings.sceneNumbers;
          fileActions.markDirty();
          workspaceLayout.renderAll();
        }
        if (key === "pageNumbers") {
          documentSession.doc.settings.pageNumbers = !documentSession.doc.settings.pageNumbers;
          fileActions.markDirty();
          workspaceLayout.renderAll();
        }
        if (key === "showMore") {
          documentSession.doc.settings.showMore = !documentSession.doc.settings.showMore;
          pageActions.invalidateLayout();
          fileActions.markDirty();
          workspaceLayout.renderAll();
        }
        if (key === "titlePage") {
          documentSession.doc.titlePage.enabled = !documentSession.doc.titlePage.enabled;
          pageActions.invalidateLayout();
          fileActions.markDirty();
          workspaceLayout.renderAll();
        }
        if (key === "startCenter") {
          preferences.startCenterOnLaunch = !preferences.startCenterOnLaunch;
        }
        if (key === "ambientGlow") {
          preferences.ambientGlow = !preferences.ambientGlow;
          workspaceLayout.applyStudioAppearance();
        }
        if (key === "reducedMotion") {
          preferences.reducedMotionPref = !preferences.reducedMotionPref;
          workspaceLayout.applyStudioAppearance();
        }
        if (key === "smartType") {
          preferences.smartTypeEnabled = !preferences.smartTypeEnabled;
          if (!preferences.smartTypeEnabled) editorActions.hideSmartType();
        }
        if (key === "smartQuotes") {
          documentSession.doc.settings.smartQuotes = !documentSession.doc.settings.smartQuotes;
          fileActions.markDirty();
        }
        if (key === "autoUppercase") {
          preferences.autoUppercase = !preferences.autoUppercase;
        }
        if (key === "spellcheck") {
          preferences.spellcheck = !preferences.spellcheck;
          workspaceLayout.applyStudioAppearance();
        }
        if (key === "highlightActive") {
          preferences.highlightActiveLine = !preferences.highlightActiveLine;
          workspaceLayout.applyStudioAppearance();
        }
        if (key === "typewriterScroll") {
          preferences.typewriterScroll = !preferences.typewriterScroll;
        }
        const on = Boolean(getSwitchValue(key));
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-checked", String(on));
        workspaceLayout.syncPrefsUI();
        fileActions.updateSaveState();
        fileActions.persistPrefs();
      });
    });
    const themeSelect = $("#settingsTheme", els.dialogBody);
    if (themeSelect) themeSelect.addEventListener("change", () => workspaceLayout.applyTheme(themeSelect.value));
    const accentSelect = $("#settingsAccent", els.dialogBody);
    const setAccent = (choice) => {
      if (!ACCENT_THEMES[choice]) return;
      preferences.accentColor = choice;
      if (accentSelect) accentSelect.value = choice;
      $$(".accent-swatch", els.dialogBody).forEach((swatch) => {
        swatch.classList.toggle("is-active", swatch.dataset.accentChoice === choice);
      });
      workspaceLayout.applyStudioAppearance();
      fileActions.persistPrefs();
    };
    if (accentSelect) accentSelect.addEventListener("change", () => setAccent(accentSelect.value));
    $$(".accent-swatch", els.dialogBody).forEach((swatch) => {
      swatch.addEventListener("click", () => setAccent(swatch.dataset.accentChoice));
    });
    const paperTintSelect = $("#settingsPaperTint", els.dialogBody);
    if (paperTintSelect) {
      paperTintSelect.addEventListener("change", () => {
        preferences.paperTint = PAPER_TINTS[paperTintSelect.value] ? paperTintSelect.value : "ivory";
        workspaceLayout.applyStudioAppearance();
        fileActions.persistPrefs();
      });
    }
    const densitySelect = $("#settingsDensity", els.dialogBody);
    if (densitySelect) {
      densitySelect.addEventListener("change", () => {
        preferences.uiDensity = densitySelect.value;
        workspaceLayout.applyStudioAppearance();
        workspaceLayout.fitPaper();
        fileActions.persistPrefs();
      });
    }
    const modeSelect = $("#settingsMode", els.dialogBody);
    if (modeSelect) {
      modeSelect.addEventListener("change", () => {
        workspaceLayout.setMode(modeSelect.value);
      });
    }
    const zoomSelect = $("#settingsZoom", els.dialogBody);
    if (zoomSelect) {
      zoomSelect.addEventListener("change", () => {
        preferences.zoom = clamp(Number(zoomSelect.value) || 1, 0.6, 1.6);
        workspaceLayout.applyZoom();
        fileActions.persistPrefs();
      });
    }
    const fontSelect = $("#settingsFont", els.dialogBody);
    if (fontSelect) {
      fontSelect.addEventListener("change", () => {
        preferences.font = normalizeScriptFont(fontSelect.value);        workspaceLayout.applyPageMetrics();
        pageActions.useWorkspaceTypography();
        workspaceLayout.syncPrefsUI();
        fileActions.persistPrefs();
        if (workspaceState.mode === "page") pageActions.renderPagePreview();
      });
    }
    const fontSizeInput = $("#settingsFontSize", els.dialogBody);
    if (fontSizeInput) {
      fontSizeInput.addEventListener("change", () => {
        preferences.fontSize = clamp(Number(fontSizeInput.value) || 12, 8, 24);
        pageActions.useWorkspaceTypography();
        fontSizeInput.value = String(preferences.fontSize);
        pageActions.invalidateLayout();
        workspaceLayout.applyPageMetrics();
        workspaceLayout.syncPrefsUI();
        fileActions.persistPrefs();
        if (workspaceState.mode === "page") pageActions.renderPagePreview();
      });
    }
    const lineSpacingSelect = $("#settingsLineSpacing", els.dialogBody);
    if (lineSpacingSelect) {
      lineSpacingSelect.addEventListener("change", () => {
        preferences.lineSpacing = LINE_SPACING_OPTIONS[lineSpacingSelect.value] ? lineSpacingSelect.value : "normal";
        pageActions.invalidateLayout();
        workspaceLayout.applyPageMetrics();
        workspaceLayout.renderStatus();
        fileActions.persistPrefs();
        if (workspaceState.mode === "page") pageActions.renderPagePreview();
      });
    }
    const pagePresetSelect = $("#settingsPagePreset", els.dialogBody);
    if (pagePresetSelect) {
      pagePresetSelect.addEventListener("change", () => {
        const preset = PAGE_PRESETS[pagePresetSelect.value];
        if (!preset) return;
        documentSession.doc.page = { ...documentSession.doc.page, width: preset.width, height: preset.height };
        pageActions.invalidateLayout();
        fileActions.markDirty();
        workspaceLayout.renderAll();
        workspaceLayout.fitPaper();
      });
    }
    const sceneSideSelect = $("#settingsSceneNumberSide", els.dialogBody);
    if (sceneSideSelect) {
      sceneSideSelect.addEventListener("change", () => {
        documentSession.doc.settings.sceneNumberSide = ["both", "left", "right"].includes(sceneSideSelect.value)
          ? sceneSideSelect.value
          : "both";
        fileActions.markDirty();
        workspaceLayout.renderAll();
      });
    }
    const target = $("#settingsTarget", els.dialogBody);
    if (target) {
      target.addEventListener("change", () => {
        documentSession.doc.settings.targetPages = clamp(Number(target.value) || 120, 1, 999);
        fileActions.markDirty();
        workspaceLayout.renderAll();
        fileActions.persistPrefs();
      });
    }
    const autosaveIntervalSelect = $("#settingsAutosaveInterval", els.dialogBody);
    if (autosaveIntervalSelect) {
      autosaveIntervalSelect.addEventListener("change", () => {
        preferences.autosaveDelay = clamp(Number(autosaveIntervalSelect.value) || 650, 200, 10000);
        fileActions.persistPrefs();
      });
    }
    const readRateSelect = $("#settingsReadRate", els.dialogBody);
    if (readRateSelect) {
      readRateSelect.addEventListener("change", () => {
        preferences.readRate = Number(readRateSelect.value) || 1;
        workspaceLayout.syncPrefsUI();
        fileActions.persistPrefs();
      });
    }
    const reveal = $("#revealData", els.dialogBody);
    if (reveal) {
      reveal.addEventListener("click", () => {
        if (desktopState.appInfo && desktopState.appInfo.userData) desktop.showInFolder(desktopState.appInfo.userData);
      });
    }
  }
  async function loadSample() {
    if (!(await fileActions.confirmDiscard("Loading the sample will replace the current edits."))) return;
    fileActions.loadDocument(sampleDocument(), { clearRecovery: true });
    modalActions.toast("Sample loaded", "The Last Signal is back on the page.", "success");
  }
  function openHelp() {
    const shortcuts = [
      ["Command palette", "Ctrl K"],
      ["Save / Save as", "Ctrl S / Ctrl Shift S"],
      ["Open / New", "Ctrl O / Ctrl N"],
      ["Find / Replace", "Ctrl F / Ctrl H"],
      ["Export PDF / Print", "Ctrl Shift E / Ctrl P"],
      ["Undo / redo", "Ctrl Z / Ctrl Y"],
      ["Bold / italic / underline", "Ctrl B / I / U"],
      ["Switch between script and its controls", "F6"],
      ["Next element", "Tab"],
      ["Previous element", "Shift Tab"],
      ["New paragraph", "Enter"],
      ["Line break", "Shift Enter"],
      ["New scene", "Ctrl Enter"],
      ["Prev / next scene", "Ctrl Alt ↑ / ↓"],
      ["Element type", "Alt 0–9 E/S/O/L"],
      ["Table read", "Ctrl Alt R"],
      ["Revision mode", "Ctrl Alt V"],
      ["Start next revision", "Ctrl Alt N"],
      ["Page view", "Ctrl Alt P"],
      ["Search everything", "Ctrl Shift F"],
      ["Focus mode", "Ctrl Alt F"],
      ["Exit focus / close dialog", "Esc"],
    ];
    modalActions.openDialog({
      eyebrow: "Keyboard",
      title: "Move at the speed of the page",
      /* `wide: true` (760px) instead of the 560px default.
       *
       * The list is a two-column grid, so each track gets half the dialog body: at the
       * default width that is a 246px track, and the widest entry — "Bold / italic /
       * underline" plus its five keycap chips for "Ctrl B / I / U" — does not fit in it.
       * Measured: 18px of overflow, and the label could only avoid that by wrapping into
       * 3-4 lines ("Save /" "Save" "as"). At 760px each track is ~347px, which holds the
       * longest label and its keycaps on one line with room to spare. */
      wide: true,
      body: `<div class="shortcut-grid">${shortcuts
        .map(
          ([label, keys]) =>
            `<div class="shortcut-row"><span>${escapeHtml(label)}</span><span>${keys
              .split(" ")
              .map((key) => `<kbd>${escapeHtml(key)}</kbd>`)
              .join("")}</span></div>`,
        )
        .join("")}</div><div class="dialog-note">In the desktop build, drag an FDX file onto the window to open it. All files stay local.</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
  }
  function openUserGuide() {
    modalActions.openDialog({
      title: 'Using Azkript', eyebrow: 'User guide', wide: true,
      body: `<h3>Write and save</h3><p>Open an FDX screenplay or start a new draft. Choose the paragraph type, use Tab to move between elements, and save with Ctrl S. Save As creates a separate file. Keep independent backups of important work.</p>
        <h3>Find your tools</h3><p>Ctrl K opens the command palette. Workspace tools contain layouts, project folders, linked notes and draft milestones. Ctrl Shift F searches scenes, notes, beats, characters and tags.</p>
        <h3>Production and story planning</h3><p>Production tools contain issued page locking, revisions, breakdowns, exchange formats and table-read audio. Story studio contains timelines, continuity evidence, character arcs, branches, storyboards and rehearsal. Continuity facts come from you; timing is estimated.</p>
        <h3>Share a copy</h3><p>Export PDF for a fixed layout, FDX for supported screenplay interchange, or a clean review copy to remove Azkript planning and review data. Other editors may discard Azkript-only data. Exact pagination parity is not certified.</p>
        <h3>Recovery and privacy</h3><p>Recovery and version history stay in the local profile, including with the portable app. Uninstall keeps that data. Notes, branches, images and recordings can be embedded in saved FDX files, so inspect files before sharing.</p>`,
      actions: [{ label: 'Keyboard shortcuts', onClick: openHelp }, { label: 'Close', kind: 'primary' }],
    });
  }
  function openDocumentDetails() {
    const stats = getStats(documentSession.doc);
    const pages = pageActions.pageCount();
    modalActions.openDialog({
      eyebrow: "Document",
      title: documentSession.doc.title || "Untitled Screenplay",
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:1fr 1fr;margin-bottom:14px">
          <div class="stat-card"><strong>${pages}</strong><span>Pages</span></div>
          <div class="stat-card"><strong>${stats.words.toLocaleString()}</strong><span>Words</span></div>
          <div class="stat-card"><strong>${stats.scenes}</strong><span>Scenes</span></div>
          <div class="stat-card"><strong>${stats.characters}</strong><span>Speaking roles</span></div>
        </div>
        <p class="dialog-note">${documentSession.filePath ? `File: ${escapeHtml(documentSession.filePath)}` : isDesktop ? "This draft has not been saved to a file yet." : "Browser mode · autosaved locally"}<br>FDX v6 · ${escapeHtml(scriptFontLabel(preferences.font))} ${escapeHtml(String(preferences.fontSize))} pt · ${escapeHtml(String(documentSession.doc.page.width))} × ${escapeHtml(String(documentSession.doc.page.height))} in · ${documentSession.doc.settings.targetPages} page target</p>`,
      actions: [
        { label: "Export PDF", kind: "primary", onClick: pageActions.exportPDF },
        { label: "Export FDX", onClick: fileActions.exportFDX },
        { label: "Title page", onClick: productionActions.openTitlePage },
        { label: "Page setup", onClick: openPageSetup },
        { label: "Close" },
      ],
    });
  }
  function openPageSetup() {
    const page = documentSession.doc.page;
    const presetKey = currentPagePreset(page);
    modalActions.openDialog({
      eyebrow: "Page setup",
      title: "Shape the page",
      body: `
        <label class="field"><span>Page size preset</span><select id="setupPreset">${Object.entries(PAGE_PRESETS).map(([key, item]) => `<option value="${key}"${presetKey === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}<option value="custom"${presetKey === "custom" ? " selected" : ""}>Custom dimensions</option></select></label>
        <div class="field-grid">
          <label class="field"><span>Page width (in)</span><input id="setupWidth" type="number" min="5" max="14" step="0.01" value="${page.width}"></label>
          <label class="field"><span>Page height (in)</span><input id="setupHeight" type="number" min="7" max="20" step="0.01" value="${page.height}"></label>
          <label class="field"><span>Top margin (in)</span><input id="setupTop" type="number" min="0.5" max="2.5" step="0.1" value="${page.top}"></label>
          <label class="field"><span>Bottom margin (in)</span><input id="setupBottom" type="number" min="0.5" max="2.5" step="0.1" value="${page.bottom}"></label>
        </div>
        <div class="setting-line"><div><strong>Scene numbers</strong><span>Print automatic numbers beside scene headings.</span></div><button type="button" class="switch ${documentSession.doc.settings.sceneNumbers ? "is-on" : ""}" id="setupSceneNumbers" role="switch" aria-checked="${documentSession.doc.settings.sceneNumbers}"><span></span></button></div>
        <label class="field" style="margin-top:8px"><span>Scene number placement</span><select id="setupSceneSide"><option value="both"${(documentSession.doc.settings.sceneNumberSide || "both") === "both" ? " selected" : ""}>Both margins (Left &amp; Right)</option><option value="left"${documentSession.doc.settings.sceneNumberSide === "left" ? " selected" : ""}>Left margin only</option><option value="right"${documentSession.doc.settings.sceneNumberSide === "right" ? " selected" : ""}>Right margin only</option></select></label>
        <div class="setting-line"><div><strong>Page numbers in header</strong><span>Show numbered folios in the top-right header of script pages.</span></div><button type="button" class="switch ${documentSession.doc.settings.pageNumbers !== false ? "is-on" : ""}" id="setupPageNumbers" role="switch" aria-checked="${documentSession.doc.settings.pageNumbers !== false}"><span></span></button></div>
        <div class="setting-line"><div><strong>(MORE) / (CONT'D)</strong><span>Continue split dialogue with standard page markers.</span></div><button type="button" class="switch ${documentSession.doc.settings.showMore ? "is-on" : ""}" id="setupMore" role="switch" aria-checked="${documentSession.doc.settings.showMore}"><span></span></button></div>
        <label class="field"><span>Target length (pages)</span><input id="setupTarget" type="number" min="1" max="999" value="${documentSession.doc.settings.targetPages}"></label>
        <div class="dialog-note">FDX stores page margins in points; this dialog converts inches to points on export. Page sizes are applied to screen preview, print, and PDF.</div>`,
      actions: [
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            const width = clamp(Number($("#setupWidth", els.dialogBody).value) || page.width, 5, 14);
            const height = clamp(Number($("#setupHeight", els.dialogBody).value) || page.height, 7, 20);
            const top = clamp(Number($("#setupTop", els.dialogBody).value) || page.top, 0.5, 2.5);
            const bottom = clamp(Number($("#setupBottom", els.dialogBody).value) || page.bottom, 0.5, 2.5);
            documentSession.doc.page = { ...page, width, height, top, bottom };
            documentSession.doc.settings.sceneNumbers = $("#setupSceneNumbers", els.dialogBody).classList.contains("is-on");
            documentSession.doc.settings.sceneNumberSide = $("#setupSceneSide", els.dialogBody).value || "both";
            documentSession.doc.settings.pageNumbers = $("#setupPageNumbers", els.dialogBody).classList.contains("is-on");
            documentSession.doc.settings.showMore = $("#setupMore", els.dialogBody).classList.contains("is-on");
            documentSession.doc.settings.targetPages = clamp(Number($("#setupTarget", els.dialogBody).value) || 120, 1, 999);
            pageActions.invalidateLayout();
            fileActions.markDirty();
            documentSession.history.record();
            workspaceLayout.renderAll();
            workspaceLayout.syncPrefsUI();
            workspaceLayout.fitPaper();
            if (workspaceState.mode === "page") pageActions.renderPagePreview();
            modalActions.toast("Page updated", `${width} × ${height} in · ${top} in top / ${bottom} in bottom.`, "success");
          },
        },
        { label: "Cancel" },
      ],
    });
    const presetSelect = $("#setupPreset", els.dialogBody);
    if (presetSelect) {
      presetSelect.addEventListener("change", () => {
        const preset = PAGE_PRESETS[presetSelect.value];
        if (!preset) return;
        $("#setupWidth", els.dialogBody).value = String(preset.width);
        $("#setupHeight", els.dialogBody).value = String(preset.height);
      });
    }
    ["setupSceneNumbers", "setupPageNumbers", "setupMore"].forEach((id) => {
      const button = $(`#${id}`, els.dialogBody);
      button.addEventListener("click", () => {
        button.classList.toggle("is-on");
        button.setAttribute("aria-checked", String(button.classList.contains("is-on")));
      });
    });
  }
  return {
    loadSample,
    openAboutDialog,
    openAccountDialog,
    openCheckUpdatesDialog,
    openCollaborationDialog,
    openDocumentDetails,
    openFeedbackDialog,
    openGetHelpDialog,
    openHelp,
    openPageSetup,
    openSamplesDialog,
    openSettings,
    openTutorialsDialog,
    openUserGuide,
    openWelcomeDialog,
    openWhatsNewDialog,
    signOutAction
  };
};
