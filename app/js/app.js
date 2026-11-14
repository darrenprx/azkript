/* Azkript — application controller */
(() => {
  "use strict";
  const {
    ELEMENTS: DEFAULT_ELEMENTS,
    PALETTE,
    REVISION_COLORS,
    uid,
    escapeHtml,
    stripHtml,
    wordCount,
    makeParagraph,
    blankDocument,
    sampleDocument,
    templateDocument,
    normalizeDocument,
    cloneDocument,
    paragraphText,
    elementSpec: modelElementSpec,
    nextType: modelNextType,
    tabType: modelTabType,
    getScenes,
    getLocations,
    getCharacters,
    getStats,
    revisionEntry,
    nextRevision,
    markRevision,
    validateDocument,
  } = FDModel;
  let elementDocument = null;
  const ELEMENTS = new Proxy(DEFAULT_ELEMENTS, {
    get: (target, key) => elementDocument?.elements?.[key] || target[key],
    has: (target, key) => Boolean(elementDocument?.elements?.[key] || key in target),
    ownKeys: target => [...new Set([...Object.keys(target), ...Object.keys(elementDocument?.elements || {})])],
    getOwnPropertyDescriptor: (target, key) => ({ configurable: true, enumerable: true, value: elementDocument?.elements?.[key] || target[key] }),
  });
  const elementSpec = type => modelElementSpec(type, elementDocument);
  const nextType = type => modelNextType(type, elementDocument);
  const tabType = (type, shift) => modelTabType(type, shift, elementDocument);
  const browserBackups = new FDWritingTools.BrowserBackups();
  const regexClient = FDCoreWriting.createRegexClient(new URL("js/search-worker.js", location.href), { timeoutMs: 1500, maxMatches: 10000 });
  const paginationClient = FDCoreWriting.createPaginationClient(new URL("js/pagination-worker.js", location.href), { source: window.FDPaginationWorkerSource });
  let paginationTimer = null;
  let paginationSequence = 0;
  let pagePreviewObserver = null;
  let findGeneration = 0;
  let backupTimer = null;
  let lastVersionSnapshot = 0;
  let workspaceUI = null;
  let productionUI = null;
  let storyUI = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => motionQuery.matches || state.reducedMotionPref;
  /* Storage keys. Current names are azkript.*; the pre-rename fdstudio.* names
   * are read once so an existing workspace opens with its document and
   * preferences intact, then dropped after the migrated value is written. */
  const DOC_KEY = "azkript.document.v3";
  const LEGACY_DOC_KEY = "azkript.document.v2";
  const PREFS_KEY = "azkript.prefs.v2";
  const LEGACY_PREFS_KEY = "azkript.prefs.v1";
  const RENAMED_DOC_KEYS = ["fdstudio.document.v3", "fdstudio.document.v2"];
  const RENAMED_PREFS_KEYS = ["fdstudio.prefs.v2", "fdstudio.prefs.v1"];
  /* `azkript` is the current preload bridge; `fdDesktop` is the pre-rename
   * alias, still accepted so an older packaged preload keeps working. */
  const bridge = window.azkript || window.fdDesktop || null;
  const desktop = bridge && bridge.isDesktop ? bridge : null;
  const isDesktop = Boolean(desktop);
  const iconMarkup = new Map();
  const icon = (name) => {
    if (!iconMarkup.has(name)) iconMarkup.set(name, `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`);
    return iconMarkup.get(name);
  };
  /* Script typeface. Only families that actually resolve on a stock Windows   * install are offered, so nothing in the UI can point at a missing font.   * Courier New ships with Windows and is therefore the default; "Courier   * Screenplay" is the product's display label for it, which keeps every   * visible font option unbranded. */
  const SCRIPT_FONT = "Courier New";
  const SCRIPT_FONT_CHOICES = [    { value: "Courier New", label: "Courier Screenplay" },    { value: "Consolas", label: "Consolas" },    { value: "Lucida Console", label: "Lucida Console" },  ];
  /* Prefs saved by older builds may carry a font family name that this build no   * longer offers, or one that is not installed on this machine; fall back to   * the shipped default instead of leaving a reference that cannot resolve.   * Every value the app has ever persisted came from its own font list, so an   * unknown value is always a stale entry rather than a custom family. */
  const normalizeScriptFont = (value) => {
    const text = String(value || "").trim();
    const match = SCRIPT_FONT_CHOICES.find(      (choice) => choice.value.toLowerCase() === text.toLowerCase(),    );
    return match ? match.value : SCRIPT_FONT;
  };
  const scriptFontLabel = (value) => {
    const family = normalizeScriptFont(value);
    const choice = SCRIPT_FONT_CHOICES.find((item) => item.value === family);
    return choice ? choice.label : family;
  };
  /* The requested family first, then the remaining installed monospace faces,   * so a machine missing one still renders correctly. */
  const scriptFontStack = (value) => {
    const family = normalizeScriptFont(value);
    const fallbacks = SCRIPT_FONT_CHOICES.map((choice) => `"${choice.value}"`).filter(      (item) => item !== `"${family}"`,    );
    return [`"${family}"`, ...fallbacks, "monospace"].join(", ");
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const slug = (type) => String(type || "Action").toLowerCase().replace(/\s+/g, "-");
  const escapeSelector = (value) =>
    window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  const formatTime = (value) =>
    value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const formatDate = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };
  const plural = (count, singular, pluralWord) =>
    `${count} ${count === 1 ? singular : pluralWord || `${singular}s`}`;
  const els = {
    appShell: $("#appShell"),
    avatar: $("#avatar"),
    scenesPanel: $("#scenesPanel"),
    workspace: $(".workspace"),
    editor: $("#editor"),
    paper: $("#paper"),
    paperScroll: $("#paperScroll"),
    paperWrap: $("#paperWrap"),
    pagePreview: $("#pagePreview"),
    sceneList: $("#sceneList"),
    sceneCount: $("#sceneCount"),
    sceneSearch: $("#sceneSearch"),
    navigatorSearch: $("#navigatorSearch"),
    sceneGrid: $("#sceneGrid"),
    castGrid: $("#castGrid"),
    castCount: $("#castCount"),
    statGrid: $("#statGrid"),
    sceneChart: $("#sceneChart"),
    dialogueDonut: $("#dialogueDonut"),
    dialoguePercent: $("#dialoguePercent"),
    longestScene: $("#longestScene"),
    targetReport: $("#targetReport"),
    locationList: $("#locationList"),
    sceneTable: $("#sceneTable"),
    insightList: $("#insightList"),
    elementChoices: $("#elementChoices"),
    elementName: $("#elementName"),
    elementHint: $("#elementHint"),
    elementSwatch: $("#elementSwatch"),
    elementSelect: $("#elementSelect"),
    geometryGrid: $("#geometryGrid"),
    saveState: $("#saveState"),
    saveStateText: $("#saveStateText"),
    docTitle: $("#docTitle"),
    documentPill: $("#documentPill"),
    scriptTitle: $("#scriptTitle"),
    paperTitle: $("#paperTitle"),
    paperPage: $("#paperPage"),
    paperWords: $("#paperWords"),
    metaScenes: $("#metaScenes"),
    metaPages: $("#metaPages"),
    metaEdited: $("#metaEdited"),
    metaRevision: $("#metaRevision"),
    metaRevisionText: $("#metaRevisionText"),
    statusLocation: $("#statusLocation"),
    statusWords: $("#statusWords"),
    statusScenes: $("#statusScenes"),
    statusPages: $("#statusPages"),
    statusRead: $("#statusRead"),
    statusMode: $("#statusMode"),
    statusRevision: $("#statusRevision"),
    statusRecovery: $("#statusRecovery"),
    zoomLabel: $("#zoomLabel"),
    titleInput: $("#titleInput"),
    authorInput: $("#authorInput"),
    pageWidth: $("#pageWidth"),
    pageHeight: $("#pageHeight"),
    pageTop: $("#pageTop"),
    pageBottom: $("#pageBottom"),
    targetPagesInput: $("#targetPagesInput"),
    dialog: $("#appDialog"),
    dialogEyebrow: $("#dialogEyebrow"),
    dialogTitle: $("#dialogTitle"),
    dialogBody: $("#dialogBody"),
    dialogActions: $("#dialogActions"),
    commandDialog: $("#commandDialog"),
    commandInput: $("#commandInput"),
    commandList: $("#commandList"),
    fileInput: $("#fileInput"),
    toastStack: $("#toastStack"),
    railIndicator: $("#railIndicator"),
    themeToggle: $("#themeToggle"),
    focusToggle: $("#focusToggle"),
    undoButton: $("#undoButton"),
    redoButton: $("#redoButton"),
    panelPages: $("#panelPages"),
    panelProgress: $("#panelProgress"),
    panelFootNote: $("#panelFootNote"),
    paceFill: $("#paceFill"),
    paceCopy: $("#paceCopy"),
    editorWatermark: $("#editorWatermark"),
    viewSegmented: $("#viewSegmented"),
    pageDock: $("#pageDock"),
    pageDockLabel: $("#pageDockLabel"),
    pagePrev: $("#pagePrev"),
    pageNext: $("#pageNext"),
    pageDots: $("#pageDots"),
    revisionButton: $("#revisionButton"),
    revisionSwatch: $("#revisionSwatch"),
    revisionLabel: $("#revisionLabel"),
    revisionMini: $("#revisionMini"),
    sceneNumbersToggle: $("#sceneNumbersToggle"),
    sceneInspectorEmpty: $("#sceneInspectorEmpty"),
    sceneInspectorFields: $("#sceneInspectorFields"),
    sceneInspectorDot: $("#sceneInspectorDot"),
    sceneInspectorTitle: $("#sceneInspectorTitle"),
    sceneInspectorMeta: $("#sceneInspectorMeta"),
    sceneNumberInput: $("#sceneNumberInput"),
    sceneSynopsis: $("#sceneSynopsis"),
    sceneNotes: $("#sceneNotes"),
    sceneColorRow: $("#sceneColorRow"),
    sceneOmitToggle: $("#sceneOmitToggle"),
    findDialog: $("#findDialog"),
    findInput: $("#findInput"),
    replaceInput: $("#replaceInput"),
    findCount: $("#findCount"),
    findResults: $("#findResults"),
    startCenter: $("#startCenter"),
    startStats: $("#startStats"),
    recentList: $("#recentList"),
    recoveryBanner: $("#recoveryBanner"),
    recoveryCopy: $("#recoveryCopy"),
    startOnLaunch: $("#startOnLaunch"),
    readDock: $("#readDock"),
    readLine: $("#readLine"),
    readSpeaker: $("#readSpeaker"),
    readKicker: $("#readKicker"),
    readPulse: $("#readPulse"),
    readProgress: $("#readProgress"),
    readPlay: $("#readPlay"),
    readVoice: $("#readVoice"),
    readRate: $("#readRate"),
    printRoot: $("#printRoot"),
    printStyle: $("#printStyle"),
    smartType: $("#smartType"),
    menuBar: $("#menuBar"),
    ribbonBar: $("#ribbonBar"),
    ribbonScroller: $("#ribbonScroller"),
    ribbonDeck: $("#ribbonDeck"),
    ribbonPopover: $("#ribbonPopover"),
    ribbonPinButton: $("#ribbonPinButton"),
    sprintQuickButton: $("#sprintQuickButton"),
    outlineLayer: $("#outlineLayer"),
    outlineBar: $("#outlineBar"),
    outlineTrack: $("#outlineTrack"),
    rulerBar: $("#rulerBar"),
    rulerInner: $("#rulerInner"),
    rulerTicks: $("#rulerTicks"),
    rulerMarkerLeft: $("#rulerMarkerLeft"),
    rulerMarkerFirst: $("#rulerMarkerFirst"),
    rulerMarkerRight: $("#rulerMarkerRight"),
    splitPane: $("#splitPane"),
    splitPaneBody: $("#splitPaneBody"),
    outlineToggleButton: $("#outlineToggleButton"),
    rulerToggleButton: $("#rulerToggleButton"),
    splitViewButton: $("#splitViewButton"),
    splitViewLabel: $("#splitViewLabel"),
    dualDialogueButton: $("#dualDialogueButton"),
    scriptNoteButton: $("#scriptNoteButton"),
    editorStage: $("#editorStage"),
  };
  const ACCENT_THEMES = {
    cobalt: {
      label: "Azkript Cobalt",
      swatch: "#0f6cbd",
      light: { brand: "#0f6cbd", hover: "#115ea3", pressed: "#0c3b5e", soft: "rgba(15, 108, 189, 0.12)", soft2: "rgba(15, 108, 189, 0.18)" },
      dark: { brand: "#479ef5", hover: "#62abf5", pressed: "#2886de", soft: "rgba(71, 158, 245, 0.16)", soft2: "rgba(71, 158, 245, 0.24)" },
    },
    violet: {
      label: "Director Violet",
      swatch: "#6b48a8",
      light: { brand: "#6b48a8", hover: "#58398e", pressed: "#432a6d", soft: "rgba(107, 72, 168, 0.12)", soft2: "rgba(107, 72, 168, 0.18)" },
      dark: { brand: "#a682e8", hover: "#b798f0", pressed: "#8e66d8", soft: "rgba(166, 130, 232, 0.16)", soft2: "rgba(166, 130, 232, 0.24)" },
    },
    teal: {
      label: "Soundstage Teal",
      swatch: "#03787c",
      light: { brand: "#03787c", hover: "#026266", pressed: "#01494c", soft: "rgba(3, 120, 124, 0.12)", soft2: "rgba(3, 120, 124, 0.18)" },
      dark: { brand: "#3cc5c9", hover: "#5fd3d6", pressed: "#25adb1", soft: "rgba(60, 197, 201, 0.16)", soft2: "rgba(60, 197, 201, 0.24)" },
    },
    amber: {
      label: "Golden Hour",
      swatch: "#c2500e",
      light: { brand: "#c2500e", hover: "#a4420a", pressed: "#7c3107", soft: "rgba(194, 80, 14, 0.12)", soft2: "rgba(194, 80, 14, 0.18)" },
      dark: { brand: "#f59047", hover: "#f8a468", pressed: "#e0782c", soft: "rgba(245, 144, 71, 0.16)", soft2: "rgba(245, 144, 71, 0.24)" },
    },
    crimson: {
      label: "Red Carpet",
      swatch: "#b8252a",
      light: { brand: "#b8252a", hover: "#991d22", pressed: "#741519", soft: "rgba(184, 37, 42, 0.12)", soft2: "rgba(184, 37, 42, 0.18)" },
      dark: { brand: "#f26b70", hover: "#f5878b", pressed: "#de4f54", soft: "rgba(242, 107, 112, 0.16)", soft2: "rgba(242, 107, 112, 0.24)" },
    },
    forest: {
      label: "Backlot Forest",
      swatch: "#2f7426",
      light: { brand: "#2f7426", hover: "#255e1e", pressed: "#1b4516", soft: "rgba(47, 116, 38, 0.12)", soft2: "rgba(47, 116, 38, 0.18)" },
      dark: { brand: "#68c75a", hover: "#82d276", pressed: "#4fb241", soft: "rgba(104, 199, 90, 0.16)", soft2: "rgba(104, 199, 90, 0.24)" },
    },
  };
  const PAPER_TINTS = {
    ivory: { label: "Warm Ivory", paper: "#fffefb", ink: "#171614", edge: "rgba(60, 50, 35, 0.12)" },
    white: { label: "Pure White", paper: "#ffffff", ink: "#141413", edge: "rgba(0, 0, 0, 0.1)" },
    sepia: { label: "Soft Sepia", paper: "#f6efe0", ink: "#241e16", edge: "rgba(75, 58, 34, 0.16)" },
    sage: { label: "Azkript Mint", paper: "#f1f6f1", ink: "#162018", edge: "rgba(38, 66, 44, 0.13)" },
    slate: { label: "Night Slate", paper: "#222326", ink: "#eceae4", edge: "rgba(255, 255, 255, 0.14)" },
  };
  const LINE_SPACING_OPTIONS = {
    normal: { label: "Standard 1.0× (12 pt grid)", css: "1.18", multiplier: 1 },
    relaxed: { label: "Relaxed 1.15×", css: "1.34", multiplier: 1.15 },
    loose: { label: "Loose 1.3×", css: "1.5", multiplier: 1.3 },
  };
  const PAGE_PRESETS = {
    letter: { label: "US Letter (8.5 × 11 in)", width: 8.5, height: 11 },
    a4: { label: "ISO A4 (8.27 × 11.69 in)", width: 8.27, height: 11.69 },
    legal: { label: "US Legal (8.5 × 14 in)", width: 8.5, height: 14 },
  };
  const state = {
    fileIdentity: null,
    externalChange: null,
    typographyMode: "document",
    uiScale: 1,
    doc: sampleDocument(),
    view: "script",
    mode: "write",
    theme: "system",
    accentColor: "cobalt",
    paperTint: "ivory",
    uiDensity: "comfortable",
    ambientGlow: true,
    reducedMotionPref: false,
    lineSpacing: "normal",
    smartTypeEnabled: true,
    autoUppercase: false,
    spellcheck: true,
    highlightActiveLine: true,
    typewriterScroll: false,
    autosaveDelay: 650,
    inspectorTab: "format",
    zoom: 1,
    fit: 1,
    flow: false,
    selectedId: null,
    activeScene: 0,
    /* Set by an explicit scene navigation that could not centre its heading because the
     * scroll hit the document clamp (short tail at the end of a script). Consumed once
     * by updateActiveSceneFromScroll so the highlight follows the user's intent rather
     * than the unreachable geometry. Null means "use the geometric answer". */
    navigatedSceneId: null,
    /* Programmatic-scroll intent (see scrollParagraphIntoView / goToScene):
     *   navigationTarget   — the scrollTop a navigation is heading for
     *   navigationInFlight — true until that scroll lands or times out
     *   navigationSettleTimer — fallback release for engines that never fire scrollend
     * While in flight the scene tracker pins the navigated scene instead of deriving it
     * from geometry, so the navigator does not flash through every scene on the way. */
    navigationTarget: null,
    navigationInFlight: false,
    navigationSettleTimer: null,
    dirty: false,
    saving: false,
    /* True while the last local write failed (quota / private window / storage     * disabled). Drives the honest "Not saved" status chip; cleared as soon as a     * write lands. saveFailureNotified keeps the error toast from repeating on     * every autosave tick while the condition persists. */
    saveFailed: false,    saveFailureNotified: false,    editVersion: 0,
    lastSaved: null,
    autosave: true,
    showGuides: true,
    showInvisibles: false,
    showOutline: true,
    showRuler: true,
    splitView: {
      enabled: false,
      orientation: "vertical",
      swapped: false,
      mode: "cards",
    },
    ribbonTab: "home",
    ribbonSyncTimer: null,
    navTab: "scenes",
    cardMode: "summary",
    cardsAcross: 0,
    sceneViewCols: { title: true, summary: true, action: true },
    beatSnap: true,
    reportType: "statistics",
    showAlts: true,
    tagsMode: false,
    trackChanges: false,
    sprint: {
      open: false,
      running: false,
      durationMin: 25,
      remainingSec: 1500,
      startWords: 0,
      timer: null,
    },
    openMenu: null,
    selectedBeatId: null,
    beatConnectMode: false,
    beatConnectSource: null,
    showOutlineInScript: true,
    showStructureLines: false,
    hideScriptNotes: false,
    navigatorVisible: true,
    textColor: "#171614",
    highlightColor: "#ffe9a3",
    typewriterMode: "off",
    outlineZoom: 1,
    beatConnectionColor: "#0f6cbd",
    profile: { name: "Local Writer", role: "Writer" },
    lastBackupAt: 0,
    savedSnapshot: null,
    trackedBaseline: null,
    font: SCRIPT_FONT,    fontSize: 12,
    sceneQuery: "",
    navigatorQuery: "",
    history: null,
    saveTimer: null,
    historyTimer: null,
    sceneTimer: null,
    windowTimer: null,
    scrollTick: false,
    commandIndex: 0,
    commands: [],
    layout: null,
    layoutDirty: true,
    pageCount: 0,
    pageIndex: 0,
    layoutSignature: "",
    filePath: null,
    fileName: null,
    startCenterOnLaunch: true,
    startCenterOpen: false,
    startCenterCloseTimer: null,
    suppressStartCenter: false,
    tooltipEl: null,
    tooltipTrigger: null,
    tooltipTimer: null,
    recovery: null,
    recoveryWrittenAt: null,
    pendingDiscard: null,
    appInfo: null,
    recent: [],
    dragScene: null,
    find: {
      open: false,
      query: "",
      replacement: "",
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      matches: [],
      index: 0,
      mode: "find",
    },
    read: {
      active: false,
      playing: false,
      paused: false,
      items: [],
      index: 0,
      rate: 1,
      voiceURI: "",
      token: 0,
      utterance: null,
      currentName: "",
    },
    lastRevisionFlash: 0,
    smart: {
      visible: false,
      items: [],
      index: 0,
      elementId: null,
      mode: "",
    },
  };
  /* The line, measured from the top of the scrolling paper, above which a scene heading
   * counts as "the scene you are looking at".
   *
   * This number was duplicated: `updateActiveSceneFromScroll` used a hard-coded 190,
   * while `scrollParagraphIntoView(el, "center")` — what `goToScene` calls — positions
   * the heading at 38% of the viewport height. Those disagree, and on any viewport
   * taller than ~500px the 38% line is BELOW 190px: measured 248px at 1440x1080 and
   * 218px at 1440x1000. So after clicking scene N the heading sat past the threshold,
   * the tracker still saw scene N-1 as the last one above the line, and the highlighted
   * row jumped back one. That is the reported "clicking some scene also jump to a
   * previous scene". It always landed exactly one scene earlier, which is why it read
   * as an off-by-one rather than a scroll bug.
   *
   * One constant feeds both call sites, so the heading a click centres can never fall
   * outside the band the tracker measures. A few px of tolerance keeps sub-pixel
   * rounding from flipping the result.
   *
   * Declared here, above `scrollParagraphIntoView`, so it is initialised before any
   * scroll can run — no temporal-dead-zone dependency on declaration order. */
  const SCENE_ANCHOR_FRACTION = 0.38;
  /* Returns null when the reading viewport has not been laid out yet.
   *
   * It used to fall back to a hard-coded 190, which quietly reintroduced the original
   * two-thresholds bug for any call that ran before layout: the tracker would measure
   * against 190 while the scroll path measures against 38% of the real height. But a
   * zero-height container means `scrollParagraphIntoView` has already bailed out
   * (`if (!cRect.height) return;`) — no scroll has happened, so there is nothing correct
   * for the tracker to derive. Returning null makes the caller skip rather than guess.
   * Both sides now depend on the same precondition instead of disagreeing about it. */
  function sceneAnchorOffset() {
    const container = els.paperScroll;
    if (!container) return null;
    const height = container.getBoundingClientRect().height;
    if (!height) return null;
    return height * SCENE_ANCHOR_FRACTION + 4;
  }
  /* ------------------------------------------------------------------ */
  /* storage + history                                                   */
  /* ------------------------------------------------------------------ */
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  /* Read the first key that parses, in the order given. A value found under a
   * pre-rename fdstudio.* key is reported so the caller can re-save it under
   * the current name and drop the stale copy. */
  function storageGetMigrated(keys) {
    for (const key of keys) {
      const parsed = safeParse(storageGet(key));
      if (parsed) return { value: parsed, key };
    }
    return { value: null, key: null };
  }
  function dropRenamedKeys(keys, keep) {
    for (const key of keys) {
      if (key === keep) continue;
      try {
        localStorage.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    }
  }
  class History {
    /* History entries must not depend on volatile bookkeeping. Autosave stamps
     * doc.updatedAt/savedAt between keystrokes; hashing those fields pushed a
     * phantom step, so the first Ctrl+Z was a silent no-op. */
    static snapshot(doc) {
      return JSON.stringify(doc, (key, value) =>
        key === "updatedAt" || key === "savedAt" || key === "sourceFDX" ? undefined : value,
      );
    }
    constructor(doc) {
      this.sourceFDX = doc.sourceFDX;
      this.selectionPast = [];
      this.selectionFuture = [];
      this.selectionCurrent = null;
      this.past = [];
      this.future = [];
      this.current = History.snapshot(doc);
      this.timer = null;
      this.burstActive = false;
    }
    reset(doc) {
      this.sourceFDX = doc.sourceFDX;
      this.selectionPast = [];
      this.selectionFuture = [];
      this.selectionCurrent = null;
      this.past = [];
      this.future = [];
      this.current = History.snapshot(doc);
      this.burstActive = false;
      clearTimeout(this.timer);
      this.timer = null;
    }
    schedule() {
      if (!this.burstActive) {
        this.record();
        this.burstActive = true;
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.burstActive = false;
        this.current = History.snapshot(state.doc);
        this.selectionCurrent = FDCoreWriting.captureSelection(els.editor) || this.selectionCurrent;
        updateHistoryButtons();
      }, 450);
    }
    finishBurst() {
      if (!this.burstActive) return;
      clearTimeout(this.timer); this.timer = null; this.burstActive = false;
      this.current = History.snapshot(state.doc);
      this.selectionCurrent = FDCoreWriting.captureSelection(els.editor) || this.selectionCurrent;
    }
    record() {
      clearTimeout(this.timer);
      this.timer = null;
      this.burstActive = false;
      const next = History.snapshot(state.doc);
      if (next === this.current) return;
      this.past.push(this.current);
      this.selectionPast.push(this.selectionCurrent);
      if (this.past.length > 100) { this.past.shift(); this.selectionPast.shift(); }
      this.current = next;
      this.selectionCurrent = FDCoreWriting.captureSelection(els.editor);
      this.future = [];
      this.selectionFuture = [];
      updateHistoryButtons();
    }
    undo() {
      if (this.burstActive) {
        clearTimeout(this.timer);
        this.timer = null;
        this.burstActive = false;
        this.current = History.snapshot(state.doc);
      } else {
        this.record();
      }
      if (!this.past.length) return false;
      this.future.push(this.current);
      this.selectionFuture.push(FDCoreWriting.captureSelection(els.editor) || this.selectionCurrent);
      this.current = this.past.pop();
      this.selectionCurrent = this.selectionPast.pop();
      state.pendingSelection = this.selectionCurrent;
      state.doc = normalizeDocument({ ...JSON.parse(this.current), sourceFDX: this.sourceFDX });
      return true;
    }
    redo() {
      if (!this.future.length) return false;
      this.past.push(this.current);
      this.selectionPast.push(this.selectionCurrent);
      this.current = this.future.pop();
      this.selectionCurrent = this.selectionFuture.pop();
      state.pendingSelection = this.selectionCurrent;
      state.doc = normalizeDocument({ ...JSON.parse(this.current), sourceFDX: this.sourceFDX });
      this.burstActive = false;
      return true;
    }
  }
  function updateHistoryButtons() {
    if (els.undoButton) els.undoButton.disabled = !state.history || !state.history.past.length;
    if (els.redoButton) els.redoButton.disabled = !state.history || !state.history.future.length;
    const undoControls = $$('[data-ribbon-command="edit-undo"]');
    const redoControls = $$('[data-ribbon-command="edit-redo"]');
    undoControls.forEach((control) => {
      control.disabled = !state.history || !state.history.past.length;
    });
    redoControls.forEach((control) => {
      control.disabled = !state.history || !state.history.future.length;
    });
  }
  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */
  async function loadInitial() {
    const storedPrefs = storageGetMigrated([
      PREFS_KEY,
      LEGACY_PREFS_KEY,
      ...RENAMED_PREFS_KEYS,
    ]);
    const prefs = storedPrefs.value || {};
    state.theme = prefs.theme || "light";
    state.accentColor = ACCENT_THEMES[prefs.accentColor] ? prefs.accentColor : "cobalt";
    state.paperTint = PAPER_TINTS[prefs.paperTint] ? prefs.paperTint : "ivory";
    state.uiDensity = ["comfortable", "compact", "spacious"].includes(prefs.uiDensity)
      ? prefs.uiDensity
      : "comfortable";
    state.ambientGlow = prefs.ambientGlow !== false;
    state.reducedMotionPref = Boolean(prefs.reducedMotionPref);
    state.lineSpacing = LINE_SPACING_OPTIONS[prefs.lineSpacing] ? prefs.lineSpacing : "normal";
    state.smartTypeEnabled = prefs.smartTypeEnabled !== false;
    state.autoUppercase = Boolean(prefs.autoUppercase);
    state.spellcheck = prefs.spellcheck !== false;
    state.highlightActiveLine = prefs.highlightActiveLine !== false;
    state.typewriterMode = ["off", "frame", "line"].includes(prefs.typewriterMode)
      ? prefs.typewriterMode
      : prefs.typewriterScroll
        ? "line"
        : "off";
    state.typewriterScroll = state.typewriterMode !== "off";
    state.autosaveDelay = clamp(Number(prefs.autosaveDelay) || 650, 200, 10000);
    state.zoom = Number(prefs.zoom) || 1;
    state.mode = prefs.mode === "page" ? "page" : "write";
    state.font = normalizeScriptFont(prefs.font);    state.fontSize = Number(prefs.fontSize) || 12;
    state.typographyMode = prefs.typographyMode === "workspace" ? "workspace" : "document";
    state.uiScale = [1, 1.25, 1.5, 2].includes(Number(prefs.uiScale)) ? Number(prefs.uiScale) : 1;
    applyInterfaceScale();
    state.showGuides = prefs.showGuides !== false;
    state.showInvisibles = Boolean(prefs.showInvisibles);
    state.showOutline = prefs.showOutline !== false;
    state.showRuler = prefs.showRuler !== false;
    state.autosave = prefs.autosave !== false;
    state.startCenterOnLaunch = prefs.startCenter !== false;
    state.read.rate = Number(prefs.readRate) || 1;
    state.read.voiceURI = String(prefs.readVoice || "");
    state.showOutlineInScript = prefs.showOutlineInScript !== false;
    state.showStructureLines = Boolean(prefs.showStructureLines);
    state.hideScriptNotes = Boolean(prefs.hideScriptNotes);
    state.navigatorVisible = prefs.navigatorVisible !== false;
    state.textColor = prefs.textColor || "#171614";
    state.highlightColor = prefs.highlightColor || "#ffe9a3";
    state.beatConnectionColor = prefs.beatConnectionColor || "#0f6cbd";
    state.profile = prefs.profile && typeof prefs.profile === "object" ? prefs.profile : { name: "Local Writer", role: "Writer" };
    state.lastBackupAt = Number(prefs.lastBackupAt) || 0;
    /* Load the newest valid document across every spelling. A pre-rename key
     * can hold NEWER work than the current one — the app was renamed while a
     * build was still writing fdstudio.*, so someone who writes in an old build
     * and then opens this one has their latest work in the legacy key. The
     * newest savedAt therefore wins over the read order; booting an old
     * spelling must never quietly discard work. */
    const docSpellings = [DOC_KEY, LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS];
    const docCandidates = docSpellings.map((key) => {
      const value = safeParse(storageGet(key));
      return value && Array.isArray(value.paragraphs)
        ? { key, value, stamp: Date.parse(value.savedAt || value.updatedAt || "") || 0 }
        : null;
    }).filter(Boolean);
    /* Ties keep read order, so the current spelling still wins when equally new. */
    const newest = docCandidates.reduce(
      (best, candidate) => (candidate.stamp > best.stamp ? candidate : best),
      docCandidates[0] || null,
    );
    const stored = newest ? newest.value : null;
    if (stored) {
      state.doc = normalizeDocument(stored);
      state.lastSaved = isDesktop ? null : stored.savedAt || null;
      state.dirty = false;
    } else {
      state.doc = sampleDocument();
      state.dirty = false;
    }
    elementDocument = state.doc;
    state.history = new History(state.doc);
    state.savedSnapshot = cloneDocument(state.doc);
    applyTheme(state.theme, false);
    applyStudioAppearance();
    populateElementControls();
    bindEvents();
    renderAll();
    updateHistoryButtons();
    syncPrefsUI();
    applyProfile();
    if (!stored) persistWorkspace(false);
    /* Only delete another copy of the document once the current spelling
     * provably holds the winning one: either it already did, or the re-save
     * just reported success. A failed write (quota, private mode) leaves every
     * copy in place rather than destroying the last one. */
    const winnerPersisted =
      Boolean(newest) &&
      (newest.key === DOC_KEY || Boolean(persistWorkspace(false)));
    if (winnerPersisted) {
      dropRenamedKeys([LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS], DOC_KEY);
    }
    /* Same rule for preferences, which carry no timestamp: only prune once the
     * current key actually holds a readable value. */
    const migratedPrefs = Boolean(storedPrefs.key && storedPrefs.key !== PREFS_KEY);
    if (migratedPrefs) persistPrefs();
    if (safeParse(storageGet(PREFS_KEY))) {
      dropRenamedKeys([LEGACY_PREFS_KEY, ...RENAMED_PREFS_KEYS], PREFS_KEY);
    }
    requestAnimationFrame(() => {
      els.appShell.classList.remove("is-loading");
      fitPaper();
      if (state.mode === "page") setMode("page");
      else renderPagePreview();
    });
    if (!isDesktop && !stored) {
      setTimeout(
        () =>
          toast(
            "Welcome to Azkript",
            "The sample screenplay is loaded. Start typing or open an FDX file.",
            "info",
          ),
        700,
      );
    }
    workspaceUI = FDWorkspaceUI({ state, els, desktop, browserBackups, openDialog, closeDialog, toast,
      switchRibbonTab, toggleRibbonCollapsed, toggleSplitView, renderAll, fitPaper, setView, setMode, focusParagraph,
      markDirty, saveVersionSnapshot, openVersionHistory, confirmDiscard, handleFilePayload });
    productionUI = FDProductionUI({state,els,desktop,openDialog,closeDialog,toast,markDirty,renderAll,layoutOptions,
      exportPDF,runPreflight,confirmDiscard,focusParagraph,loadDocument,openTableRead:()=>openReadDock(true)});
    storyUI = FDStoryUI({state,openDialog,closeDialog,toast,markDirty,renderAll,layoutOptions,setView,setMode,focusParagraph,
      refreshPlanning:()=>{elementDocument=state.doc;syncDesktopState();updateHistoryButtons();}});
    if (isDesktop) initDesktop();
  }
  function persistPrefs() {
    storageSet(
      PREFS_KEY,
      JSON.stringify({
        theme: state.theme,
        accentColor: state.accentColor,
        paperTint: state.paperTint,
        uiDensity: state.uiDensity,
        ambientGlow: state.ambientGlow,
        reducedMotionPref: state.reducedMotionPref,
        lineSpacing: state.lineSpacing,
        smartTypeEnabled: state.smartTypeEnabled,
        autoUppercase: state.autoUppercase,
        spellcheck: state.spellcheck,
        highlightActiveLine: state.highlightActiveLine,
        typewriterScroll: state.typewriterScroll,
        typewriterMode: state.typewriterMode,
        autosaveDelay: state.autosaveDelay,
        zoom: state.zoom,
        mode: state.mode,
        font: state.font,
        fontSize: state.fontSize,
        showGuides: state.showGuides,
        showInvisibles: state.showInvisibles,
        showOutline: state.showOutline,
        showRuler: state.showRuler,
        autosave: state.autosave,
        startCenter: state.startCenterOnLaunch,
        readRate: state.read.rate,
        readVoice: state.read.voiceURI,
        showOutlineInScript: state.showOutlineInScript,
        showStructureLines: state.showStructureLines,
        hideScriptNotes: state.hideScriptNotes,
        navigatorVisible: state.navigatorVisible,
        textColor: state.textColor,
        highlightColor: state.highlightColor,
        beatConnectionColor: state.beatConnectionColor,
        profile: state.profile,
        lastBackupAt: state.lastBackupAt,
        typographyMode: state.typographyMode,
        uiScale: state.uiScale,
      }),
    );
  }
  function persistWorkspace(withRecovery = true) {
    if (withRecovery) scheduleVersionSnapshot();
    state.doc.updatedAt = new Date().toISOString();
    const savedAt = new Date().toISOString();
    const saved = { ...state.doc, savedAt };
    /* Report the write so callers can refuse to delete any other copy of the
     * document when this one did not land (quota, private mode, disabled
     * storage). The old contract silently swallowed the failure. */
    const written = storageSet(DOC_KEY, JSON.stringify(saved));
    if (withRecovery && isDesktop && state.autosave) {
      desktop
        .writeRecovery({
          title: state.doc.title,
          filePath: state.filePath,
          identity: state.fileIdentity,
          document: state.doc,
        })
        .then(() => {
          state.recoveryWrittenAt = Date.now();
          updateSaveState();
        })
        .catch(() => {});
    }
    return written ? savedAt : null;
  }
  function scheduleBackup() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.autosave) return;
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      const writtenAt = persistWorkspace();
      if (!isDesktop) {
        if (writtenAt) {
          state.savedSnapshot = cloneDocument(state.doc);
          state.dirty = false;
          state.lastSaved = Date.now();
          state.saveFailed = false;
          state.saveFailureNotified = false;
        } else {
          // The write did not land (quota, private window, storage disabled).
          // Report it instead of pretending, and keep the document dirty so the
          // unsaved-changes state stays truthful.
          reportSaveFailure();
        }
        updateSaveState();
        renderMeta();
      }
    }, clamp(Number(state.autosaveDelay) || 650, 200, 10000));
  }
  /* Tell the writer, once per failure streak, that the local copy did not save.
   * Autosave retries on the next edit, so repeating the toast every 650 ms would
   * bury the message under itself; the status chip carries the alarm for as long
   * as the condition lasts. */
  function reportSaveFailure() {
    state.saveFailed = true;
    if (state.saveFailureNotified) return;
    state.saveFailureNotified = true;
    toast(      "Not saved",      isDesktop        ? "Your draft could not be written to disk. Check that the folder is writable, then save again."
        : "This browser blocked the local save — storage may be full or disabled, or you are in a private window. Export an FDX copy to keep your work.",      "error",      9000,    );
  }
  function saveLocal(silent = false) {
    if (isDesktop) return saveDocument({ silent });
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    const writtenAt = persistWorkspace();
    if (!writtenAt) {
      /* Do NOT touch savedSnapshot/dirty/lastSaved on failure: clearing them is       * what made the status chip read "Saved" while the text was gone on the       * next load. The in-memory document is untouched, so the writer can still       * export FDX or retry once storage frees up. */
      reportSaveFailure();
      updateSaveState();
      renderMeta();
      if (!silent) {
        toast(          "Save failed",          isDesktop            ? "Your draft could not be written to disk."
            : "The browser refused to store this draft. Export an FDX copy so the work is not lost.",          "error",          9000,        );
      }
      return Promise.resolve(false);
    }
    state.saveFailed = false;
    state.saveFailureNotified = false;
    state.savedSnapshot = cloneDocument(state.doc);
    state.dirty = false;
    state.lastSaved = Date.now();
    updateSaveState();
    renderMeta();
    persistPrefs();
    if (!silent) {
      toast(
        "Saved locally",
        "Your screenplay is stored in this browser. Export FDX for a portable copy.",
        "success",
      );
    }
    return Promise.resolve(true);
  }
  function markDirty(options = {}) {
    const firstUnsavedEdit = !state.dirty;
    state.editVersion += 1;
    state.dirty = true;
    if (options.layout !== false) state.layoutDirty = true;
    updateSaveState();
    syncDesktopState(firstUnsavedEdit);
    scheduleBackup();
    /* Keep the sprint's word counter live while a sprint is running; the
     * interval alone only refreshed it once a second. */
    if (state.sprint.running) updateSprintUI();
  }
  function updateSaveState() {
    /* A failed write outranks every other state: telling the writer "Saved"
     * after a rejected write is the bug this guard exists to prevent. */    els.saveState.classList.toggle("is-error", Boolean(state.saveFailed));
    els.saveState.classList.toggle("is-dirty", state.dirty && !state.saveFailed);
    els.saveState.classList.toggle("is-saved", !state.dirty && !state.saveFailed);
    els.saveState.classList.toggle("is-busy", state.saving);
    if (state.saveFailed) {      els.saveStateText.textContent = "Not saved";    } else if (state.saving) {
      els.saveStateText.textContent = "Saving…";
    } else if (state.dirty) {
      if (isDesktop) {
        els.saveStateText.textContent = state.recoveryWrittenAt ? "Edited · recoverable" : "Unsaved";
      } else {
        els.saveStateText.textContent = "Saving…";
      }
    } else if (state.lastSaved) {
      els.saveStateText.textContent = `Saved ${formatTime(state.lastSaved)}`;
    } else if (isDesktop) {
      els.saveStateText.textContent = state.filePath ? "Saved" : "New draft";
    } else {
      els.saveStateText.textContent = "Saved locally";
    }
    if (els.statusRecovery) {
      els.statusRecovery.textContent = state.saveFailed        ? "Storage blocked"        : isDesktop
          ? state.autosave
            ? state.recoveryWrittenAt
              ? `Recovery ${formatTime(state.recoveryWrittenAt)}`
              : "Recovery on"
            : "Recovery off"
          : "Local draft";
    }
    document.body.classList.toggle("is-dirty", state.dirty);
  }
  /* ------------------------------------------------------------------ */
  /* desktop bridge                                                      */
  /* ------------------------------------------------------------------ */
  function syncDesktopState(immediate = false) {
    if (!isDesktop) return;
    const send = () =>
      desktop.updateState({
        title: state.doc.title || "Untitled Screenplay",
        dirty: state.dirty,
        filePath: state.filePath,
        theme: state.theme,
        revision: state.doc.revision ? state.doc.revision.current : 1,
      });
    clearTimeout(state.windowTimer);
    if (immediate) {
      send();
      state.windowTimer = null;
    } else {
      state.windowTimer = setTimeout(() => {
        state.windowTimer = null;
        send();
      }, 90);
    }
  }
  async function initDesktop() {
    document.body.classList.add("is-desktop");
    document.body.classList.add(desktop.platform === "win32" ? "is-win" : "is-mac");
    try {
      state.appInfo = await desktop.getInfo();
    } catch {
      state.appInfo = null;
    }
    syncDesktopState(true);
    desktop.onCommand(handleDesktopCommand);
    desktop.onRequestSave(() => saveDocument({ forClose: true }));
    if (desktop.onFileChanged) desktop.onFileChanged(change => {
      const samePath = (a, b) => desktop.platform === "win32"
        ? String(a || "").replace(/\\/g, "/").toLowerCase() === String(b || "").replace(/\\/g, "/").toLowerCase()
        : a === b;
      if (!samePath(change.path, state.filePath)) return;
      if (change.identity === state.fileIdentity) { state.externalChange = null; renderExternalChangeBanner(); return; }
      state.externalChange = change;
      renderExternalChangeBanner();
    });
    state.recovery = await desktop.readRecovery().catch(() => null);
    const timer = setTimeout(() => {
      if (state.suppressStartCenter) return;
      if (state.startCenterOnLaunch || state.recovery) showStartCenter();
    }, 600);
    state.startCenterTimer = timer;
  }
  async function handleDesktopCommand(message) {
    if (!message || !message.command) return;
    const { command, payload } = message;
    switch (command) {
      case "open-document":
        return handleOpenDocument(payload);
      case "new":
        return newDocument();
      case "open":
        return openFilePicker();
      case "save":
        return saveDocument({ forClose: Boolean(payload && payload.forClose) });
      case "save-as":
        return saveDocument({ saveAs: true });
      case "export-fdx":
        return exportFDX();
      case "export-pdf":
        return exportPDF();
      case "print":
        return printDocument();
      case "undo":
        return undo();
      case "redo":
        return redo();
      case "find":
        return openFind("find");
      case "unified-search":
        return document.getElementById('quickSearchButton')?.click();
      case "replace":
        return openFind("replace");
      case "title-page":
        return openTitlePage();
      case "page-setup":
        return openPageSetup();
      case "revision":
        return openRevisionManager();
      case "revision:toggle":
        return toggleRevisionMode();
      case "revision:next":
        return startNextRevision();
      case "scene-details":
        return openSceneDetails();
      case "scene:new":
        return insertScene();
      case "scene:previous":
      case "scene:next":
        return moveScene(command === "scene:previous" ? -1 : 1);
      case "table-read":
        return openReadDock(false);
      case "table-read:here":
        return openReadDock(true);
      case "help":
        return openHelp();
      case "documentation":
        return openUserGuide();
      case "start-center":
        return showStartCenter();
      case "focus":
        return toggleFocus();
      case "inspector":
        return toggleInspector();
      case "rail":
        return toggleRail();
      case "view":
        return setView((payload && payload.view) || "script");
      case "mode":
        return setMode((payload && payload.mode) || "write");
      case "zoom":
        if (payload && payload.reset) {
          state.zoom = 1;
          applyZoom();
          persistPrefs();
        } else {
          setZoom((payload && payload.delta) || 0.1);
        }
        return undefined;
      case "element":
        return changeElementType(payload && payload.type);
      case "format:bold":
        return formatSelection("bold");
      case "format:italic":
        return formatSelection("italic");
      case "format:underline":
        return formatSelection("underline");
      default:
        return undefined;
    }
  }
  async function confirmDiscard(message) {
    if (state.saving) {
      toast("Save in progress", "Wait for the current save to finish before changing documents.", "info");
      return false;
    }
    if (!state.dirty) return true;
    if (state.pendingDiscard) return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        state.pendingDiscard = null;
        resolve(value);
      };
      state.pendingDiscard = finish;
      const onClose = () => {
        els.dialog.removeEventListener("close", onClose);
        if (!settled) finish(false);
      };
      els.dialog.addEventListener("close", onClose);
      openDialog({
        eyebrow: "Unsaved changes",
        title: "Leave this draft behind?",
        body: `<p>${escapeHtml(message || "This draft has changes that are not saved to a file.")}</p><div class="dialog-note">Export or save the screenplay first if you want to keep this version.</div>`,
        actions: [
          {
            label: "Keep editing",
            onClick: () => {
              finish(false);
              state.pendingDiscard = null;
            },
          },
          {
            label: "Discard changes",
            kind: "danger",
            onClick: () => finish(true),
          },
        ],
      });
    });
  }
  /* ------------------------------------------------------------------ */
  /* theme, zoom, layout                                                 */
  /* ------------------------------------------------------------------ */
  function resolveTheme(theme) {
    if (theme === "midnight") return "midnight";
    if (theme !== "system") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  let themeTransition = null;
  let themeGeneration = 0;
  function toggleTheme() {
    applyTheme(resolveTheme(state.theme) === "light" ? "dark" : "light");
  }
  function applyTheme(theme, animate = true) {
    state.theme = ["light", "dark", "midnight", "system"].includes(theme) ? theme : "system";
    const generation = ++themeGeneration;
    themeTransition?.skipTransition();
    themeTransition = null;
    const resolved = resolveTheme(state.theme);
    const isDarkLike = resolved === "dark" || resolved === "midnight";
    const apply = () => {
      // A skipped transition may still run its update callback. Only the latest
      // request may change the theme, accent, labels and desktop chrome.
      if (generation !== themeGeneration) return;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="color-scheme"]').content = isDarkLike ? "dark" : "light";
      document.body.classList.toggle("theme-dark", isDarkLike);
      document.body.classList.toggle("theme-midnight", resolved === "midnight");
      const themeName = { light: "Day", dark: "Night", midnight: "Midnight" }[resolved];
      const toggleLabel = `${themeName} theme. Switch to ${isDarkLike ? "Day" : "Night"} theme`;
      els.themeToggle.setAttribute("aria-label", toggleLabel);
      els.themeToggle.dataset.tooltip = toggleLabel;
      applyStudioAppearance();
      $$(".theme-swatch").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.themeChoice === state.theme);
      });
      syncDesktopState(true);
      syncRibbon();
    };
    if (animate && !prefersReducedMotion() && document.startViewTransition && document.documentElement.dataset.theme !== resolved) {
      themeTransition = document.startViewTransition(apply);
      // Interruption is expected when the user changes themes quickly.
      themeTransition.ready.catch(() => {});
    } else {
      apply();
    }
    persistPrefs();
  }
  function applyStudioAppearance() {
    const resolved = resolveTheme(state.theme);
    const isDarkLike = resolved === "dark" || resolved === "midnight";
    const accent = ACCENT_THEMES[state.accentColor] || ACCENT_THEMES.cobalt;
    const palette = isDarkLike ? accent.dark : accent.light;
    const docStyle = document.documentElement.style;
    docStyle.setProperty("--brand", palette.brand);
    docStyle.setProperty("--brand-hover", palette.hover);
    docStyle.setProperty("--brand-pressed", palette.pressed);
    docStyle.setProperty("--brand-soft", palette.soft);
    docStyle.setProperty("--brand-soft-2", palette.soft2);
    const tintKey = PAPER_TINTS[state.paperTint] ? state.paperTint : "ivory";
    const tint = PAPER_TINTS[tintKey];
    if (resolved === "midnight" && tintKey === "ivory") {
      docStyle.setProperty("--paper", "#14161b");
      docStyle.setProperty("--paper-ink", "#e8eaed");
      docStyle.setProperty("--paper-edge", "rgba(255, 255, 255, 0.12)");
    } else if (tintKey === "ivory" && resolved === "dark") {
      docStyle.setProperty("--paper", "#f4f1ea");
      docStyle.setProperty("--paper-ink", "#181714");
      docStyle.setProperty("--paper-edge", "rgba(0, 0, 0, 0.4)");
    } else {
      docStyle.setProperty("--paper", tint.paper);
      docStyle.setProperty("--paper-ink", tint.ink);
      docStyle.setProperty("--paper-edge", tint.edge);
    }
    document.body.dataset.paperTint = tintKey;
    document.body.dataset.density = state.uiDensity || "comfortable";
    document.body.dataset.typewriter =
      state.typewriterMode || (state.typewriterScroll ? "line" : "off");
    document.body.classList.toggle("no-ambient", !state.ambientGlow);
    document.body.classList.toggle("reduce-motion", Boolean(state.reducedMotionPref));
    if (els.editor) {
      els.editor.classList.toggle("no-active-highlight", !state.highlightActiveLine);
      els.editor.spellcheck = state.spellcheck !== false;
      $$(".para", els.editor).forEach((el) => {
        el.spellcheck = state.spellcheck !== false;
      });
    }
  }
  function syncPrefsUI() {
    const fontSelect = $("#fontSelect");
    if (fontSelect) fontSelect.value = normalizeScriptFont(state.font);    const fontSize = $("#fontSize");
    if (fontSize) fontSize.value = String(state.fontSize);
    syncDocumentFontControls();
    const invisiblesToggle = $("#invisiblesToggle");
    if (invisiblesToggle) {
      invisiblesToggle.classList.toggle("is-on", state.showInvisibles);
      invisiblesToggle.setAttribute("aria-checked", String(state.showInvisibles));
    }
    const guidesToggle = $("#guidesToggle");
    if (guidesToggle) {
      guidesToggle.classList.toggle("is-on", state.showGuides);
      guidesToggle.setAttribute("aria-checked", String(state.showGuides));
    }
    if (els.sceneNumbersToggle) {
      els.sceneNumbersToggle.classList.toggle("is-on", state.doc.settings.sceneNumbers);
      els.sceneNumbersToggle.setAttribute("aria-checked", String(state.doc.settings.sceneNumbers));
    }
    if (els.readRate) els.readRate.value = String(state.read.rate);
    $$(".theme-swatch").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.themeChoice === state.theme);
    });
  }
  function applyPageMetrics() {
    const page = state.doc.page;
    const root = els.paper;
    const spacing = LINE_SPACING_OPTIONS[state.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    root.style.setProperty("--page-w", `${page.width}in`);
    root.style.setProperty("--page-h", `${page.height}in`);
    root.style.setProperty("--page-top", `${page.top}in`);
    root.style.setProperty("--page-bottom", `${page.bottom}in`);
    root.style.setProperty("--script-font", scriptFontStack(state.font));    root.style.setProperty("--script-size", `${state.fontSize}pt`);
    root.style.setProperty("--script-line-height", spacing.css);
    els.paperTitle.textContent = (state.doc.title || "Untitled Screenplay").toUpperCase();
    els.paperPage.textContent = state.doc.settings.pageNumbers !== false ? "1." : "";
    els.paperWords.textContent = `${getStats(state.doc).words} words`;
    els.pageWidth.value = page.width;
    els.pageHeight.value = page.height;
    els.pageTop.value = page.top;
    els.pageBottom.value = page.bottom;
    els.paper.classList.toggle("has-guides", state.showGuides);
    els.paper.classList.toggle("has-invisibles", state.showInvisibles);
    els.paper.classList.toggle("show-scene-numbers", state.doc.settings.sceneNumbers);
    els.paper.dataset.sceneNumberSide = state.doc.settings.sceneNumberSide || "both";
    els.editor.dataset.sceneNumberSide = state.doc.settings.sceneNumberSide || "both";
    els.editor.classList.toggle("no-active-highlight", !state.highlightActiveLine);
    $$(".page-card").forEach((card) => {
      card.style.setProperty("--script-font", scriptFontStack(state.font));      card.style.setProperty("--script-size", `${state.fontSize}pt`);
      card.style.setProperty("--script-line-height", spacing.css);
    });
  }
  function fitPaper() {
    const wasFlow = state.flow;
    state.flow = window.matchMedia("(max-width: 520px)").matches;
    if (wasFlow !== state.flow) $$(".para", els.editor).forEach(el => {
      const paragraph = state.doc.paragraphs.find(p => p.id === el.dataset.id);
      if (paragraph) applyParagraphVisuals(el, paragraph);
    });
    els.paper.classList.toggle("paper--flow", state.flow);
    if (state.flow) {
      state.fit = 1;
      applyZoom();
      return;
    }
    const container = state.mode === "page" ? els.pagePreview : els.paperScroll;
    const available = Math.max(280, (container && container.clientWidth ? container.clientWidth : 900) - 44);
    const base = state.doc.page.width * 96;
    state.fit = clamp(available / base, 0.34, 1);
    applyZoom();
  }
  function applyZoom() {
    if (state.flow) {
      els.paper.style.zoom = "1";
      els.zoomLabel.textContent = "Fit";
      els.zoomLabel.title = "Reflowed for this screen";
      return;
    }
    const effective = state.zoom * state.fit;
    els.paper.style.zoom = String(effective);
    $$(".page-card").forEach((card) => {
      card.style.zoom = String(effective);
    });
    els.zoomLabel.textContent = `${Math.round(effective * 100)}%`;
    els.zoomLabel.title = state.fit < 1 ? "Auto-fit for this window" : "Zoom";
  }
  function setZoom(delta) {
    state.zoom = clamp(Math.round((state.zoom + delta) * 10) / 10, 0.6, 1.6);
    applyZoom();
    persistPrefs();
  }
  /* ------------------------------------------------------------------ */
  /* top-level rendering                                                 */
  /* ------------------------------------------------------------------ */
  function renderAll() {
    state.doc = normalizeDocument(state.doc);
    elementDocument = state.doc;
    document.body.classList.toggle("workspace-typography", state.typographyMode === "workspace");
    if (state.doc.titlePage) {
      if (!state.doc.titlePage.title) state.doc.titlePage.title = state.doc.title;
      if (!state.doc.titlePage.author) state.doc.titlePage.author = state.doc.author;
    }
    document.title = `${state.doc.title || "Untitled Screenplay"} — Azkript`;
    els.docTitle.textContent = state.doc.title || "Untitled Screenplay";
    els.scriptTitle.textContent = state.doc.title || "Untitled Screenplay";
    els.documentPill = els.documentPill || $("#documentPill");
    if (els.documentPill) {
      els.documentPill.title = state.filePath
        ? state.filePath
        : isDesktop
          ? "Not yet saved to a file"
          : "Saved in this browser";
    }
    els.titleInput.value = state.doc.title || "";
    els.authorInput.value = state.doc.author || "";
    els.targetPagesInput.value = String(state.doc.settings.targetPages);
    els.sceneNumbersToggle.classList.toggle("is-on", state.doc.settings.sceneNumbers);
    els.sceneNumbersToggle.setAttribute("aria-checked", String(state.doc.settings.sceneNumbers));
    renderEditor();
    renderStatus();
    renderScenes();
    renderMeta();
    renderInspector();
    renderRevisionChrome();
    renderViewChrome();
    renderOutlineAndRuler();
    if (state.splitView.enabled) renderSplitPane();
    updateSaveState();
    updateHistoryButtons();
    if (state.view === "navigator") renderNavigator();
    if (state.view === "beatboard") renderBeatBoard();
    if (state.view === "characters") renderCharacters();
    if (state.mode === "page") renderPagePreview();
    seedStructureMeta();
    syncRibbon();
    syncDesktopState();
  }
  function getLayout(force = false) {
    if (force || state.layoutDirty || !state.layout) {
      if (!force && state.layout && state.doc.paragraphs.length > 600) {
        scheduleBackgroundPagination(); return state.layout;
      }
      try {
        state.layout = FDPagination.layout(state.doc, layoutOptions());
        state.layoutError = null;
      } catch (error) {
        if (state.layoutError !== error.message) toast("Pagination unavailable", "Your text is intact. Review document fonts and geometry before exporting pages.", "warning", 7000);
        state.layoutError = error.message;
        state.layout = { pages: [], scriptPageCount: 0, totalPageCount: 0,
          contentHeight: 648, lineHeight: state.fontSize, scenes: getScenes(state.doc), normalized: state.doc };
      }
      state.layoutDirty = false;
    }
    return state.layout;
  }
  function layoutOptions() {
    const spacing = LINE_SPACING_OPTIONS[state.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    return { fontSize: state.fontSize, fontFamily: state.font,
      lineHeight: Math.round(state.fontSize * spacing.multiplier * 100) / 100,
      charWidthRatio: 0.6, showMore: state.doc.settings.showMore !== false,
      useDocumentTypography: state.typographyMode === "document", measureText: measureForLayout(), measuredTypography: true };
  }
  function scheduleBackgroundPagination() {
    const signature = () => `${state.doc.documentId}:${state.editVersion}:${state.font}:${state.fontSize}:${state.lineSpacing}:${state.typographyMode}`;
    if (paginationTimer || state.paginationRunningSignature === signature()) return;
    const sequence = ++paginationSequence;
    paginationTimer = setTimeout(async () => {
      paginationTimer = null;
      const version = state.editVersion, documentId = state.doc.documentId;
      const requestedSignature = signature();
      state.paginationRunningSignature = requestedSignature;
      try {
        const result = await paginationClient.layout(state.doc, layoutOptions());
        if (sequence !== paginationSequence || requestedSignature !== signature() || documentId !== state.doc.documentId) return;
        state.layout = { ...result, normalized: state.doc };
        state.layoutDirty = false;
        renderMeta(); renderStatus();
        if (state.mode === "page") renderPagePreview();
      } catch (error) {
        if (error.code !== "PAGINATION_CANCELLED" && sequence === paginationSequence) {
          // Keep the editor responsive; explicit page/export actions recompute
          // synchronously through the same engine if workers are unavailable.
          state.paginationError = error.message;
        }
      } finally {
        if (state.paginationRunningSignature === requestedSignature) state.paginationRunningSignature = null;
        if (sequence === paginationSequence && requestedSignature !== signature() && state.layoutDirty) scheduleBackgroundPagination();
      }
    }, 120);
  }
  function pageCount() {
    return getLayout().scriptPageCount;
  }
  function scenePageMap() {
    const layout = getLayout();
    const map = new Map();
    for (const page of layout.pages) {
      if (page.kind !== "script") continue;
      for (const block of page.blocks) {
        if (block.kind === "paragraph" && block.type === "Scene Heading" && block.scene) {
          map.set(block.scene.id, page.number);
        }
      }
    }
    return map;
  }
  function renderMeta() {
    const layout = getLayout();
    const stats = getStats(state.doc);
    const pages = layout.scriptPageCount;
    if (els.documentPill) {
      els.documentPill.title = state.filePath
        ? state.filePath
        : isDesktop
          ? "Not yet saved to a file"
          : "Saved in this browser";
    }
    els.metaScenes.textContent = `${stats.scenes} ${stats.scenes === 1 ? "scene" : "scenes"}`;
    els.metaPages.textContent = `${pages} ${pages === 1 ? "page" : "pages"}`;
    const when = state.dirty
      ? "Unsaved changes"
      : state.lastSaved
        ? `Saved ${formatTime(state.lastSaved)}`
        : isDesktop && !state.filePath
          ? "New draft"
          : "Edited just now";
    els.metaEdited.textContent = when;
  }
  function renderStatus() {
    const layout = getLayout();
    const stats = getStats(state.doc);
    const pages = layout.scriptPageCount;
    state.pageCount = pages;
    els.statusWords.textContent = `${stats.words.toLocaleString()} words`;
    els.statusScenes.textContent = `${stats.scenes} ${stats.scenes === 1 ? "scene" : "scenes"}`;
    els.statusPages.textContent = state.layoutError ? "Layout unavailable" : `${pages} ${pages === 1 ? "page" : "pages"}`;
    els.statusRead.textContent = `${stats.readingMinutes} min read`;
    els.statusMode.textContent = state.mode === "page" ? "Page view" : "Screenplay";
    els.panelPages.textContent = pages;
    const target = Math.max(1, state.doc.settings.targetPages);
    els.panelProgress.style.width = `${clamp((pages / target) * 100, 4, 100)}%`;
    els.panelProgress.title = `${pages} of ${target} target pages`;
    els.panelFootNote.textContent = isDesktop
      ? "Recovery is automatic. Save to write an FDX file."
      : "Autosaved locally. Export to FDX at any time.";    els.paperPage.textContent = state.doc.settings.pageNumbers !== false ? "1." : "";
    els.paperWords.textContent = `${stats.words.toLocaleString()} words`;
    els.statusLocation.innerHTML = `${isDesktop ? "Desktop" : "Local"}${state.fileName ? ` · ${escapeHtml(state.fileName)}` : ""}`;
    const entry = revisionEntry(state.doc, state.doc.revision.current);
    els.statusRevision.textContent = `Rev ${state.doc.revision.current} · ${state.doc.revision.enabled ? "On" : "Off"}`;
    els.statusRevision.style.color = state.doc.revision.enabled ? entry.hex : "";
    renderPageDock();
  }
  function renderInsights() {
    const stats = getStats(state.doc);
    const pages = pageCount();
    const rows = [
      ["Words", stats.words.toLocaleString()],
      ["Pages", pages],
      ["Scenes", stats.scenes],
      ["Locations", stats.locations],
      ["Speaking roles", stats.characters],
      ["Revised blocks", stats.revised],
      ["Reading time", `${stats.readingMinutes} min`],
    ];
    els.insightList.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="insight-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`,
      )
      .join("");
    const target = Math.max(1, state.doc.settings.targetPages);
    const pace = clamp(Math.round((pages / target) * 100), 4, 100);
    els.paceFill.style.width = `${pace}%`;
    els.paceCopy.textContent =
      pages < Math.max(2, target * 0.25)
        ? "A short read. The story is still finding its rhythm."
        : pages > target * 0.9
          ? "A full draft. Start a revision pass for pace and clarity."
          : "A balanced read. The current draft moves cleanly.";
  }
  function renderViewChrome() {
    $$(".rail__item[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.view);
    });
    $$("#viewSegmented .segmented__item").forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$(".inspector-tab").forEach((button) => {
      const active = button.dataset.tab === state.inspectorTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    updateRailIndicator();
    syncRibbon();
    $$(".inspector-pane").forEach((pane) => {
      const show = pane.dataset.tabPanel === state.inspectorTab;
      pane.hidden = !show;
      pane.classList.toggle("is-active", show);
    });
  }
  function renderRevisionChrome() {
    const revision = state.doc.revision || { enabled: false, current: 1, history: [] };
    const entry = revisionEntry(state.doc, revision.current);
    const revised = state.doc.paragraphs.filter((paragraph) => paragraph.revision).length;
    document.body.classList.toggle("revision-on", revision.enabled);
    els.revisionSwatch.style.background = entry.hex;
    els.revisionLabel.textContent = `Rev ${revision.current}`;
    els.revisionButton.classList.toggle("is-on", revision.enabled);
    els.revisionButton.style.setProperty("--revision-color", entry.hex);
    els.revisionButton.title = revision.enabled
      ? `${entry.name} revision mode is on. ${revised} revised blocks.`
      : `${entry.name} revision. Revision mode is off.`;
    els.metaRevision.hidden = !revision.enabled && !revised;
    els.metaRevisionText.textContent = revision.enabled
      ? `${entry.name} revision · ${plural(revised, "block")} marked`
      : `${entry.name} revision · hidden`;
    els.metaRevision.style.setProperty("--revision-color", entry.hex);
    if (els.revisionMini) {
      els.revisionMini.innerHTML = `
        <div class="revision-mini__row">
          <span class="revision-mini__swatch" style="background:${entry.hex}"></span>
          <div><strong>Rev ${revision.current} · ${escapeHtml(entry.name)}</strong><span>${revised} revised block${revised === 1 ? "" : "s"} · ${revision.enabled ? "active" : "hidden"}</span></div>
          <button class="switch ${revision.enabled ? "is-on" : ""}" type="button" data-revision-toggle role="switch" aria-label="Revision mode" aria-checked="${revision.enabled}"><span></span></button>
        </div>`;
    }
    if (els.statusRevision) {
      els.statusRevision.style.color = revision.enabled ? entry.hex : "";
    }
  }
  /* ------------------------------------------------------------------ */
  /* editor                                                              */
  /* ------------------------------------------------------------------ */
  function renderEditor() {
    const fragment = document.createDocumentFragment();
    for (const block of buildParagraphBlocks(state.doc.paragraphs)) {
      fragment.appendChild(block);
    }
    els.editor.replaceChildren(fragment);
    els.editor.classList.toggle("large-script", state.doc.paragraphs.length > 600);
    if (state.pendingSelection) {
      const selection = state.pendingSelection;
      state.pendingSelection = null;
      FDCoreWriting.restoreSelection(els.editor, selection);
    }
    applyPageMetrics();
    decorateEditor();
    applyFindHighlights();
    syncFormatButtons();
  }
  function buildParagraphBlocks(paragraphs) {
    const blocks = [];
    let index = 0;
    while (index < paragraphs.length) {
      const paragraph = paragraphs[index];
      if (paragraph.dualGroup) {
        const group = [];
        while (
          index < paragraphs.length &&
          paragraphs[index].dualGroup === paragraph.dualGroup
        ) {
          group.push(paragraphs[index]);
          index += 1;
        }
        blocks.push(createDualBlock(group));
      } else {
        blocks.push(createParagraphElement(paragraph));
        index += 1;
      }
    }
    return blocks;
  }
  function splitDualColumns(group) {
    const columns = [];
    let current = [];
    for (const paragraph of group) {
      if (paragraph.type === "Character" && current.length) {
        columns.push(current);
        current = [];
      }
      current.push(paragraph);
    }
    if (current.length) columns.push(current);
    return columns;
  }
  function createDualBlock(group) {
    const block = document.createElement("div");
    block.className = "dual-block";
    block.dataset.dualGroup = group[0].dualGroup;
    const geometry = FDPagination.dualGeometry(state.doc, layoutOptions());
    block.style.width = `${geometry.widthInches}in`;
    block.style.marginLeft = `${geometry.leftInches}in`;
    const columns = splitDualColumns(group);
    for (const column of columns.slice(0, 2)) {
      const cell = document.createElement("div");
      cell.className = "dual-col";
      for (const paragraph of column) {
        cell.appendChild(createParagraphElement(paragraph));
      }
      block.appendChild(cell);
    }
    return block;
  }
  function createParagraphElement(paragraph) {
    const el = document.createElement("div");
    el.className = `para type-${slug(paragraph.type)}`;
    if (paragraph.dualGroup) {
      el.classList.add("is-dual");
      el.dataset.dualSide = String(paragraph.dualSide ?? 0);
      el.dataset.dualGroup = paragraph.dualGroup;
    }
    el.dataset.id = paragraph.id;
    el.dataset.type = paragraph.type;
    el.dataset.placeholder = elementSpec(paragraph.type).placeholder;
    el.contentEditable = "true";
    el.spellcheck = state.spellcheck !== false;
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-label", `${paragraph.type} paragraph`);
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("dir", "auto");
    el.innerHTML = paragraph.html || "";
    el.addEventListener("focus", () => setActiveParagraph(paragraph.id));
    el.addEventListener("click", () => setActiveParagraph(paragraph.id));
    applyRevisionToElement(el, paragraph);
    return el;
  }
  function decorateEditor() {
    const scenes = getScenes(state.doc);
    const paragraphNodes = new Map($$('.para[data-id]',els.editor).map(el=>[el.dataset.id,el]));
    const byIndex = new Map();
    scenes.forEach((scene) => {
      for (let index = scene.startIndex; index < scene.endIndex; index += 1) {
        byIndex.set(index, scene);
      }
    });
    const bookmarksByPara = new Map(
      (state.doc.bookmarks || []).map((bm) => [bm.paragraphId, bm]),
    );
    const highlights = state.doc.characterHighlights || {};
    let currentSpeaker = "";
    state.doc.paragraphs.forEach((paragraph, index) => {
      const el = paragraphNodes.get(paragraph.id);
      if (!el) return;
      if (paragraph.type === "Character") {
        currentSpeaker = paragraphText(paragraph).replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
      } else if (paragraph.type === "Scene Heading" || paragraph.type === "Action" || paragraph.type === "Transition") {
        currentSpeaker = "";
      }
      const scene = byIndex.get(index) || null;
      el.classList.toggle("is-omitted", Boolean(scene && scene.omit));
      el.classList.toggle("has-note", Boolean(paragraph.note && String(paragraph.note).trim()));
      if (paragraph.note && String(paragraph.note).trim()) {
        el.dataset.note = String(paragraph.note).trim();
      } else {
        delete el.dataset.note;
      }
      const bm = bookmarksByPara.get(paragraph.id);
      el.classList.toggle("has-bookmark", Boolean(bm));
      if (bm) el.dataset.bookmark = bm.name;
      else delete el.dataset.bookmark;
      const hasAlts = state.showAlts && Array.isArray(paragraph.alts) && paragraph.alts.length > 0;
      el.classList.toggle("has-alts", hasAlts);
      if (hasAlts) {
        el.dataset.altCount = `${(paragraph.activeAlt || 0) + 1}/${paragraph.alts.length + 1} Alts`;
      } else {
        delete el.dataset.altCount;
      }
      const hasTags = Array.isArray(paragraph.tags) && paragraph.tags.length > 0;
      el.classList.toggle("has-tags", hasTags);
      if (hasTags) {
        el.dataset.tagsSummary = paragraph.tags.map((t) => t.label).join(" · ");
      } else {
        delete el.dataset.tagsSummary;
      }
      const hlColor =
        (paragraph.type === "Character" || paragraph.type === "Dialogue" || paragraph.type === "Parenthetical") &&
        currentSpeaker &&
        highlights[currentSpeaker];
      el.classList.toggle("is-char-highlighted", Boolean(hlColor));
      if (hlColor) el.style.setProperty("--char-hl", hlColor);
      else el.style.removeProperty("--char-hl");
      el.classList.toggle("has-page-break", Boolean(paragraph.pageBreakBefore));
      el.classList.toggle("has-track-change", Boolean(state.trackChanges && paragraph.changeType));
      const imageInfo = paragraph.image;
      if (imageInfo) {
        el.classList.add("has-image");
        el.dataset.imageCaption =
          typeof imageInfo === "object" ? imageInfo.caption || "Reference image" : String(imageInfo);
      } else {
        el.classList.remove("has-image");
        delete el.dataset.imageCaption;
      }
      applyParagraphVisuals(el, paragraph);
      if (scene && paragraph.type === "Scene Heading") {
        el.dataset.sceneNumber = scene.number;
        el.dataset.sceneIndex = String(scene.index);
      } else {
        delete el.dataset.sceneNumber;
        delete el.dataset.sceneIndex;
      }
      applyRevisionToElement(el, paragraph);
    });
    els.editor.classList.toggle("show-scene-numbers", state.doc.settings.sceneNumbers);
    els.editor.classList.toggle("tags-mode-on", Boolean(state.tagsMode));
    els.editor.classList.toggle("speed-view-on", state.mode === "speed");
    els.editor.dataset.sceneNumberSide = state.doc.settings.sceneNumberSide || "both";
    if (els.paper) {
      const wm = state.doc.watermark || {};
      els.paper.classList.toggle("has-watermark", Boolean(wm.enabled && wm.text));
      if (wm.enabled && wm.text) {
        els.paper.dataset.watermark = wm.text;
        els.paper.style.setProperty("--wm-opacity", String((Number(wm.opacity) || 14) / 100));
      } else {
        delete els.paper.dataset.watermark;
      }
    }
  }
  function applyRevisionToElement(el, paragraph) {
    if (!el) return;
    const revision = paragraph && paragraph.revision ? revisionEntry(state.doc, paragraph.revision) : null;
    el.classList.toggle("has-revision", Boolean(revision));
    if (revision) {
      el.style.setProperty("--revision-color", revision.hex);
      el.dataset.revision = String(paragraph.revision);
      el.title = `${revision.name} revision`;
    } else {
      el.style.removeProperty("--revision-color");
      delete el.dataset.revision;
      el.removeAttribute("title");
    }
  }
  function markCurrentRevision(paragraph) {
    if (!paragraph || !state.doc.revision || !state.doc.revision.enabled) return;
    markRevision(state.doc, paragraph);
    applyRevisionToElement(paragraphElement(paragraph.id), paragraph);
    renderRevisionChrome();
  }
  function paragraphElement(id) {
    return id ? $(`.para[data-id="${escapeSelector(id)}"]`, els.editor) : null;
  }
  function activeParagraphElement() {
    const selection = window.getSelection();
    let node = selection && selection.anchorNode;
    while (node && node !== els.editor) {
      if (node.nodeType === 1 && node.classList && node.classList.contains("para")) return node;
      node = node.parentNode;
    }
    return paragraphElement(state.selectedId) || $(".para", els.editor);
  }
  function activeParagraph() {
    const el = activeParagraphElement();
    return el ? state.doc.paragraphs.find((paragraph) => paragraph.id === el.dataset.id) : null;
  }
  function setActiveParagraph(id) {
    if (state.selectedId === id) {
      syncInspectorForParagraph(id);
      return;
    }
    clearTimeout(state.ribbonSyncTimer);
    state.ribbonSyncTimer = setTimeout(() => {
      state.ribbonSyncTimer = null;
      syncRibbon();
    }, 90);
    state.selectedId = id;
    $$(".para.is-active", els.editor).forEach((el) => el.classList.remove("is-active"));
    const el = paragraphElement(id);
    if (el) el.classList.add("is-active");
    syncInspectorForParagraph(id);
    syncFormatButtons();
  }
  function syncInspectorForParagraph(id) {
    const paragraph = state.doc.paragraphs.find((item) => item.id === id);
    if (!paragraph) return;
    const spec = elementSpec(paragraph.type);
    syncDocumentFontControls();
    els.elementName.textContent = spec.label;
    els.elementHint.textContent = `Return goes to ${nextType(paragraph.type)}`;
    els.elementSwatch.style.background =
      PALETTE[Math.max(0, state.doc.paragraphs.indexOf(paragraph)) % PALETTE.length];
    els.elementSelect.value = paragraph.type;
    $$(".element-choice", els.elementChoices).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.type === paragraph.type);
    });
    if (els.dualDialogueButton) {
      els.dualDialogueButton.classList.toggle("is-active", Boolean(paragraph.dualGroup));
    }
    if (els.scriptNoteButton) {
      els.scriptNoteButton.classList.toggle("is-active", Boolean(paragraph.note && String(paragraph.note).trim()));
    }
    renderGeometry(spec);
    updateRulerMarkers(spec);
    if (state.inspectorTab === "scene") renderSceneInspector();
  }
  function renderGeometry(spec) {
    const rows = [
      ["Left", `${spec.left.toFixed(2)} in`],
      ["Right", `${spec.right.toFixed(2)} in`],
      ["First", `${spec.first.toFixed(2)} in`],
      ["Before", `${spec.before} pt`],
    ];
    els.geometryGrid.innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="geometry-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
  }
  function syncParagraphElement(el) {
    const paragraph = state.doc.paragraphs.find((item) => item.id === el.dataset.id);
    if (!paragraph) return null;
    paragraph.html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    paragraph.type = el.dataset.type;
    if (paragraph.type === "Scene Heading") {
      if (!paragraph.scene) {
        paragraph.scene = {
          synopsis: "",
          notes: "",
          color: "",
          omit: false,
          number: "",
        };
      }
    } else {
      delete paragraph.scene;
    }
    return paragraph;
  }
  function applySmartTypography(el) {
    if (!state.doc.settings.smartQuotes) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== 3 || !el.contains(node)) return;
    const text = node.nodeValue || "";
    const offset = range.startOffset;
    if (offset >= 3 && text.slice(offset - 3, offset) === "...") {
      node.nodeValue = text.slice(0, offset - 3) + "…" + text.slice(offset);
      range.setStart(node, offset - 2);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (offset >= 2 && text.slice(offset - 2, offset) === "--") {
      node.nodeValue = text.slice(0, offset - 2) + "—" + text.slice(offset);
      range.setStart(node, offset - 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function maybeAutoUppercase(el) {
    if (!state.autoUppercase || !el) return false;
    if (!["Scene Heading", "Character", "Transition", "Shot"].includes(el.dataset.type)) {
      return false;
    }
    const runs = FDX.htmlToRuns(el.innerHTML);
    if (!runs.length) return false;
    let changed = false;
    const upperRuns = runs.map((run) => {
      const upper = run.text.toUpperCase();
      if (upper !== run.text) changed = true;
      return { ...run, text: upper };
    });
    if (changed) {
      el.innerHTML = FDX.runsToHtml(upperRuns);
      syncParagraphElement(el);
    }
    return changed;
  }
  function onEditorInput(event) {
    const el = event.target.closest(".para");
    if (!el) return;
    // Rewriting the DOM during IME composition interrupts the candidate text.
    if (!event.isComposing && !state.composing) applySmartTypography(el);
    const paragraph = syncParagraphElement(el);
    if (state.trackChanges && paragraph) {
      if (!state.trackedBaseline) state.trackedBaseline = {};
      if (state.trackedBaseline[paragraph.id] === undefined) {
        state.trackedBaseline[paragraph.id] = paragraph.html;
      }
      if (!paragraph.changeType) {
        paragraph.changeType = "edit";
        paragraph.trackedOriginal =
          typeof state.trackedBaseline[paragraph.id] === "string"
            ? state.trackedBaseline[paragraph.id]
            : paragraph.html;
      }
      el.classList.add("has-track-change");
    }
    markCurrentRevision(paragraph);
    markDirty();
    state.history.schedule();
    scheduleChrome();
    updateSaveState();
    if (!event.isComposing && !state.composing) updateSmartType(el, paragraph);
    if (state.typewriterScroll && state.mode === "write") {
      scrollParagraphIntoView(el, "center", true);
    }
  }
  function smartSuggestions(paragraph) {
    const text = paragraphText(paragraph);
    if (paragraph.type === "Character") {
      const cue = text.replace(/\s*\([^)]*\)?\s*$/, "").trim().toUpperCase();
      if (!cue || cue.includes(")")) return [];
      const names = new Set(
        getCharacters(state.doc)
          .map((character) => character.name)
          .filter((name) => name !== cue && name.startsWith(cue)),
      );
      return Array.from(names)
        .slice(0, 7)
        .map((name) => ({ value: name, label: name, meta: "Character" }));
    }
    if (paragraph.type === "Scene Heading") {
      const upper = text.toUpperCase();
      if (/[-–—]\s*$/.test(upper)) {
        const base = upper.replace(/[-–—]\s*$/, "").replace(/\s+$/, "");
        return ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MORNING", "EVENING", "DAWN", "DUSK"].map(
          (time) => ({
            value: `${base} - ${time}`,
            label: time,
            meta: "Time of day",
          }),
        );
      }
      if (/^(INT\.?|EXT\.?|I\/E\.?)\s+/.test(upper) && !/\s[-–—]\s/.test(upper)) {
        const prefix = upper.match(/^(INT\.?|EXT\.?|I\/E\.?)\s+/)[0];
        const locations = Array.from(
          new Set(
            getScenes(state.doc)
              .map((scene) => scene.location)
              .filter(
                (location) =>
                  location &&
                  location !== "Unknown" &&
                  `${prefix}${location}`.startsWith(upper.replace(/\s+/g, " ").trim()),
              ),
          ),
        ).slice(0, 5);
        return locations.map((location) => ({
          value: `${prefix}${location} - DAY`,
          label: location,
          meta: "Location",
        }));
      }
      return [];
    }
    if (paragraph.type === "Transition") {
      const prefix = text.trim().toUpperCase();
      if (!prefix) return [];
      return ["CUT TO:", "SMASH CUT TO:", "FADE OUT.", "FADE TO BLACK.", "DISSOLVE TO:"]
        .filter((value) => value.startsWith(prefix) && value !== prefix)
        .slice(0, 6)
        .map((value) => ({ value, label: value, meta: "Transition" }));
    }
    return [];
  }
  function hideSmartType() {
    const owner = state.smart.elementId && paragraphElement(state.smart.elementId);
    if (owner) {
      owner.removeAttribute("aria-activedescendant");
      owner.removeAttribute("aria-controls");
      owner.removeAttribute("aria-autocomplete");
    }
    state.smart.visible = false;
    state.smart.items = [];
    state.smart.elementId = null;
    if (els.smartType && !els.smartType.hidden) {
      els.smartType.classList.remove("is-visible");
      els.smartType.classList.add("is-closing");
      setTimeout(() => {
        if (!state.smart.visible) {
          els.smartType.hidden = true;
          els.smartType.classList.remove("is-closing");
        }
      }, 120);
    }
  }
  function updateSmartType(el, paragraph) {
    if (!el || !paragraph || !state.smartTypeEnabled) {
      hideSmartType();
      return;
    }
    if (!["Character", "Scene Heading", "Transition"].includes(paragraph.type)) {
      hideSmartType();
      return;
    }
    const items = smartSuggestions(paragraph);
    if (!items.length) {
      hideSmartType();
      return;
    }
    state.smart.visible = true;
    state.smart.items = items;
    state.smart.index = 0;
    state.smart.elementId = el.dataset.id;
    state.smart.mode = paragraph.type;
    els.smartType.innerHTML = items
      .map(
        (item, index) =>
          `<button type="button" id="smartType-option-${index}" class="smart-type__item${index === 0 ? " is-active" : ""}" data-smart-index="${index}" role="option" aria-selected="${index === 0}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.meta)}</small></button>`,
      )
      .join("");
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-controls", "smartType");
    el.setAttribute("aria-activedescendant", "smartType-option-0");
    els.smartType.classList.remove("is-closing");
    els.smartType.hidden = false;
    els.smartType.classList.add("is-visible");
    $$(".smart-type__item", els.smartType).forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        acceptSmartType(Number(button.dataset.smartIndex));
      });
    });
    const selection = window.getSelection();
    let rect = null;
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        const rects = range.getClientRects();
        if (rects.length) rect = rects[0];
      }
    }
    if (!rect || (!rect.width && !rect.height)) rect = el.getBoundingClientRect();
    const width = 260;
    const height = Math.min(290, items.length * 36 + 10);
    const left = clamp(rect.left, 12, window.innerWidth - width - 12);
    const top =
      rect.bottom + height + 14 < window.innerHeight
        ? rect.bottom + 7
        : Math.max(12, rect.top - height - 7);
    els.smartType.style.left = `${left}px`;
    els.smartType.style.top = `${top}px`;
    els.smartType.style.width = `${width}px`;
  }
  function moveSmartType(delta) {
    if (!state.smart.visible) return;
    state.smart.index = clamp(
      state.smart.index + delta,
      0,
      Math.max(0, state.smart.items.length - 1),
    );
    $$(".smart-type__item", els.smartType).forEach((item, index) => {
      item.classList.toggle("is-active", index === state.smart.index);
      item.setAttribute("aria-selected", String(index === state.smart.index));
    });
    const owner = paragraphElement(state.smart.elementId);
    if (owner) owner.setAttribute("aria-activedescendant", `smartType-option-${state.smart.index}`);
  }
  function acceptSmartType(index = state.smart.index) {
    if (!state.smart.visible) return;
    const item = state.smart.items[index];
    const el = paragraphElement(state.smart.elementId);
    if (!item || !el) {
      hideSmartType();
      return;
    }
    el.textContent = item.value;
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    markDirty();
    state.history.record();
    hideSmartType();
    placeCaret(el, "end");
    scheduleChrome();
  }
  function scheduleChrome() {
    clearTimeout(state.sceneTimer);
    state.sceneTimer = setTimeout(() => {
      state.sceneTimer = null;
      renderScenes();
      seedStructureMeta();
      renderOutlineAndRuler();
      if (state.splitView.enabled) renderSplitPane();
      renderMeta();
      renderStatus();
      renderRevisionChrome();
      syncRibbon();
      if (state.view === "reports") renderReports();
    }, 220);
  }
  function onEditorFocusIn(event) {
    const el = event.target.closest(".para");
    if (!el) return;
    if (state.smart.visible && state.smart.elementId !== el.dataset.id) hideSmartType();
    setActiveParagraph(el.dataset.id);
    if (state.trackChanges) {
      const paragraph = state.doc.paragraphs.find((entry) => entry.id === el.dataset.id);
      if (paragraph) {
        if (!state.trackedBaseline) state.trackedBaseline = {};
        if (state.trackedBaseline[paragraph.id] === undefined) {
          state.trackedBaseline[paragraph.id] = paragraph.html;
        }
      }
    }
  }
  function commitStructuralEdit(result) {
    state.history.finishBurst();
    state.doc = result.doc;
    const caret = { start: result.caret, end: result.caret };
    state.pendingSelection = caret;
    state.selectedId = result.caret.id;
    markDirty();
    state.history.record();
    state.history.selectionCurrent = caret;
    hideSmartType();
    renderAll();
  }
  function onEditorBeforeInput(event) {
    const snapshot = FDCoreWriting.captureSelection(els.editor);
    if (snapshot && state.history) state.history.selectionCurrent = snapshot;
    if (event.isComposing || state.composing) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault(); event.inputType === "historyUndo" ? undo() : redo(); return;
    }
    if (!snapshot || snapshot.start.id === snapshot.end.id) return;
    if (event.inputType.startsWith("delete") || (event.inputType === "insertText" && event.data !== null) || event.inputType === "insertParagraph") {
      event.preventDefault();
      commitStructuralEdit(FDCoreWriting.replaceSelection(state.doc, snapshot,
        event.inputType === "insertParagraph" ? "\n" : event.inputType.startsWith("delete") ? "" : event.data));
    }
  }
  function onEditorKeyDown(event) {
    if (event.isComposing || state.composing || event.keyCode === 229) return;
    const el = event.target.closest(".para");
    if (!el) return;
    const snapshot = FDCoreWriting.captureSelection(els.editor);
    if (state.history && snapshot) state.history.selectionCurrent = snapshot;
    if (snapshot && snapshot.start.id !== snapshot.end.id && ["Enter", "Backspace", "Delete"].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      commitStructuralEdit(FDCoreWriting.replaceSelection(state.doc, snapshot, event.key === "Enter" ? "\n" : ""));
      return;
    }
    if (snapshot && snapshot.start.id === snapshot.end.id && snapshot.start.offset === snapshot.end.offset) {
      const paragraph = activeParagraph();
      const index = paragraph ? state.doc.paragraphs.indexOf(paragraph) : -1;
      const length = paragraph ? paragraphText(paragraph).length : 0;
      if ((event.key === "Delete" && snapshot.start.offset === length && index < state.doc.paragraphs.length - 1) ||
          (event.key === "Backspace" && snapshot.start.offset === 0 && index > 0)) {
        event.preventDefault();
        commitStructuralEdit(FDCoreWriting.deleteAdjacent(state.doc, snapshot.start, event.key === "Delete" ? 1 : -1));
        return;
      }
      if (!event.shiftKey && ((event.key === "ArrowRight" && snapshot.start.offset === length) || (event.key === "ArrowLeft" && snapshot.start.offset === 0))) {
        const next = state.doc.paragraphs[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) { event.preventDefault(); focusParagraph(next.id, event.key === "ArrowRight" ? "start" : "end"); return; }
      }
    }
    if (state.smart.visible) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSmartType(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSmartType(-1);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        acceptSmartType();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideSmartType();
        return;
      }
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        hideSmartType();
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const next = tabType(el.dataset.type, event.shiftKey);
      changeElementType(next);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      /* Modifiers must be excluded here. Ctrl+Enter is the global "new scene"
       * shortcut (handled in onGlobalKeyDown); without this guard the editor split
       * the paragraph at the caret AND the global handler inserted a scene, so one
       * keystroke did two unrelated things. Shift+Enter is the soft line break and
       * is handled by the branch below. */
      event.preventDefault();
      state.history.finishBurst();
      splitParagraph(el);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      const paragraph = syncParagraphElement(el);
      markCurrentRevision(paragraph);
      markDirty();
      state.history.schedule();
      scheduleChrome();
      return;
    }
    if (event.key === "Backspace") {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const before = range.cloneRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      if (before.toString().length !== 0) return;
      event.preventDefault();
      mergeWithPrevious(el);
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      const selection = window.getSelection();
      if (!selection || !selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const after = range.cloneRange();
      after.selectNodeContents(el);
      after.setStart(range.endContainer, range.endOffset);
      if (after.toString().length !== 0) return;
      const next = el.nextElementSibling;
      if (next && next.classList.contains("para")) {
        event.preventDefault();
        focusParagraph(next.dataset.id, "start");
      }
    }
  }
  function splitParagraph(el) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return;
    if (!range.collapsed) range.deleteContents();
    const after = range.cloneRange();
    after.selectNodeContents(el);
    after.setStart(range.endContainer, range.endOffset);
    const fragment = after.extractContents();
    const temp = document.createElement("div");
    temp.appendChild(fragment);
    const newHtml = temp.innerHTML === "<br>" ? "" : temp.innerHTML;
    el.innerHTML = el.innerHTML === "<br>" ? "" : el.innerHTML;
    maybeAutoUppercase(el);
    syncParagraphElement(el);
    const newParagraph = makeParagraph(nextType(el.dataset.type), "");
    newParagraph.html = newHtml;
    const currentParagraph = state.doc.paragraphs.find((paragraph) => paragraph.id === el.dataset.id);
    newParagraph.dualGroup = currentParagraph ? currentParagraph.dualGroup : null;
    newParagraph.dualSide = currentParagraph ? currentParagraph.dualSide ?? null : null;
    if (state.doc.revision.enabled) markRevision(state.doc, newParagraph);
    const newEl = createParagraphElement(newParagraph);
    el.insertAdjacentElement("afterend", newEl);
    const index = state.doc.paragraphs.findIndex((paragraph) => paragraph.id === el.dataset.id);
    state.doc.paragraphs.splice(index + 1, 0, newParagraph);
    markDirty();
    state.history.record();
    decorateEditor();
    scheduleChrome();
    newEl.focus({ preventScroll: true });
    placeCaret(newEl, "start");
    scrollIntoViewIfNeeded(newEl);
  }
  function mergeWithPrevious(el) {
    const previous = el.previousElementSibling;
    if (!previous || !previous.classList.contains("para")) return;
    const currentText = stripHtml(el.innerHTML).trim();
    if (!currentText) {
      el.remove();
      state.doc.paragraphs = state.doc.paragraphs.filter(
        (paragraph) => paragraph.id !== el.dataset.id,
      );
      focusParagraph(previous.dataset.id, "end");
    } else {
      previous.innerHTML += el.innerHTML;
      el.remove();
      state.doc.paragraphs = state.doc.paragraphs.filter(
        (paragraph) => paragraph.id !== el.dataset.id,
      );
      const paragraph = syncParagraphElement(previous);
      markCurrentRevision(paragraph);
      focusParagraph(previous.dataset.id, "end");
    }
    markDirty();
    state.history.record();
    decorateEditor();
    scheduleChrome();
  }
  function changeElementType(type) {
    const el = activeParagraphElement();
    if (!el) return;
    if (!ELEMENTS[type]) return;
    const wasActive = state.selectedId === el.dataset.id;
    el.dataset.type = type;
    el.setAttribute("aria-label", `${type} paragraph`);
    el.dataset.placeholder = elementSpec(type).placeholder;
    Array.from(el.classList)
      .filter((className) => className.startsWith("type-"))
      .forEach((className) => el.classList.remove(className));
    el.classList.add(`type-${slug(type)}`);
    el.classList.toggle("is-active", wasActive);
    const paragraph = state.doc.paragraphs.find((item) => item.id === el.dataset.id);
    if (paragraph) {
      paragraph.type = type;
      if (type === "Scene Heading") {
        if (!paragraph.scene) {
          paragraph.scene = { synopsis: "", notes: "", color: "", omit: false, number: "" };
        }
      } else {
        delete paragraph.scene;
      }
      markCurrentRevision(paragraph);
    }
    setActiveParagraph(el.dataset.id);
    markDirty();
    state.history.record();
    decorateEditor();
    scheduleChrome();
    el.focus({ preventScroll: true });
  }
  function resetShellScroll() {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.documentElement && document.documentElement.scrollTop) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body && document.body.scrollTop) {
      document.body.scrollTop = 0;
    }
    [
      els.appShell,
      els.workspace,
      $("#main"),
      $("#viewStack"),
      $("#scriptView"),
      els.editorStage,
    ].forEach((node) => {
      if (node && node.scrollTop) node.scrollTop = 0;
      if (node && node.scrollLeft) node.scrollLeft = 0;
    });
  }
  function scrollParagraphIntoView(el, mode = "center", smooth = true) {
    if (!el || !els.paperScroll) return;
    resetShellScroll();
    const container = els.paperScroll;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (!cRect.height) return;
    let delta = 0;
    if (mode === "nearest") {
      const pad = 44;
      if (eRect.top < cRect.top + pad) {
        delta = eRect.top - (cRect.top + pad);
      } else if (eRect.bottom > cRect.bottom - pad) {
        delta = eRect.bottom - (cRect.bottom - pad);
      } else {
        return;
      }
    } else {
      /* 0.38 of the viewport, shared with `sceneAnchorOffset()` (see
       * updateActiveSceneFromScroll). These two MUST agree: the scroll puts the heading
       * at this fraction and the scroll handler decides which scene is active by
       * comparing headings against the same fraction. They were 0.38 here and a
       * hard-coded 190px there, which made a click land one scene early on any tall
       * viewport. Expressed as a shared constant so the two cannot drift again. */
      const targetCenter = cRect.top + cRect.height * SCENE_ANCHOR_FRACTION;
      const elCenter = eRect.top + eRect.height / 2;
      delta = elCenter - targetCenter;
    }
    const nextTop = Math.max(0, container.scrollTop + delta);
    const useSmooth = smooth && !prefersReducedMotion();
    container.scrollTo({
      top: nextTop,
      behavior: useSmooth ? "smooth" : "auto",
    });
    /* When the requested scroll is clamped — the target is near the start or the end of
     * the document and there is not enough content to move it as far as asked — the
     * element cannot reach the anchor line. The last scene of a script with a short tail
     * is the common case: it sits 264px below the top because the scroll ran out, not
     * because anything misfired.
     *
     * The tracker must know: it decides "which scene am I on" by comparing headings to
     * the anchor line, so a clamped position would leave the PREVIOUS scene as the active
     * one and the highlight would appear to jump backwards even though navigation went
     * to the right place. Recording the scene the caller explicitly navigated to lets
     * the tracker prefer that intent over the clamped geometry. It is cleared on the
     * next user-initiated scroll, so free scrolling goes back to the geometric answer. */
    if (mode === "center" && el.classList.contains("type-scene-heading")) {
      /* `scene.id` IS the id of the scene-heading paragraph (see getScenes in
       * app/js/model.js), and every `.para` carries `data-id`. So the element's own
       * `data-id` is the scene id — no lookup table needed. */
      state.navigatedSceneId = el.dataset.id || null;
      /* Hold that intent for the WHOLE programmatic scroll, not one frame.
       *
       * A smooth scroll fires ~45 scroll events on the way to the target. The tracker
       * re-derives the scene from geometry on each one, so during the flight it reports
       * the scenes being passed through: click scene 8 and the navigator flashes 6, 7,
       * then 8. The correct value is written first by goToScene, then overwritten, then
       * restored — a visible flicker even though the end state is right.
       *
       * While a navigation is in flight the tracker now trusts the recorded target and
       * only resumes deriving once the scroll has settled. `scrollend` is the precise
       * signal; the scrollTop comparison and the timeout are fallbacks for engines that
       * batch or skip it (Chromium fires it, but a clamped scroll may not move at all). */
      state.navigationTarget = nextTop;
      state.navigationInFlight = true;
      if (state.navigationSettleTimer) clearTimeout(state.navigationSettleTimer);
      state.navigationSettleTimer = setTimeout(() => {
        state.navigationInFlight = false;
        state.navigationSettleTimer = null;
      }, 700);
    }
    resetShellScroll();
  }
  function placeCaret(el, position) {
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(position !== "end");
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function focusParagraph(id, position) {
    const el = paragraphElement(id);
    if (!el) return;
    placeCaret(el, position);
    setActiveParagraph(id);
    scrollIntoViewIfNeeded(el);
  }
  function scrollIntoViewIfNeeded(el) {
    scrollParagraphIntoView(el, "nearest", true);
  }
  function onPaste(event) {
    const el = event.target.closest(".para");
    if (!el) return;
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text/plain");
    if (!text) return;
    const selectedBlocks = FDCoreWriting.captureSelection(els.editor);
    if (selectedBlocks && selectedBlocks.start.id !== selectedBlocks.end.id) {
      commitStructuralEdit(FDCoreWriting.replaceSelection(state.doc, selectedBlocks, text)); return;
    }
    const parts = text.replace(/\r\n?/g, "\n").split("\n");
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
    let suffix = "";
    if (parts.length > 1) {
      range.deleteContents();
      const after = range.cloneRange();
      after.selectNodeContents(el);
      after.setStart(range.endContainer, range.endOffset);
      const holder = document.createElement("div");
      holder.appendChild(after.extractContents());
      suffix = holder.innerHTML;
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand("insertText", false, parts[0]);
    let last = el;
    for (const part of parts.slice(1)) {
      const paragraph = makeParagraph(nextType(last.dataset.type), part);
      const previous = state.doc.paragraphs.find(item => item.id === last.dataset.id);
      paragraph.dualGroup = previous ? previous.dualGroup : null;
      paragraph.dualSide = previous ? previous.dualSide : null;
      if (state.doc.revision.enabled) markRevision(state.doc, paragraph);
      const newEl = createParagraphElement(paragraph);
      last.insertAdjacentElement("afterend", newEl);
      const index = state.doc.paragraphs.findIndex((item) => item.id === last.dataset.id);
      state.doc.paragraphs.splice(index + 1, 0, paragraph);
      last = newEl;
    }
    if (last !== el && suffix) {
      last.insertAdjacentHTML("beforeend", suffix);
      syncParagraphElement(last);
    }
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    markDirty();
    state.history.schedule();
    decorateEditor();
    scheduleChrome();
    if (last !== el) {
      focusParagraph(last.dataset.id, "end");
      const caret = rangeForOffsets(last, parts[parts.length - 1].length, parts[parts.length - 1].length);
      if (caret) { selection.removeAllRanges(); selection.addRange(caret); }
    }
  }
  function formatSelection(command) {
    const focused = document.activeElement;
    if (!focused || !focused.closest || !focused.closest(".para")) {
      toast(
        "Select script text first",
        "Place the caret in a paragraph, then apply formatting.",
        "info",
        2200,
      );
      return;
    }
    const el = focused.closest(".para");
    el.focus({ preventScroll: true });
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, null);
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    syncFormatButtons();
    markDirty();
    state.history.schedule();
    scheduleChrome();
  }
  function syncFormatButtons() {
    const focused =
      document.activeElement &&
      document.activeElement.closest &&
      document.activeElement.closest(".para");
    if (!focused) return;
    try {
      $$(".format-btn").forEach((button) => {
        button.classList.toggle("is-active", document.queryCommandState(button.dataset.format));
      });
    } catch {
      /* queryCommandState is best-effort */
    }
  }
  function insertScene() {
    const active = activeParagraph();
    let insertIndex = state.doc.paragraphs.length;
    if (active) {
      const scenes = getScenes(state.doc);
      const index = state.doc.paragraphs.findIndex((paragraph) => paragraph.id === active.id);
      const scene = scenes.find((item) => item.startIndex <= index && index < item.endIndex);
      insertIndex = scene ? scene.endIndex : index + 1;
    }
    const newHeading = makeParagraph("Scene Heading", "INT. NEW SCENE - DAY");
    const newAction = makeParagraph("Action", "");
    if (state.doc.revision.enabled) {
      markRevision(state.doc, newHeading);
      markRevision(state.doc, newAction);
    }
    state.doc.paragraphs.splice(insertIndex, 0, newHeading, newAction);
    markDirty();
    state.history.record();
    renderAll();
    setView("script");
    setMode("write");
    requestAnimationFrame(() => focusParagraph(newHeading.id, "end"));
  }
  function moveScene(direction) {
    const scenes = getScenes(state.doc);
    if (!scenes.length) return;
    const active = activeParagraph();
    const currentScene = active ? sceneForParagraphId(active.id) : null;
    const currentIndex = currentScene
      ? scenes.findIndex((item) => item.id === currentScene.id)
      : state.activeScene;
    const step = direction < 0 ? -1 : 1;
    const nextIndex = clamp((currentIndex < 0 ? 0 : currentIndex) + step, 0, scenes.length - 1);
    const target = scenes[nextIndex];
    if (target) goToScene(target);
  }
  /* ------------------------------------------------------------------ */
  /* outline timeline, ruler, split view, dual dialogue, scriptnotes     */
  /* ------------------------------------------------------------------ */
  function renderOutlineAndRuler() {
    if (!els.outlineLayer) return;
    if (els.outlineBar) els.outlineBar.style.setProperty("--outline-zoom", String(state.outlineZoom || 1));
    const outlineVisible =
      state.showOutline &&
      (state.view !== "script" || state.showOutlineInScript !== false);
    if (els.outlineBar) els.outlineBar.hidden = !outlineVisible;
    if (els.rulerBar) els.rulerBar.hidden = !state.showRuler;
    els.outlineLayer.hidden = !outlineVisible && !state.showRuler;
    if (els.outlineToggleButton) {
      els.outlineToggleButton.classList.toggle("is-active", state.showOutline);
      els.outlineToggleButton.setAttribute("aria-pressed", String(state.showOutline));
      els.outlineToggleButton.dataset.subtle = outlineVisible ? "on" : "off";
    }
    if (els.rulerToggleButton) {
      els.rulerToggleButton.classList.toggle("is-active", state.showRuler);
      els.rulerToggleButton.setAttribute("aria-pressed", String(state.showRuler));
    }
    if (els.outlineTrack && outlineVisible) {
      const scenes = getScenes(state.doc);
      if (!scenes.length) {
        els.outlineTrack.innerHTML = `<span class="subtle" style="padding:0 8px;font-size:9px;align-self:center">No scenes yet</span>`;
      } else {
        const totalWords = Math.max(1, scenes.reduce((sum, s) => sum + Math.max(18, s.wordCount), 0));
        els.outlineTrack.innerHTML = scenes
          .map((scene, index) => {
            const weight = Math.max(4, Math.round((Math.max(18, scene.wordCount) / totalWords) * 100));
            const shortHeading = (scene.heading || `Scene ${scene.index}`)
              .replace(/\s+-\s+(DAY|NIGHT|CONTINUOUS|MORNING|EVENING|DAWN|DUSK|LATER)$/i, "")
              .trim();
            return `<button type="button" class="outline-segment${index === state.activeScene ? " is-active" : ""}${scene.omit ? " is-omitted" : ""}" data-outline-scene="${escapeHtml(scene.id)}" style="flex:${weight} 1 0%;--scene-color:${escapeHtml(scene.color || "#0f6cbd")}" title="${escapeHtml(`${scene.number || scene.index}. ${scene.heading} (${scene.wordCount} words)`)}" role="listitem">${escapeHtml(shortHeading)}</button>`;
          })
          .join("");
        $$(".outline-segment", els.outlineTrack).forEach((seg) => {
          seg.addEventListener("click", () => {
            const target = scenes.find((item) => item.id === seg.dataset.outlineScene);
            if (target) goToScene(target);
          });
        });
      }
    }
    if (els.rulerTicks && state.showRuler) {
      const inches = Math.max(5, Math.min(14, Math.floor(Number(state.doc.page.width) || 8)));
      if (Number(els.rulerTicks.dataset.inches) !== inches) {
        els.rulerTicks.dataset.inches = String(inches);
        els.rulerTicks.innerHTML = Array.from(
          { length: inches },
          (_, idx) => `<div class="ruler-tick"><span>${idx + 1}</span></div>`,
        ).join("");
      }
      const active = activeParagraph() || state.doc.paragraphs[0];
      if (active) updateRulerMarkers(elementSpec(active.type));
    }
  }
  function updateRulerMarkers(spec) {
    if (!els.rulerMarkerLeft || !els.rulerMarkerRight || !els.rulerMarkerFirst || !spec) return;
    const widthIn = Math.max(5, Number(state.doc.page.width) || 8.5);
    const leftPct = clamp((spec.left / widthIn) * 100, 2, 96);
    const firstPct = clamp(((spec.left + (spec.first || 0)) / widthIn) * 100, 2, 96);
    const rightPct = clamp((spec.right / widthIn) * 100, 8, 98);
    els.rulerMarkerLeft.style.left = `${leftPct.toFixed(2)}%`;
    els.rulerMarkerFirst.style.left = `${firstPct.toFixed(2)}%`;
    els.rulerMarkerRight.style.left = `${rightPct.toFixed(2)}%`;
  }
  function toggleOutlineLayer(force) {
    state.showOutline = typeof force === "boolean" ? force : !state.showOutline;
    renderOutlineAndRuler();
    persistPrefs();
    syncRibbon();
    requestAnimationFrame(() => fitPaper());
  }
  function toggleRulerLayer(force) {
    state.showRuler = typeof force === "boolean" ? force : !state.showRuler;
    renderOutlineAndRuler();
    persistPrefs();
    syncRibbon();
    requestAnimationFrame(() => fitPaper());
  }
  function toggleSplitView(force, orientation = null) {
    if (orientation) state.splitView.orientation = orientation;
    state.splitView.enabled =
      typeof force === "boolean" ? force : !state.splitView.enabled;
    if (els.editorStage) {
      els.editorStage.classList.toggle("is-split", state.splitView.enabled);
      els.editorStage.classList.toggle(
        "is-split-horizontal",
        state.splitView.enabled && state.splitView.orientation === "horizontal",
      );
      els.editorStage.classList.toggle(
        "is-split-swapped",
        state.splitView.enabled && state.splitView.swapped,
      );
    }
    if (els.splitPane) els.splitPane.hidden = !state.splitView.enabled;
    if (els.splitViewButton) {
      els.splitViewButton.classList.toggle("is-active", state.splitView.enabled);
      els.splitViewButton.setAttribute("aria-pressed", String(state.splitView.enabled));
      els.splitViewButton.title = state.splitView.enabled
        ? `Split view (${state.splitView.orientation === "horizontal" ? "Horizontal" : "Vertical"})`
        : "Split view (Reference / Cards beside Script)";
    }
    if (els.splitViewLabel) {
      els.splitViewLabel.textContent = "Split";
    }
    if (state.splitView.enabled) renderSplitPane();
    syncRibbon();
    requestAnimationFrame(() => fitPaper());
  }
  function swapSplitPanes() {
    if (!state.splitView.enabled) {
      toggleSplitView(true);
    }
    state.splitView.swapped = !state.splitView.swapped;
    if (els.editorStage) {
      els.editorStage.classList.toggle("is-split-swapped", state.splitView.swapped);
    }
    toast("Split panes swapped", "Primary and reference panes swapped positions.", "info", 1800);
  }
  function renderSplitPane() {
    if (!els.splitPaneBody || !state.splitView.enabled) return;
    const mode = state.splitView.mode || "cards";
    $$(".split-pane__tab", els.splitPane).forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.splitMode === mode);
    });
    if (mode === "cards") {
      const scenes = getScenes(state.doc);
      if (!scenes.length) {
        els.splitPaneBody.innerHTML = `<p class="subtle">Add a scene heading to populate Index Cards.</p>`;
        return;
      }
      els.splitPaneBody.innerHTML = scenes
        .map(
          (scene) => `
          <button type="button" class="split-card-item" data-split-scene="${escapeHtml(scene.id)}" style="--scene-color:${escapeHtml(scene.color || "#0f6cbd")}">
            <strong>${String(scene.index).padStart(2, "0")}. ${escapeHtml(scene.heading || "Untitled scene")}</strong>
            <span>${escapeHtml(scene.synopsis || `${scene.wordCount} words · ${scene.paragraphs} blocks`)}</span>
          </button>`,
        )
        .join("");
      $$("[data-split-scene]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = scenes.find((s) => s.id === btn.dataset.splitScene);
          if (target) goToScene(target);
        });
      });
    } else if (mode === "script") {
      els.splitPaneBody.innerHTML = state.doc.paragraphs
        .map((p) => {
          const txt = paragraphText(p);
          return `<div class="split-ref-para${p.type === "Scene Heading" ? " is-heading" : ""}" data-split-para="${escapeHtml(p.id)}">${escapeHtml(txt || `(${p.type})`)}</div>`;
        })
        .join("");
      $$("[data-split-para]", els.splitPaneBody).forEach((row) => {
        row.addEventListener("click", () => focusParagraph(row.dataset.splitPara, "start"));
      });
    } else if (mode === "notes") {
      const noted = state.doc.paragraphs.filter((p) => p.note && String(p.note).trim());
      const sceneNotes = getScenes(state.doc).filter((s) => s.notes && String(s.notes).trim());
      if (!noted.length && !sceneNotes.length) {
        els.splitPaneBody.innerHTML = `<p class="subtle">No ScriptNotes yet. Click <strong>ScriptNote</strong> in the toolbar to attach a note to any paragraph.</p>`;
        return;
      }
      els.splitPaneBody.innerHTML = [
        ...noted.map(
          (p) => `
          <button type="button" class="split-card-item" data-split-note-para="${escapeHtml(p.id)}" style="--scene-color:#ca5010">
            <strong>ScriptNote · ${escapeHtml(p.type)}</strong>
            <span>${escapeHtml(String(p.note))}</span>
          </button>`,
        ),
        ...sceneNotes.map(
          (s) => `
          <button type="button" class="split-card-item" data-split-scene="${escapeHtml(s.id)}" style="--scene-color:${escapeHtml(s.color || "#0f6cbd")}">
            <strong>Scene ${s.index} Note · ${escapeHtml(s.heading)}</strong>
            <span>${escapeHtml(s.notes)}</span>
          </button>`,
        ),
      ].join("");
      $$("[data-split-note-para]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => focusParagraph(btn.dataset.splitNotePara, "start"));
      });
      $$("[data-split-scene]", els.splitPaneBody).forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = getScenes(state.doc).find((s) => s.id === btn.dataset.splitScene);
          if (target) goToScene(target);
        });
      });
    }
  }
  function findDialogueExchangeRange(paragraphs, index) {
    if (index < 0 || index >= paragraphs.length) return null;
    const valid = new Set(["Character", "Parenthetical", "Dialogue"]);
    if (!valid.has(paragraphs[index].type)) return null;
    let start = index;
    while (start > 0 && valid.has(paragraphs[start - 1].type)) {
      if (paragraphs[start].type === "Character") break;
      start -= 1;
    }
    if (paragraphs[start].type !== "Character") return null;
    let end = start + 1;
    while (
      end < paragraphs.length &&
      (paragraphs[end].type === "Parenthetical" || paragraphs[end].type === "Dialogue")
    ) {
      end += 1;
    }
    return { start, end };
  }
  function toggleDualDialogue() {
    const active = activeParagraph();
    if (!active) return;
    const paragraphs = state.doc.paragraphs;
    if (active.dualGroup) {
      const group = active.dualGroup;
      paragraphs.forEach((p) => {
        if (p.dualGroup === group) {
          p.dualGroup = null;
          p.dualSide = null;
        }
      });
      markDirty();
      state.history.record();
      renderAll();
      focusParagraph(active.id, "end");
      toast("Dual dialogue removed", "Returned exchange to single-column layout.", "info", 2200);
      return;
    }
    const idx = paragraphs.findIndex((p) => p.id === active.id);
    const currentExchange = findDialogueExchangeRange(paragraphs, idx);
    if (!currentExchange) {
      toast(
        "Select a dialogue block",
        "Place the caret in a Character or Dialogue paragraph next to another character exchange.",
        "info",
        2600,
      );
      return;
    }
    let first = null;
    let second = null;
    const prevExchange =
      currentExchange.start > 0
        ? findDialogueExchangeRange(paragraphs, currentExchange.start - 1)
        : null;
    const nextExchange =
      currentExchange.end < paragraphs.length
        ? findDialogueExchangeRange(paragraphs, currentExchange.end)
        : null;
    if (prevExchange && prevExchange.end === currentExchange.start) {
      first = prevExchange;
      second = currentExchange;
    } else if (nextExchange && nextExchange.start === currentExchange.end) {
      first = currentExchange;
      second = nextExchange;
    }
    if (!first || !second) {
      toast(
        "Need two adjacent characters",
        "Dual dialogue pairs two consecutive Character + Dialogue exchanges.",
        "info",
        2600,
      );
      return;
    }
    const groupId = uid("dual");
    for (let i = first.start; i < first.end; i += 1) {
      paragraphs[i].dualGroup = groupId;
      paragraphs[i].dualSide = 0;
    }
    for (let i = second.start; i < second.end; i += 1) {
      paragraphs[i].dualGroup = groupId;
      paragraphs[i].dualSide = 1;
    }
    markDirty();
    state.history.record();
    renderAll();
    focusParagraph(active.id, "end");
    toast("Dual dialogue enabled", "Paired adjacent exchanges into two columns.", "success", 2200);
  }
  function toTitleCase(str) {
    return String(str).replace(
      /\w\S*/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }
  function cycleCase() {
    const el = activeParagraphElement();
    if (!el) return;
    const runs = FDX.htmlToRuns(el.innerHTML);
    if (!runs.length) return;
    const fullText = runs.map((r) => r.text).join("");
    if (!fullText.trim()) return;
    const isUpper = fullText === fullText.toUpperCase() && fullText !== fullText.toLowerCase();
    const isLower = fullText === fullText.toLowerCase() && fullText !== fullText.toUpperCase();
    const nextMode = isUpper ? "lower" : isLower ? "title" : "upper";
    const transformed = runs.map((run) => ({
      ...run,
      text:
        nextMode === "upper"
          ? run.text.toUpperCase()
          : nextMode === "lower"
            ? run.text.toLowerCase()
            : toTitleCase(run.text),
    }));
    el.innerHTML = FDX.runsToHtml(transformed);
    const paragraph = syncParagraphElement(el);
    markCurrentRevision(paragraph);
    markDirty();
    state.history.record();
    scheduleChrome();
    placeCaret(el, "end");
    toast(
      "Case updated",
      `Converted paragraph to ${nextMode === "upper" ? "UPPERCASE" : nextMode === "lower" ? "lowercase" : "Title Case"}.`,
      "info",
      1800,
    );
  }
  function openScriptNote() {
    const paragraph = activeParagraph() || state.doc.paragraphs[0];
    if (!paragraph) return;
    const existing = String(paragraph.note || "");
    openDialog({
      eyebrow: "Insert · ScriptNote",
      title: `ScriptNote on ${paragraph.type}`,
      body: `
        <p class="subtle" style="margin:0 0 8px">“${escapeHtml(truncate(paragraphText(paragraph) || "(Empty paragraph)", 110))}”</p>
        <label class="field"><span>Note text</span><textarea id="scriptNoteInput" rows="4" maxlength="1000" placeholder="Add a production note, rewrite reminder, or beat flag…">${escapeHtml(existing)}</textarea></label>
        <div class="dialog-note">ScriptNotes appear as a margin flag in the editor, in the Split View ScriptNotes tab, and export cleanly to FDX <code>&lt;ScriptNotes&gt;</code>.</div>`,
      actions: [
        ...(existing
          ? [
              {
                label: "Remove note",
                kind: "danger",
                onClick: () => {
                  delete paragraph.note;
                  markDirty();
                  state.history.record();
                  decorateEditor();
                  syncInspectorForParagraph(paragraph.id);
                  if (state.splitView.enabled) renderSplitPane();
                  toast("ScriptNote removed", "The note marker was cleared.", "info", 1800);
                },
              },
            ]
          : []),
        { label: "Cancel" },
        {
          label: "Save ScriptNote",
          kind: "primary",
          onClick: () => {
            const val = ($("#scriptNoteInput", els.dialogBody)?.value || "").trim();
            if (val) paragraph.note = val;
            else delete paragraph.note;
            markDirty();
            state.history.record();
            decorateEditor();
            syncInspectorForParagraph(paragraph.id);
            if (state.splitView.enabled) renderSplitPane();
            toast(
              val ? "ScriptNote saved" : "ScriptNote cleared",
              val ? "Note attached to paragraph." : "Empty note removed.",
              "success",
              2000,
            );
          },
        },
      ],
    });
  }
  function openElementSettings() {
    const currentType = (activeParagraph() || {}).type || "Action";
    const elementTypes = Object.keys(ELEMENTS);
    openDialog({
      eyebrow: "Format · Elements",
      title: "Script Elements settings",
      wide: true,
      body: `
        <div class="field-grid">
          <label class="field"><span>Select element</span><select id="elemSpecSelect">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${t === currentType ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Shortcut key</span><input id="elemSpecShortcut" type="text" readonly value="Alt+${escapeHtml(ELEMENTS[currentType].shortcut)}"></label>
        </div>
        <div class="field-grid" style="margin-top:8px">
          <label class="field"><span>Font family</span><input id="elemSpecFont" type="text" maxlength="120" value="${escapeHtml(ELEMENTS[currentType].font || state.font)}"></label>
          <label class="field"><span>Font size (pt)</span><input id="elemSpecSize" type="number" min="6" max="72" value="${ELEMENTS[currentType].fontSize || state.fontSize}"></label>
          <label class="field"><span>Left indent (in)</span><input id="elemSpecLeft" type="number" step="0.05" min="0.5" max="6.5" value="${ELEMENTS[currentType].left}"></label>
          <label class="field"><span>Right margin (in)</span><input id="elemSpecRight" type="number" step="0.05" min="3.0" max="8.0" value="${ELEMENTS[currentType].right}"></label>
          <label class="field"><span>First-line indent (in)</span><input id="elemSpecFirst" type="number" step="0.05" min="-1.0" max="2.0" value="${ELEMENTS[currentType].first}"></label>
          <label class="field"><span>Space before (pt)</span><input id="elemSpecBefore" type="number" step="2" min="0" max="48" value="${ELEMENTS[currentType].before}"></label>
          <label class="field"><span>Enter / Return goes to</span><select id="elemSpecNext">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${ELEMENTS[currentType].next === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
          <label class="field"><span>Tab key goes to</span><select id="elemSpecTab">${elementTypes.map((t) => `<option value="${escapeHtml(t)}"${ELEMENTS[currentType].tab === t ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></label>
        </div>
        <div class="dialog-note">Adjusting element geometry updates the live horizontal ruler, inspector specs, and FDX <code>&lt;ElementSettings&gt;</code> export.</div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply element settings",
          kind: "primary",
          keepOpen: true,
          onClick: () => {
            const type = $("#elemSpecSelect", els.dialogBody).value;
            const spec = { ...ELEMENTS[type] };
            if (spec) {
              spec.left = clamp(Number($("#elemSpecLeft", els.dialogBody).value) || spec.left, 0.5, 6.5);
              spec.right = clamp(Number($("#elemSpecRight", els.dialogBody).value) || spec.right, 3.0, 8.0);
              spec.first = clamp(Number($("#elemSpecFirst", els.dialogBody).value) || 0, -1.0, 2.0);
              spec.before = clamp(Number($("#elemSpecBefore", els.dialogBody).value) || 0, 0, 48);
              spec.next = $("#elemSpecNext", els.dialogBody).value || spec.next;
              spec.tab = $("#elemSpecTab", els.dialogBody).value || spec.tab;
              spec.font = $("#elemSpecFont", els.dialogBody).value.trim() || state.font;
              spec.fontSize = clamp(Number($("#elemSpecSize", els.dialogBody).value) || state.fontSize, 6, 72);
              if (spec.right <= spec.left) { toast("Invalid geometry", "The right edge must be after the left indent.", "warning"); return; }
              state.doc.elements ||= {};
              state.doc.elements[type] = spec;
              state.layoutDirty = true;
              markDirty();
              state.history.record();
              renderAll();
              closeDialog();
              toast("Element updated", `${type} geometry and behavior updated.`, "success", 2200);
            }
          },
        },
      ],
    });
    const sel = $("#elemSpecSelect", els.dialogBody);
    if (sel) {
      sel.addEventListener("change", () => {
        const spec = ELEMENTS[sel.value];
        if (!spec) return;
        $("#elemSpecShortcut", els.dialogBody).value = `Alt+${spec.shortcut}`;
        $("#elemSpecLeft", els.dialogBody).value = String(spec.left);
        $("#elemSpecRight", els.dialogBody).value = String(spec.right);
        $("#elemSpecFirst", els.dialogBody).value = String(spec.first);
        $("#elemSpecBefore", els.dialogBody).value = String(spec.before);
        $("#elemSpecFont", els.dialogBody).value = spec.font || state.font;
        $("#elemSpecSize", els.dialogBody).value = String(spec.fontSize || state.fontSize);
        $("#elemSpecNext", els.dialogBody).value = spec.next;
        $("#elemSpecTab", els.dialogBody).value = spec.tab;
      });
    }
  }
  const THESAURUS_BANK = {
    look: ["gaze", "stare", "peer", "glance", "scrutinize", "survey", "eye", "watch", "scan", "glare"],
    walk: ["stride", "pace", "stroll", "march", "shuffle", "prowl", "saunter", "trudge", "stalk", "amble"],
    run: ["sprint", "bolt", "dash", "scramble", "charge", "dart", "race", "hurtle", "flee", "tear"],
    say: ["murmur", "whisper", "snap", "mutter", "declare", "bark", "deadpan", "bite out", "exhale", "rasp"],
    quiet: ["silent", "hushed", "still", "muted", "soundless", "noiseless", "stifled", "dormant"],
    dark: ["shadowy", "dim", "murky", "tenebrous", "bleak", "pitch-black", "shrouded", "moonless"],
    light: ["glow", "gleam", "shimmer", "glint", "flare", "radiance", "flicker", "beam", "strobe"],
    fear: ["dread", "panic", "terror", "unease", "tremor", "paranoia", "chill", "foreboding"],
    angry: ["furious", "seething", "livid", "incensed", "bristling", "cold", "volatile", "fierce"],
    hold: ["grip", "clutch", "clasp", "cradle", "clench", "pin", "brandish", "steady"],
    turn: ["pivot", "wheel", "spin", "whirl", "swivel", "twist", "veer", "angle"],
    stop: ["freeze", "halt", "stall", "hesitate", "check", "brake", "Falter", "pause"],
  };
  function openThesaurus() {
    const selection = window.getSelection();
    const selectedWord =
      selection && !selection.isCollapsed
        ? selection.toString().trim().toLowerCase()
        : "";
    const initialQuery = selectedWord || "look";
    openDialog({
      eyebrow: "Proofing · Thesaurus",
      title: "Screenwriter's Thesaurus",
      body: `
        <label class="field"><span>Lookup action verb, tone, or word</span><input id="thesaurusInput" type="search" value="${escapeHtml(initialQuery)}" placeholder="e.g. look, walk, run, say, dark, light, fear…"></label>
        <div class="element-choices" id="thesaurusResults" style="margin-top:10px"></div>
        <div class="dialog-note" style="margin-top:10px">Click any synonym chip to insert or replace at the current caret position in the screenplay.</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    const input = $("#thesaurusInput", els.dialogBody);
    const results = $("#thesaurusResults", els.dialogBody);
    const renderSynonyms = (query) => {
      const q = String(query || "").trim().toLowerCase();
      let list = THESAURUS_BANK[q] || [];
      if (!list.length && q) {
        for (const [key, words] of Object.entries(THESAURUS_BANK)) {
          if (key.includes(q) || words.some((w) => w.toLowerCase().includes(q))) {
            list = Array.from(new Set([...list, key, ...words]));
          }
        }
      }
      if (!list.length) {
        list = ["stride", "gaze", "murmur", "sprint", "shimmer", "hesitate", "clutch", "pivot", "seething", "dread"];
      }
      results.innerHTML = list
        .map(
          (word) =>
            `<button type="button" class="element-choice" data-synonym="${escapeHtml(word)}">${escapeHtml(word)}</button>`,
        )
        .join("");
      $$("[data-synonym]", results).forEach((btn) => {
        btn.addEventListener("click", () => {
          const word = btn.dataset.synonym;
          closeDialog();
          const el = activeParagraphElement();
          if (el) {
            el.focus({ preventScroll: true });
            document.execCommand("insertText", false, word);
            syncParagraphElement(el);
            markDirty();
            state.history.record();
            toast("Synonym inserted", `Inserted “${word}” into ${el.dataset.type}.`, "success", 1800);
          }
        });
      });
    };
    renderSynonyms(initialQuery);
    if (input) {
      input.addEventListener("input", () => renderSynonyms(input.value));
    }
  }
  function openSpellcheckDialog() {
    const repeated = [];
    state.doc.paragraphs.forEach((p, idx) => {
      const text = paragraphText(p);
      const match = text.match(/\b([a-zA-Z]{2,})\s+\1\b/i);
      if (match) {
        repeated.push({ id: p.id, type: p.type, index: idx + 1, word: match[1], snippet: truncate(text, 70) });
      }
    });
    openDialog({
      eyebrow: "Proofing · Spelling",
      title: "Spelling & Proofing check",
      body: `
        <div class="setting-line"><div><strong>Live browser spellcheck</strong><span>Underline misspelled words in the screenplay editor.</span></div><button type="button" class="switch ${state.spellcheck ? "is-on" : ""}" id="spellDialogToggle" role="switch" aria-checked="${state.spellcheck}"><span></span></button></div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:10px">
          ${
            repeated.length
              ? repeated
                  .map(
                    (item) =>
                      `<div class="shortcut-row"><span>Repeated word “<strong>${escapeHtml(item.word)}</strong>” in ${escapeHtml(item.type)}</span><kbd>Block ${item.index}</kbd></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No repeated words or proofing anomalies detected.</span><kbd>Clean</kbd></div>`
          }
        </div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
    const toggle = $("#spellDialogToggle", els.dialogBody);
    if (toggle) {
      toggle.addEventListener("click", () => {
        state.spellcheck = !state.spellcheck;
        toggle.classList.toggle("is-on", state.spellcheck);
        toggle.setAttribute("aria-checked", String(state.spellcheck));
        applyStudioAppearance();
        persistPrefs();
      });
    }
  }
  /* ------------------------------------------------------------------ */
  /* Azkript complete feature set & dialogs                            */
  /* ------------------------------------------------------------------ */
  function setNavigatorTab(tabName) {
    state.navTab = tabName || "scenes";
    $$(".navigator-tab").forEach((tab) => {
      const active = tab.dataset.navTab === state.navTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $$("[data-nav-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.navPane !== state.navTab;
    });
    renderNavigatorSubTabs(state.sceneQuery.trim().toLowerCase());
  }
  function openBeatDialog(beatId) {
    const beats = state.doc.beats || (state.doc.beats = []);
    const beat = beats.find((b) => b.id === beatId);
    if (!beat) return;
    openDialog({
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
            state.doc.beats = beats.filter((b) => b.id !== beat.id);
            markDirty();
            state.history.record();
            renderBeatBoard();
            toast("Beat removed", "Beat deleted from the board.", "info", 1800);
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
            markDirty();
            state.history.record();
            renderBeatBoard();
            toast("Beat saved", `${beat.title} updated on Beat Board.`, "success", 2000);
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
    if (!state.doc.beats) state.doc.beats = [];
    const count = state.doc.beats.length;
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
    state.doc.beats.push(newBeat);
    markDirty();
    state.history.record();
    if (state.view !== "beatboard") setView("beatboard");
    else renderBeatBoard();
    openBeatDialog(newBeat.id);
  }
  function alignBeats(mode) {
    if (!mode || !state.doc.beats || !state.doc.beats.length) return;
    const beats = state.doc.beats;
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
    markDirty();
    state.history.record();
    renderBeatBoard();
    toast("Beats aligned", `Arranged ${beats.length} beats in ${mode} layout.`, "info", 1800);
  }
  function sendBeatToScript(beatId) {
    const beats = state.doc.beats || [];
    const targetBeats = beatId ? beats.filter((b) => b.id === beatId) : beats;
    if (!targetBeats.length) {
      toast("No beats to send", "Add a beat on the Beat Board first.", "info", 2000);
      return;
    }
    targetBeats.forEach((beat) => {
      const headingText = beat.title.toUpperCase().startsWith("INT.") || beat.title.toUpperCase().startsWith("EXT.")
        ? beat.title.toUpperCase()
        : `INT. ${beat.title.toUpperCase()} - DAY`;
      state.doc.paragraphs.push(
        createParagraph("Scene Heading", escapeHtml(headingText), {
          scene: {
            synopsis: beat.body || "",
            color: beat.color || "#0f6cbd",
            title: beat.title,
            notes: beat.goalPage ? `Goal Page: ${beat.goalPage}` : "",
          },
        }),
      );
      if (beat.body) {
        state.doc.paragraphs.push(createParagraph("Action", escapeHtml(beat.body)));
      }
    });
    markDirty();
    state.history.record();
    renderAll();
    setView("script");
    toast("Sent to Script", `${targetBeats.length} beat${targetBeats.length === 1 ? "" : "s"} appended as screenplay scenes.`, "success");
  }
  function sendCardsToScript() {
    const scenes = getScenes(state.doc);
    let updated = 0;
    scenes.forEach((scene) => {
      const syn = (scene.paragraph.scene?.synopsis || "").trim();
      if (!syn) return;
      const nextPara = state.doc.paragraphs[scene.startIndex + 1];
      if (!nextPara || nextPara.type === "Scene Heading") {
        state.doc.paragraphs.splice(scene.startIndex + 1, 0, createParagraph("Action", escapeHtml(syn)));
        updated += 1;
      }
    });
    markDirty();
    state.history.record();
    renderAll();
    setView("script");
    toast(
      "Index Cards synced to Script",
      updated ? `${updated} card synopses inserted into scene action.` : "All index cards are already synced with script scenes.",
      "success",
    );
  }
  function openAltDialogueDialog() {
    const active = activeParagraph() || state.doc.paragraphs.find((p) => p.type === "Dialogue") || state.doc.paragraphs[0];
    if (!active) return;
    if (!Array.isArray(active.alts)) active.alts = [];
    const currentText = paragraphText(active);
    const allTakes = [currentText, ...active.alts];
    openDialog({
      eyebrow: "Dialogue · Alternate Takes",
      title: "Alt Dialogue Manager",
      body: `
        <p class="dialog-note" style="margin-top:0">Store multiple alternate takes inside a single Dialogue paragraph and cycle through them anytime.</p>
        <div class="field">
          <span>Active Line (${escapeHtml(active.type)})</span>
          <input id="altPrimaryInput" type="text" value="${escapeHtml(currentText)}">
        </div>
        <div class="field">
          <span>Alternate Takes (one take per line)</span>
          <textarea id="altTakesInput" rows="4" placeholder="Enter alternate dialogue lines, one per line…">${escapeHtml(active.alts.join("\n"))}</textarea>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${allTakes
            .map(
              (take, idx) =>
                `<div class="shortcut-row"><span><strong>Take ${idx + 1}:</strong> ${escapeHtml(take || "(empty)")}</span><button type="button" class="pill-btn" data-use-take="${idx}">Make Active</button></div>`,
            )
            .join("")}
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Alts",
          kind: "primary",
          onClick: () => {
            const primary = $("#altPrimaryInput", els.dialogBody).value.trim();
            const takes = $("#altTakesInput", els.dialogBody)
              .value.split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            active.html = escapeHtml(primary);
            active.alts = takes;
            active.activeAlt = 0;
            const el = paragraphElement(active.id);
            if (el) el.innerHTML = active.html;
            markDirty();
            state.history.record();
            decorateEditor();
            toast("Alt Dialogue saved", `${takes.length} alternate take${takes.length === 1 ? "" : "s"} stored on this line.`, "success");
          },
        },
      ],
    });
    $$("[data-use-take]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.useTake);
        if (idx === 0) return;
        const altText = active.alts[idx - 1];
        if (!altText) return;
        active.alts[idx - 1] = currentText;
        active.html = escapeHtml(altText);
        const el = paragraphElement(active.id);
        if (el) el.innerHTML = active.html;
        closeDialog();
        markDirty();
        state.history.record();
        decorateEditor();
        toast("Switched Alt Take", `Take ${idx + 1} is now active in the script.`, "success", 2000);
      });
    });
  }
  function cycleParagraphAlt(paragraphId) {
    const p = state.doc.paragraphs.find((item) => item.id === paragraphId);
    if (!p || !Array.isArray(p.alts) || !p.alts.length) return;
    const current = paragraphText(p);
    const nextAlt = p.alts.shift();
    p.alts.push(current);
    p.html = escapeHtml(nextAlt);
    p.activeAlt = ((p.activeAlt || 0) + 1) % (p.alts.length + 1);
    const el = paragraphElement(p.id);
    if (el) el.innerHTML = p.html;
    markDirty();
    state.history.record();
    decorateEditor();
    toast("Alt Take Cycled", `Switched to take ${p.activeAlt + 1} of ${p.alts.length + 1}.`, "info", 1800);
  }
  function openTagsDialog() {
    const active = activeParagraph() || state.doc.paragraphs[0];
    if (!active) return;
    if (!Array.isArray(active.tags)) active.tags = [];
    const selectedText = (() => {
      const sel = window.getSelection();
      return sel && !sel.isCollapsed ? sel.toString().trim() : "";
    })();
    const defaultLabel = selectedText || truncate(paragraphText(active), 36) || "Production Item";
    openDialog({
      eyebrow: "Production · Breakdown Tags",
      title: "Tags & Production Breakdown",
      body: `
        <div class="field-grid">
          <label class="field"><span>Item Label</span><input id="tagLabelInput" type="text" maxlength="100" value="${escapeHtml(defaultLabel)}"></label>
          <label class="field"><span>Category</span><select id="tagCategorySelect">${TAG_CATEGORIES.map(
            (cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</option>`,
          ).join("")}</select></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            active.tags.length
              ? active.tags
                  .map(
                    (t, idx) =>
                      `<div class="shortcut-row"><span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(t.color)}"></span><strong>${escapeHtml(t.label)}</strong> · ${escapeHtml(t.category)}</span><button type="button" class="pill-btn" data-remove-tag="${idx}">Remove</button></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No tags attached to this paragraph yet.</span><kbd>Empty</kbd></div>`
          }
        </div>`,
      actions: [
        {
          label: "Tag All Characters",
          onClick: tagAllCharacters,
        },
        { label: "Close" },
        {
          label: "Add Tag",
          kind: "primary",
          onClick: () => {
            const label = $("#tagLabelInput", els.dialogBody).value.trim() || "Tagged Item";
            const catId = $("#tagCategorySelect", els.dialogBody).value;
            const cat = TAG_CATEGORIES.find((c) => c.id === catId) || TAG_CATEGORIES[0];
            active.tags.push({
              id: uid("tag"),
              category: cat.id,
              label,
              color: cat.color,
            });
            markDirty();
            state.history.record();
            decorateEditor();
            renderNavigatorSubTabs();
            toast("Tag added", `${label} tagged under ${cat.label}.`, "success", 2000);
          },
        },
      ],
    });
    $$("[data-remove-tag]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.removeTag);
        active.tags.splice(idx, 1);
        markDirty();
        state.history.record();
        decorateEditor();
        renderNavigatorSubTabs();
        openTagsDialog();
      });
    });
  }
  function tagAllCharacters() {
    const chars = getCharacters(state.doc);
    let added = 0;
    state.doc.paragraphs.forEach((p) => {
      if (p.type !== "Character") return;
      const name = paragraphText(p).replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (!name) return;
      if (!Array.isArray(p.tags)) p.tags = [];
      if (!p.tags.some((t) => t.category === "cast" && t.label.toUpperCase() === name.toUpperCase())) {
        p.tags.push({ id: uid("tag"), category: "cast", label: name, color: "#0f6cbd" });
        added += 1;
      }
    });
    markDirty();
    state.history.record();
    decorateEditor();
    renderNavigatorSubTabs();
    toast("Cast Tagged", `${added} character cues tagged for production breakdown (${chars.length} cast roles).`, "success");
  }
  function openBookmarksDialog(addDirect = false) {
    if (!Array.isArray(state.doc.bookmarks)) state.doc.bookmarks = [];
    const active = activeParagraph() || state.doc.paragraphs[0];
    if (addDirect && active) {
      const label = `${active.type}: ${truncate(paragraphText(active) || "Bookmark", 40)}`;
      state.doc.bookmarks.push({ id: uid("bm"), paragraphId: active.id, label });
      markDirty();
      state.history.record();
      decorateEditor();
      toast("Bookmark added", label, "success", 2000);
      return;
    }
    openDialog({
      eyebrow: "Navigation · Bookmarks",
      title: "Script Bookmarks",
      body: `
        <div class="field-grid">
          <label class="field" style="grid-column:1 / -1"><span>Bookmark Label for Current Line</span><input id="bmLabelInput" type="text" maxlength="100" value="${escapeHtml(active ? `${active.type} — ${truncate(paragraphText(active), 34)}` : "Act Break")}"></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            state.doc.bookmarks.length
              ? state.doc.bookmarks
                  .map(
                    (bm, idx) =>
                      `<div class="shortcut-row"><span>${icon("bookmark")} <strong>${escapeHtml(bm.name || bm.label || "Bookmark")}</strong></span><span style="display:flex;gap:6px"><button type="button" class="pill-btn" data-bm-jump="${escapeHtml(bm.paragraphId)}">Go To</button><button type="button" class="pill-btn" data-bm-del="${idx}">Remove</button></span></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No bookmarks in this screenplay yet.</span><kbd>None</kbd></div>`
          }
        </div>`,
      actions: [
        { label: "Close" },
        {
          label: "Add Bookmark Here",
          kind: "primary",
          onClick: () => {
            if (!active) return;
            const label = $("#bmLabelInput", els.dialogBody).value.trim() || "Bookmark";
            state.doc.bookmarks.push({ id: uid("bm"), paragraphId: active.id, label });
            markDirty();
            state.history.record();
            decorateEditor();
            toast("Bookmark saved", label, "success", 2000);
          },
        },
      ],
    });
    $$("[data-bm-jump]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        closeDialog();
        setView("script");
        focusParagraph(btn.dataset.bmJump, "start");
      });
    });
    $$("[data-bm-del]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.doc.bookmarks.splice(Number(btn.dataset.bmDel), 1);
        markDirty();
        decorateEditor();
        openBookmarksDialog(false);
      });
    });
  }
  function openGoToDialog() {
    const scenes = getScenes(state.doc);
    const totalPages = pageCount();
    openDialog({
      eyebrow: "Edit · Go To",
      title: "Jump to Page, Scene, or Paragraph",
      body: `
        <div class="field-grid">
          <label class="field"><span>Page Number (1–${totalPages})</span><input id="gotoPageInput" type="number" min="1" max="${totalPages}" placeholder="1"></label>
          <label class="field"><span>Scene (1–${scenes.length})</span><select id="gotoSceneSelect"><option value="">Select scene…</option>${scenes
            .map((s) => `<option value="${escapeHtml(s.id)}">${s.index}. ${escapeHtml(s.heading)}</option>`)
            .join("")}</select></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Go To",
          kind: "primary",
          onClick: () => {
            const sceneId = $("#gotoSceneSelect", els.dialogBody).value;
            const pageNum = Number($("#gotoPageInput", els.dialogBody).value);
            if (sceneId) {
              const targetScene = scenes.find((s) => s.id === sceneId);
              if (targetScene) goToScene(targetScene);
              return;
            }
            if (pageNum > 0) {
              if (state.mode === "page") {
                // layout.pages may carry a title page at index 0, while the
                // dialog and the dock both speak in script page numbers.
                const titleOffset = state.doc.titlePage && state.doc.titlePage.enabled ? 1 : 0;
                goToPage(pageNum - 1 + titleOffset);
              } else {
                // Use real pagination rather than the words/180 estimate on
                // scene.startPage, which disagrees with page view.
                const pageForScene = scenePageMap();
                const targetScene =
                  scenes.find((scene) => (pageForScene.get(scene.id) || Infinity) >= pageNum) ||
                  scenes[scenes.length - 1];
                if (targetScene) goToScene(targetScene);
              }
            }
          },
        },
      ],
    });
  }
  function openHeaderFooterDialog() {
    const hf = state.doc.headerFooter || (state.doc.headerFooter = {
      enabled: true,
      left: "",
      center: "",
      right: "{PAGE}.",
      footerLeft: "",
      footerRight: "",
      showOnFirstPage: false,
      startingPageNumber: 1,
    });
    openDialog({
      eyebrow: "Document · Header & Footer",
      title: "Header and Footer Setup",
      body: `
        <div class="setting-line"><div><strong>Show Header Bar</strong><span>Display running header on script pages.</span></div><button type="button" class="switch ${hf.enabled !== false ? "is-on" : ""}" id="hfEnabledSwitch" role="switch" aria-checked="${hf.enabled !== false}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Header Left</span><input id="hfLeft" type="text" value="${escapeHtml(hf.left || "")}" placeholder="Title / Draft"></label>
          <label class="field"><span>Header Center</span><input id="hfCenter" type="text" value="${escapeHtml(hf.center || "")}" placeholder="Revision / Date"></label>
          <label class="field"><span>Header Right</span><input id="hfRight" type="text" value="${escapeHtml(hf.right || "{PAGE}.")}" placeholder="{PAGE}."></label>
          <label class="field"><span>Starting Page #</span><input id="hfStartPage" type="number" min="1" max="999" value="${hf.startingPageNumber || 1}"></label>
          <label class="field"><span>Footer Left</span><input id="hfFooterLeft" type="text" value="${escapeHtml(hf.footerLeft || "")}" placeholder="Confidential"></label>
          <label class="field"><span>Footer Right</span><input id="hfFooterRight" type="text" value="${escapeHtml(hf.footerRight || "")}" placeholder="Azkript"></label>
        </div>
        <div class="setting-line"><div><strong>Show Header on First Page</strong><span>Print header on Page 1 of the screenplay.</span></div><button type="button" class="switch ${hf.showOnFirstPage ? "is-on" : ""}" id="hfFirstPageSwitch" role="switch" aria-checked="${Boolean(hf.showOnFirstPage)}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Header & Footer",
          kind: "primary",
          onClick: () => {
            hf.enabled = $("#hfEnabledSwitch", els.dialogBody).classList.contains("is-on");
            hf.left = $("#hfLeft", els.dialogBody).value.trim();
            hf.center = $("#hfCenter", els.dialogBody).value.trim();
            hf.right = $("#hfRight", els.dialogBody).value.trim();
            hf.startingPageNumber = clamp(Number($("#hfStartPage", els.dialogBody).value) || 1, 1, 999);
            hf.footerLeft = $("#hfFooterLeft", els.dialogBody).value.trim();
            hf.footerRight = $("#hfFooterRight", els.dialogBody).value.trim();
            hf.showOnFirstPage = $("#hfFirstPageSwitch", els.dialogBody).classList.contains("is-on");
            hf.showHeader = hf.enabled !== false;
            hf.showFooter = Boolean(hf.footerLeft || hf.footerRight || hf.footerText);
            hf.headerText = [hf.left, hf.center, hf.right].filter(Boolean).join("    ");
            hf.footerText = [hf.footerLeft, hf.footerRight].filter(Boolean).join("    ");
            hf.startingPage = hf.startingPageNumber;
            markDirty();
            state.history.record();
            renderAll();
            toast("Header & Footer updated", "Running page headers and footers saved.", "success");
          },
        },
      ],
    });
    ["hfEnabledSwitch", "hfFirstPageSwitch"].forEach((id) => bindDialogSwitch(id));  }
  function openMoresDialog() {
    /* normalizeDocument always supplies moresContinueds using the model's own
     * key names (dialogueCont / sceneContTop / sceneContBottom /
     * autoCharacterCont). The dialog previously read a parallel set of names
     * that never existed, so the inputs rendered the literal text "undefined". */
    const mc = state.doc.moresContinueds || (state.doc.moresContinueds = {
      dialogueMore: "(MORE)",
      dialogueCont: "(CONT'D)",
      sceneContTop: "CONTINUED:",
      sceneContBottom: "(CONTINUED)",
      autoCharacterCont: true,
      includeSceneNumber: true,
    });
    const mcDialogueCont = mc.dialogueCont != null ? mc.dialogueCont : mc.dialogueContinued;
    const mcSceneBottom = mc.sceneContBottom != null ? mc.sceneContBottom : mc.sceneContinuedBottom;
    const mcSceneTop = mc.sceneContTop != null ? mc.sceneContTop : mc.sceneContinuedTop;
    const mcAutoChar = mc.autoCharacterCont != null ? mc.autoCharacterCont : mc.autoCharacterContinued;
    openDialog({
      eyebrow: "Document · Mores & Continueds",
      title: "Mores and Continueds",
      body: `
        <div class="field-grid">
          <label class="field"><span>Dialogue Bottom</span><input id="mcMore" type="text" value="${escapeHtml(mc.dialogueMore)}"></label>
          <label class="field"><span>Dialogue Top</span><input id="mcContd" type="text" value="${escapeHtml(mcDialogueCont)}"></label>
          <label class="field"><span>Scene Bottom</span><input id="mcSceneBot" type="text" value="${escapeHtml(mcSceneBottom)}"></label>
          <label class="field"><span>Scene Top</span><input id="mcSceneTop" type="text" value="${escapeHtml(mcSceneTop)}"></label>
        </div>
        <div class="setting-line"><div><strong>Automatic Character (CONT'D)</strong><span>Append (CONT'D) when the same character speaks again without interruption.</span></div><button type="button" class="switch ${mcAutoChar ? "is-on" : ""}" id="mcAutoChar" role="switch" aria-checked="${mcAutoChar}"><span></span></button></div>
        <div class="setting-line"><div><strong>Dialogue page-break (MORE) / (CONT'D)</strong><span>Mark split speeches across page breaks.</span></div><button type="button" class="switch ${state.doc.settings.showMore !== false ? "is-on" : ""}" id="mcShowMore" role="switch" aria-checked="${state.doc.settings.showMore !== false}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            mc.dialogueMore = $("#mcMore", els.dialogBody).value.trim() || "(MORE)";
            mc.dialogueCont = $("#mcContd", els.dialogBody).value.trim() || "(CONT'D)";
            mc.sceneContBottom = $("#mcSceneBot", els.dialogBody).value.trim() || "(CONTINUED)";
            mc.sceneContTop = $("#mcSceneTop", els.dialogBody).value.trim() || "CONTINUED:";
            mc.autoCharacterCont = $("#mcAutoChar", els.dialogBody).classList.contains("is-on");
            state.doc.settings.showMore = $("#mcShowMore", els.dialogBody).classList.contains("is-on");
            state.layoutDirty = true;
            markDirty();
            state.history.record();
            renderAll();
            toast("Mores & Continueds updated", "Page continuation markers updated.", "success");
          },
        },
      ],
    });
    ["mcAutoChar", "mcShowMore"].forEach((id) => bindDialogSwitch(id));  }
  function openWatermarkDialog() {
    const wm = state.doc.watermark || (state.doc.watermark = { enabled: false, text: "CONFIDENTIAL", opacity: 14 });
    openDialog({
      eyebrow: "Document · Security Watermark",
      title: "Page Watermark",
      body: `
        <div class="setting-line"><div><strong>Enable Watermark</strong><span>Stamp diagonal security text across script pages and PDF exports.</span></div><button type="button" class="switch ${wm.enabled ? "is-on" : ""}" id="wmEnabledSwitch" role="switch" aria-checked="${wm.enabled}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Watermark Text</span><input id="wmTextInput" type="text" maxlength="60" value="${escapeHtml(wm.text || "CONFIDENTIAL")}"></label>
          <label class="field"><span>Opacity (%)</span><input id="wmOpacityInput" type="number" min="2" max="35" value="${Math.round(wm.opacity || 14)}"></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply Watermark",
          kind: "primary",
          onClick: () => {
            wm.enabled = $("#wmEnabledSwitch", els.dialogBody).classList.contains("is-on");
            wm.text = $("#wmTextInput", els.dialogBody).value.trim() || "CONFIDENTIAL";
            wm.opacity = clamp(Number($("#wmOpacityInput", els.dialogBody).value) || 14, 2, 35);
            markDirty();
            state.history.record();
            decorateEditor();
            toast("Watermark updated", wm.enabled ? `Watermark “${wm.text}” enabled.` : "Watermark turned off.", "success");
          },
        },
      ],
    });
    bindDialogSwitch("wmEnabledSwitch");  }
  function openSmartTypeDialog() {
    const st = state.doc.smartType || (state.doc.smartType = {
      characters: [],
      extensions: ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)", "(SUBTITLED)"],
      sceneIntros: ["INT.", "EXT.", "INT./EXT.", "I/E."],
      locations: [],
      times: ["DAY", "NIGHT", "DAWN", "DUSK", "LATER", "CONTINUOUS", "MOMENTS LATER", "SAME TIME"],
      transitions: ["CUT TO:", "SMASH CUT TO:", "MATCH CUT TO:", "DISSOLVE TO:", "FADE IN:", "FADE OUT.", "FADE TO BLACK."],
    });
    const autoChars = getCharacters(state.doc).map((c) => c.name);
    const mergedChars = Array.from(new Set([...autoChars, ...(st.characters || [])]));
    openDialog({
      eyebrow: "Document · SmartType Lists",
      title: "SmartType Autocomplete Lists",
      wide: true,
      body: `
        <div class="setting-line"><div><strong>SmartType Autocomplete</strong><span>Automatically suggest characters, extensions, scene intros, locations, times, and transitions.</span></div><button type="button" class="switch ${state.smartTypeEnabled ? "is-on" : ""}" id="stToggleSwitch" role="switch" aria-checked="${state.smartTypeEnabled}"><span></span></button></div>
        <div class="field-grid">
          <label class="field"><span>Characters (one per line)</span><textarea id="stChars" rows="4">${escapeHtml(mergedChars.join("\n"))}</textarea></label>
          <label class="field"><span>Extensions</span><textarea id="stExts" rows="4">${escapeHtml((st.extensions || []).join("\n"))}</textarea></label>
          <label class="field"><span>Scene Intros</span><textarea id="stIntros" rows="4">${escapeHtml((st.sceneIntros || []).join("\n"))}</textarea></label>
          <label class="field"><span>Times of Day</span><textarea id="stTimes" rows="4">${escapeHtml((st.times || []).join("\n"))}</textarea></label>
          <label class="field" style="grid-column:1 / -1"><span>Transitions</span><textarea id="stTrans" rows="3">${escapeHtml((st.transitions || []).join("\n"))}</textarea></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save SmartType Lists",
          kind: "primary",
          onClick: () => {
            state.smartTypeEnabled = $("#stToggleSwitch", els.dialogBody).classList.contains("is-on");
            const splitLines = (id) =>
              $(`#${id}`, els.dialogBody)
                .value.split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean);
            st.characters = splitLines("stChars");
            st.extensions = splitLines("stExts");
            st.sceneIntros = splitLines("stIntros");
            st.times = splitLines("stTimes");
            st.transitions = splitLines("stTrans");
            markDirty();
            persistPrefs();
            toast("SmartType updated", "Autocomplete dictionaries saved.", "success");
          },
        },
      ],
    });
    bindDialogSwitch("stToggleSwitch");  }
  function openMacrosDialog() {
    const macros = state.doc.macros || DEFAULT_MACROS;
    openDialog({
      eyebrow: "Document · Macros",
      title: "Keyboard Macros",
      body: `
        <p class="dialog-note" style="margin-top:0">Click any macro to insert its text and switch to its target element immediately.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${macros
            .map(
              (m, idx) =>
                `<div class="shortcut-row"><span><strong>${escapeHtml(m.name)}</strong> → <code>${escapeHtml(m.text)}</code> (${escapeHtml(m.element)})</span><span style="display:flex;gap:6px"><kbd>${escapeHtml(m.key)}</kbd><button type="button" class="pill-btn" data-run-macro="${idx}">Insert</button></span></div>`,
            )
            .join("")}
        </div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
    $$("[data-run-macro]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = macros[Number(btn.dataset.runMacro)];
        if (!m) return;
        closeDialog();
        changeElementType(m.element || "Scene Heading");
        const active = activeParagraph();
        if (active) {
          active.html = escapeHtml(m.text);
          const el = paragraphElement(active.id);
          if (el) {
            el.innerHTML = active.html;
            focusParagraph(active.id, "end");
          }
          markDirty();
          state.history.record();
          scheduleChrome();
        }
      });
    });
  }
  function openNamesDatabaseDialog() {
    const names = [
      { name: "ELENA VANCE", category: "Female · Sci-Fi / Thriller" },
      { name: "MARCUS COLE", category: "Male · Drama / Noir" },
      { name: "SORA TAKAHASHI", category: "Unisex · Contemporary" },
      { name: "JULIAN MERCER", category: "Male · Prestige Drama" },
      { name: "CLARA VOSS", category: "Female · Mystery / Period" },
      { name: "DEVON REYES", category: "Unisex · Action / Ensemble" },
      { name: "NADIA KORzh", category: "Female · Espionage" },
      { name: "ARTHUR PENDLETON", category: "Male · Comedy / Historical" },
      { name: "ZARA AL-MANSOUR", category: "Female · Global Thriller" },
      { name: "JONAH STERLING", category: "Male · Western / Neo-Noir" },
      { name: "MAEUM PARK", category: "Unisex · Indie / Drama" },
      { name: "VICTOR KANE", category: "Male · Antagonist / Noir" },
    ];
    openDialog({
      eyebrow: "Tools · Character Names Database",
      title: "Character Names Database",
      body: `
        <label class="field"><span>Filter character names</span><input id="namesFilterInput" type="search" placeholder="Search by name, style, or genre…"></label>
        <div class="shortcut-grid" id="namesDbList" style="grid-template-columns:1fr;max-height:300px;overflow:auto">
          ${names
            .map(
              (n) =>
                `<div class="shortcut-row" data-name-row="${escapeHtml(n.name.toLowerCase())} ${escapeHtml(n.category.toLowerCase())}"><span><strong>${escapeHtml(n.name)}</strong> · <small>${escapeHtml(n.category)}</small></span><button type="button" class="pill-btn" data-insert-name="${escapeHtml(n.name)}">Insert as Character</button></div>`,
            )
            .join("")}
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    const filterInput = $("#namesFilterInput", els.dialogBody);
    if (filterInput) {
      filterInput.addEventListener("input", () => {
        const q = filterInput.value.trim().toLowerCase();
        $$("[data-name-row]", els.dialogBody).forEach((row) => {
          row.hidden = Boolean(q && !row.dataset.nameRow.includes(q));
        });
      });
    }
    $$("[data-insert-name]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.insertName;
        closeDialog();
        setView("script");
        const active = activeParagraph();
        const index = active ? state.doc.paragraphs.indexOf(active) + 1 : state.doc.paragraphs.length;
        const p = createParagraph("Character", escapeHtml(name));
        state.doc.paragraphs.splice(index, 0, p);
        markDirty();
        state.history.record();
        renderAll();
        requestAnimationFrame(() => focusParagraph(p.id, "end"));
        toast("Character inserted", `${name} added to script.`, "success", 1800);
      });
    });
  }
  function openReformatDialog() {
    const active = activeParagraph() || state.doc.paragraphs[0];
    openDialog({
      eyebrow: "Tools · Reformat Tool",
      title: "Batch Reformat Elements",
      body: `
        <p class="dialog-note" style="margin-top:0">Convert the current paragraph or batch-convert matching paragraphs across the screenplay.</p>
        <div class="field-grid">
          <label class="field"><span>Current Element</span><input type="text" readonly value="${escapeHtml(active ? active.type : "Action")}"></label>
          <label class="field"><span>Convert To Element</span><select id="reformatTargetSelect">${Object.keys(ELEMENTS)
            .map((t) => `<option value="${escapeHtml(t)}"${active && active.type === t ? " selected" : ""}>${escapeHtml(t)}</option>`)
            .join("")}</select></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Reformat Current Block",
          kind: "primary",
          onClick: () => {
            const target = $("#reformatTargetSelect", els.dialogBody).value;
            changeElementType(target);
            toast("Paragraph reformatted", `Changed to ${target}.`, "success", 1800);
          },
        },
      ],
    });
  }
  function openScriptCompareDialog() {
    const sample = sampleDocument();
    const currentLines = state.doc.paragraphs.map((p) => `[${p.type}] ${paragraphText(p)}`);
    const baselineLines = sample.paragraphs.map((p) => `[${p.type}] ${paragraphText(p)}`);
    const added = currentLines.filter((l) => !baselineLines.includes(l));
    const removed = baselineLines.filter((l) => !currentLines.includes(l));
    openDialog({
      eyebrow: "Tools · ScriptCompare",
      title: "ScriptCompare — Draft Diff Analysis",
      wide: true,
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:repeat(3,1fr);margin-bottom:12px">
          <div class="stat-card"><strong>${state.doc.paragraphs.length}</strong><span>Current Blocks</span></div>
          <div class="stat-card"><strong>+${added.length}</strong><span>Added / Modified</span></div>
          <div class="stat-card"><strong>-${removed.length}</strong><span>Removed vs Baseline</span></div>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;max-height:280px;overflow:auto">
          ${added
            .slice(0, 12)
            .map((line) => `<div class="shortcut-row" style="border-left:3px solid #107c41"><span>${escapeHtml(truncate(line, 86))}</span><kbd>ADDED</kbd></div>`)
            .join("")}
          ${removed
            .slice(0, 12)
            .map((line) => `<div class="shortcut-row" style="border-left:3px solid #c50f1f"><span>${escapeHtml(truncate(line, 86))}</span><kbd>REMOVED</kbd></div>`)
            .join("")}
          ${!added.length && !removed.length ? `<div class="shortcut-row"><span>Current script matches the baseline reference draft identically.</span><kbd>Identical</kbd></div>` : ""}
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
  }
  function openWritingStatsDialog() {
    const stats = getStats(state.doc);
    const pages = pageCount();
    const chars = getCharacters(state.doc);
    openDialog({
      eyebrow: "Tools · Productivity Analytics",
      title: "Writing Tracker & Session Statistics",
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:repeat(2,1fr);margin-bottom:14px">
          <div class="stat-card"><strong>${stats.words.toLocaleString()}</strong><span>Total Words</span></div>
          <div class="stat-card"><strong>${pages} / ${state.doc.settings.targetPages}</strong><span>Page Progress</span></div>
          <div class="stat-card"><strong>${stats.scenes}</strong><span>Total Scenes</span></div>
          <div class="stat-card"><strong>${chars.length}</strong><span>Speaking Cast</span></div>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Estimated Screen Time</span><kbd>~${stats.readingMinutes} min</kbd></div>
          <div class="shortcut-row"><span>Dialogue vs Action Balance</span><kbd>${Math.round((stats.dialogueWords / Math.max(1, stats.words)) * 100)}% Dialogue</kbd></div>
          <div class="shortcut-row"><span>Revised Blocks</span><kbd>${stats.revised}</kbd></div>
        </div>`,
      actions: [
        {
          label: "Launch Sprint Timer",
          onClick: () => toggleSprintWidget(true),
        },
        { label: "Done", kind: "primary" },
      ],
    });
  }
  function openAskFdDialog() {
    openDialog({
      eyebrow: "Help · Screenplay Help",      title: "Screenwriting & Formatting Assistant",
      body: `
        <label class="field"><span>Ask a question about screenplay format or Azkript tools</span><input id="askFdQuery" type="search" placeholder="e.g. How do I write a montage, dual dialogue, or intercut?"></label>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          <div class="shortcut-row"><span><strong>Dual Dialogue:</strong> Select a Character or Dialogue block and click Dual Dialogue (Ctrl+D) to place two speakers side by side.</span><kbd>Ctrl+D</kbd></div>
          <div class="shortcut-row"><span><strong>Alternate Dialogue:</strong> Click Alt Dialogue (+ Alt) in the Ribbon to store multiple takes inside any Dialogue block.</span><kbd>Alt Takes</kbd></div>
          <div class="shortcut-row"><span><strong>Beat Board → Script:</strong> Double-click anywhere on the Beat Board to create a beat, then click Send to Script to generate scenes.</span><kbd>Beat Board</kbd></div>
          <div class="shortcut-row"><span><strong>Production Tags:</strong> Open the Production tab or Navigator → Tags to tag Props, VFX, Stunts, Wardrobe, and Cast.</span><kbd>Breakdown</kbd></div>
          <div class="shortcut-row"><span><strong>Revision Mode:</strong> Turn on Revision Mode (Ctrl+Alt+V) to mark edited lines with industry-standard revision colors and asterisks.</span><kbd>Ctrl+Alt+V</kbd></div>
        </div>`,
      actions: [{ label: "Got it", kind: "primary" }],
    });
  }
  function openHighlightCharactersDialog() {
    const chars = getCharacters(state.doc);
    if (!state.doc.characterHighlights) state.doc.characterHighlights = {};
    openDialog({
      eyebrow: "View · Character Highlighting",
      title: "Highlight Characters in Script",
      body: `
        <p class="dialog-note" style="margin-top:0">Highlight specific characters' dialogue and cues directly on the screenplay page for table reads or dialogue polish.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${
            chars.length
              ? chars
                  .map((c) => {
                    const activeColor = state.doc.characterHighlights[c.name] || "";
                    return `<div class="shortcut-row">
                      <span style="display:inline-flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color)}"></span><strong>${escapeHtml(c.name)}</strong> (${c.speeches} speeches)</span>
                      <button type="button" class="switch ${activeColor ? "is-on" : ""}" data-hl-char="${escapeHtml(c.name)}" data-hl-color="${escapeHtml(c.color)}" role="switch" aria-checked="${Boolean(activeColor)}"><span></span></button>
                    </div>`;
                  })
                  .join("")
              : `<div class="shortcut-row"><span>No speaking characters found yet.</span></div>`
          }
        </div>`,
      actions: [
        {
          label: "Clear All Highlights",
          onClick: () => {
            state.doc.characterHighlights = {};
            markDirty();
            decorateEditor();
            toast("Highlights cleared", "All character highlights removed.", "info", 1800);
          },
        },
        { label: "Done", kind: "primary" },
      ],
    });
    $$("[data-hl-char]", els.dialogBody).forEach((sw) => {
      sw.addEventListener("click", () => {
        const name = sw.dataset.hlChar;
        const color = sw.dataset.hlColor || "#0f6cbd";
        if (state.doc.characterHighlights[name]) {
          delete state.doc.characterHighlights[name];
          sw.classList.remove("is-on");
        } else {
          state.doc.characterHighlights[name] = color;
          sw.classList.add("is-on");
        }
        markDirty();
        decorateEditor();
      });
    });
  }
  function openRenameCharacterDialog() {
    const chars = getCharacters(state.doc);
    openDialog({
      eyebrow: "Tools · Rename Character",
      title: "Batch Rename Character Across Script",
      body: `
        <div class="field-grid">
          <label class="field"><span>Existing Character</span><select id="renameFromSelect">${chars
            .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.speeches} speeches)</option>`)
            .join("")}</select></label>
          <label class="field"><span>New Character Name</span><input id="renameToInput" type="text" maxlength="80" placeholder="NEW NAME"></label>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Rename Everywhere",
          kind: "primary",
          onClick: () => {
            const fromName = $("#renameFromSelect", els.dialogBody)?.value;
            const toName = ($("#renameToInput", els.dialogBody)?.value || "").trim().toUpperCase();
            if (!fromName || !toName) return;
            let count = 0;
            state.doc.paragraphs.forEach((p) => {
              if (p.type === "Character") {
                const raw = paragraphText(p);
                const clean = raw.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
                if (clean === fromName.toUpperCase()) {
                  const extMatch = raw.match(/(\s*\([^)]*\)\s*)$/);
                  p.html = escapeHtml(toName + (extMatch ? extMatch[1] : ""));
                  count += 1;
                }
              }
            });
            markDirty();
            state.history.record();
            renderAll();
            toast("Character renamed", `Updated ${count} cues from ${fromName} to ${toName}.`, "success");
          },
        },
      ],
    });
  }
  function openNonSpeakingDialog() {
    if (!Array.isArray(state.doc.nonSpeaking)) state.doc.nonSpeaking = [];
    openDialog({
      eyebrow: "Cast · Non-Speaking Characters",
      title: "Non-Speaking Cast & Background Roles",
      body: `
        <div class="field-grid">
          <label class="field"><span>Character Name</span><input id="nsNameInput" type="text" placeholder="GUARD #1"></label>
          <label class="field"><span>Role / Description</span><input id="nsRoleInput" type="text" placeholder="Silent sentry at gate"></label>
        </div>
        <div class="shortcut-grid" style="grid-template-columns:1fr;margin-top:8px">
          ${
            state.doc.nonSpeaking.length
              ? state.doc.nonSpeaking
                  .map(
                    (ns, idx) =>
                      `<div class="shortcut-row"><span><strong>${escapeHtml(ns.name)}</strong> · ${escapeHtml(ns.notes || "Non-speaking")}</span><button type="button" class="pill-btn" data-del-ns="${idx}">Remove</button></div>`,
                  )
                  .join("")
              : `<div class="shortcut-row"><span>No non-speaking characters added yet.</span><kbd>0</kbd></div>`
          }
        </div>`,
      actions: [
        { label: "Close" },
        {
          label: "Add Non-Speaking Role",
          kind: "primary",
          onClick: () => {
            const name = ($("#nsNameInput", els.dialogBody).value || "").trim().toUpperCase();
            const notes = ($("#nsRoleInput", els.dialogBody).value || "").trim();
            if (!name) return;
            state.doc.nonSpeaking.push({ id: uid("ns"), name, notes, scenes: [1] });
            markDirty();
            state.history.record();
            renderCharacters();
            toast("Non-speaking role added", `${name} added to Cast list.`, "success");
          },
        },
      ],
    });
    $$("[data-del-ns]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.doc.nonSpeaking.splice(Number(btn.dataset.delNs), 1);
        markDirty();
        renderCharacters();
        openNonSpeakingDialog();
      });
    });
  }
  function openAssignVoicesDialog() {
    const chars = getCharacters(state.doc);
    const voices = getSpeechVoices();
    openDialog({
      eyebrow: "Tools · Speech Control",
      title: "Assign Voices for Table Read",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          ${
            chars.length
              ? chars
                  .map((c) => {
                    const cast = state.doc.cast[c.id] || {};
                    return `<div class="shortcut-row">
                      <span><strong>${escapeHtml(c.name)}</strong></span>
                      <select class="char-voice-select" data-char-voice="${escapeHtml(c.id)}">
                        <option value="">Auto voice</option>
                        ${voices
                          .map(
                            (v) =>
                              `<option value="${escapeHtml(v.voiceURI)}"${cast.voiceURI === v.voiceURI ? " selected" : ""}>${escapeHtml(v.name)}</option>`,
                          )
                          .join("")}
                      </select>
                    </div>`;
                  })
                  .join("")
              : `<div class="shortcut-row"><span>No speaking characters yet.</span></div>`
          }
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save Voice Assignments",
          kind: "primary",
          onClick: () => {
            $$("[data-char-voice]", els.dialogBody).forEach((sel) => {
              const id = sel.dataset.charVoice;
              state.doc.cast[id] = { ...(state.doc.cast[id] || {}), voiceURI: sel.value };
            });
            markDirty();
            renderCharacters();
            toast("Voices assigned", "Character voices updated for Table Read.", "success");
          },
        },
      ],
    });
  }
  function openLockPagesDialog() { return productionUI?.locking(); }
  function openParagraphFormatDialog() {
    const active = activeParagraph() || state.doc.paragraphs[0];
    if (!active) return;
    openDialog({
      eyebrow: "Format · Alignment & Spacing",
      title: `Format Paragraph (${active.type})`,
      body: `
        <div class="field-grid">
          <label class="field"><span>Alignment</span><select id="pfAlign"><option value="">Element Default</option><option value="left"${active.alignment === "left" ? " selected" : ""}>Left</option><option value="center"${active.alignment === "center" ? " selected" : ""}>Center</option><option value="right"${active.alignment === "right" ? " selected" : ""}>Right</option></select></label>
          <label class="field"><span>Line Spacing</span><select id="pfSpacing"><option value="1"${active.spacing === "1" ? " selected" : ""}>Single (1.0)</option><option value="1.5"${active.spacing === "1.5" ? " selected" : ""}>1.5 Lines</option><option value="2"${active.spacing === "2" ? " selected" : ""}>Double (2.0)</option></select></label>
        </div>
        <div class="setting-line"><div><strong>Force Page Break Before</strong><span>Start this paragraph at the top of a new page.</span></div><button type="button" class="switch ${active.pageBreakBefore ? "is-on" : ""}" id="pfPageBreak" role="switch" aria-checked="${Boolean(active.pageBreakBefore)}"><span></span></button></div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            active.alignment = $("#pfAlign", els.dialogBody).value;
            active.spacing = $("#pfSpacing", els.dialogBody).value;
            active.pageBreakBefore = $("#pfPageBreak", els.dialogBody).classList.contains("is-on");
            const el = paragraphElement(active.id);
            if (el) {
              el.style.textAlign = active.alignment || "";
            }
            state.layoutDirty = true;
            markDirty();
            state.history.record();
            decorateEditor();
            toast("Paragraph formatted", "Custom alignment and spacing applied.", "success", 1800);
          },
        },
      ],
    });
    bindDialogSwitch("pfPageBreak");  }
  function openEmojiDialog() {
    const symbols = ["🎬", "🎥", "⭐", "🔥", "⚡", "💡", "📌", "🎵", "☎️", "✉️", "🔒", "⏱️", "✓", "✗", "—", "…", "§", "©", "®", "™"];
    openDialog({
      eyebrow: "Insert · Emoji & Symbols",
      title: "Insert Symbol or Emoji",
      body: `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${symbols
        .map(
          (sym) =>
            `<button type="button" class="pill-btn" data-insert-sym="${escapeHtml(sym)}" style="justify-content:center;font-size:18px;padding:10px">${escapeHtml(sym)}</button>`,
        )
        .join("")}</div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-insert-sym]", els.dialogBody).forEach((btn) => {
      btn.addEventListener("click", () => {
        const sym = btn.dataset.insertSym;
        closeDialog();
        const active = activeParagraph();
        if (active) {
          active.html = `${active.html || ""}${escapeHtml(sym)}`;
          const el = paragraphElement(active.id);
          if (el) el.innerHTML = active.html;
          markDirty();
          state.history.record();
        }
      });
    });
  }
  function insertPageBreak() {
    const active = activeParagraph();
    if (!active) return;
    active.pageBreakBefore = !active.pageBreakBefore;
    state.layoutDirty = true;
    markDirty();
    state.history.record();
    decorateEditor();
    toast(
      active.pageBreakBefore ? "Page Break inserted" : "Page Break removed",
      active.pageBreakBefore ? "This paragraph will begin on a new page." : "Automatic page flow restored.",
      "info",
      2000,
    );
  }
  function insertImageMarker() {
    openDialog({
      eyebrow: "Insert · Script Image",
      title: "Insert Storyboard / Reference Image",
      body: `
        <label class="field"><span>Image Caption / Visual Reference</span><input id="imgCaptionInput" type="text" placeholder="Storyboard Frame 14 — Beacon Array"></label>
        <label class="field"><span>Image URL or Local Asset Path (optional)</span><input id="imgUrlInput" type="text" placeholder="https://…"></label>
        <p class="dialog-note">This adds a caption and file reference. To embed an image, use Story studio → Storyboard and animatic.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Insert Image Block",
          kind: "primary",
          onClick: () => {
            const caption = $("#imgCaptionInput", els.dialogBody).value.trim() || "Visual Reference";
            const active = activeParagraph();
            const index = active ? state.doc.paragraphs.indexOf(active) + 1 : state.doc.paragraphs.length;
            const p = createParagraph("Action", escapeHtml(`[IMAGE: ${caption}]`), {
              image: { caption, url: $("#imgUrlInput", els.dialogBody).value.trim() },
            });
            state.doc.paragraphs.splice(index, 0, p);
            markDirty();
            state.history.record();
            renderAll();
            toast("Image reference inserted", caption, "success", 2000);
          },
        },
      ],
    });
  }
  function exportFountainOrText(format = "txt") {
    const lines = [];
    lines.push(`Title: ${state.doc.title || "Untitled Screenplay"}`);
    lines.push(`Author: ${state.doc.author || ""}`);
    lines.push("");
    state.doc.paragraphs.forEach((p) => {
      const text = paragraphText(p);
      if (format === "fountain") {
        if (p.type === "Scene Heading") lines.push(`\n.${text.toUpperCase()}`);
        else if (p.type === "Character") lines.push(`\n@${text.toUpperCase()}`);
        else if (p.type === "Transition") lines.push(`\n> ${text.toUpperCase()}`);
        else lines.push(text);
      } else {
        lines.push(p.type === "Character" || p.type === "Dialogue" ? `    ${text}` : text);
      }
    });
    const ext = format === "fountain" ? "fountain" : "txt";
    const filename = `${(state.doc.title || "screenplay").replace(/[<>:"/\\|?*]/g, "").trim() || "screenplay"}.${ext}`;
    FDX.download(filename, lines.join("\n"), "text/plain;charset=utf-8");
    toast(`Exported .${ext.toUpperCase()}`, `${filename} downloaded.`, "success");
  }
  function toggleSprintWidget(force) {
    const widget = $("#sprintWidget");
    if (!widget) return;
    const open = typeof force === "boolean" ? force : widget.hidden;
    widget.hidden = !open;
    /* Track real visibility in state. The ribbon button's active state is
     * `state.sprint.open || state.sprint.running`, and `sprint.open` was never
     * assigned anywhere, so closing the panel during a run left the button lit
     * with the timer still counting — and clicking that lit button reopened the
     * panel instead of stopping the sprint. */
    state.sprint.open = open;
    if (open) updateSprintUI();
    syncRibbon();
  }
  function updateSprintUI() {
    const clock = $("#sprintClock");
    const toggleBtn = $("#sprintToggleBtn");
    const deltaEl = $("#sprintWordDelta");
    if (clock) {
      const m = Math.floor(state.sprint.remainingSec / 60);
      const s = state.sprint.remainingSec % 60;
      clock.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if (toggleBtn) {
      toggleBtn.textContent = state.sprint.running ? "Pause" : "Start";
    }
    /* The word delta is the panel's main feedback signal; it had no writer at
     * all, so it read "+0 words this sprint" no matter how much was typed.
     * Before a sprint has ever run, startWords is 0 and the delta would show
     * the whole document's word count, which is meaningless — show nothing
     * until the sprint actually begins. */
    if (deltaEl) {
      if (!state.sprint.startWords) {
        deltaEl.textContent = state.sprint.running ? "Counting words…" : "Words written this sprint";
      } else {
        const written = Math.max(0, getStats(state.doc).words - state.sprint.startWords);
        deltaEl.textContent = `+${written.toLocaleString()} ${written === 1 ? "word" : "words"} this sprint`;
      }
    }
    syncRibbon();
  }
  function startOrPauseSprint() {
    if (state.sprint.running) {
      clearInterval(state.sprint.timer);
      state.sprint.running = false;
      updateSprintUI();
      return;
    }
    const stats = getStats(state.doc);
    if (!state.sprint.startWords) state.sprint.startWords = stats.words;
    state.sprint.running = true;
    updateSprintUI();
    state.sprint.timer = setInterval(() => {
      state.sprint.remainingSec = Math.max(0, state.sprint.remainingSec - 1);
      updateSprintUI();
      if (state.sprint.remainingSec <= 0) {
        clearInterval(state.sprint.timer);
        state.sprint.running = false;
        updateSprintUI();
        const delta = Math.max(0, getStats(state.doc).words - state.sprint.startWords);
        toast("Writing Sprint Complete!", `You wrote ${delta} new words during this sprint.`, "success", 5000);
      }
    }, 1000);
  }
  function resetSprint() {
    clearInterval(state.sprint.timer);
    state.sprint.running = false;
    const durSelect = $("#sprintDurationSelect");
    const mins = Number(durSelect?.value) || 25;
    state.sprint.durationSec = mins * 60;
    state.sprint.remainingSec = mins * 60;
    state.sprint.startWords = getStats(state.doc).words;
    updateSprintUI();
  }
  /* ================================================================== */
  /* Fluent ribbon — data-driven tab deck                                */
  /* ================================================================== */
  const RIBBON_TAB_DEFS = [
    { id: "home", label: "Home" },
    { id: "file", label: "File" },
    { id: "edit", label: "Edit" },
    { id: "view", label: "View" },
    { id: "format", label: "Format" },
    { id: "insert", label: "Insert" },
    { id: "document", label: "Document" },
    { id: "tools", label: "Tools" },
    { id: "production", label: "Production" },
    { id: "help", label: "Help" },
  ];
  const RIBBON_FONTS = SCRIPT_FONT_CHOICES.map((choice) => choice.value);  const RIBBON_FONT_LABELS = Object.fromEntries(    SCRIPT_FONT_CHOICES.map((choice) => [choice.value, choice.label]),  );  const RIBBON_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24];
  const RIBBON_TEXT_COLORS = [
    { label: "Ink", value: "#171614" },
    { label: "Graphite", value: "#3d3d3a" },
    { label: "Slate", value: "#5c6670" },
    { label: "Cobalt", value: "#0f6cbd" },
    { label: "Violet", value: "#6b48a8" },
    { label: "Teal", value: "#03787c" },
    { label: "Forest", value: "#2f7426" },
    { label: "Amber", value: "#c2500e" },
    { label: "Crimson", value: "#b8252a" },
    { label: "Rose", value: "#c30f6b" },
    { label: "Default", value: "" },
  ];
  const RIBBON_HIGHLIGHTS = [
    { label: "Butter", value: "#ffe9a3" },
    { label: "Azkript yellow", value: "#ffd400" },
    { label: "Mint", value: "#c8f7c5" },
    { label: "Sky", value: "#cfe6ff" },
    { label: "Lavender", value: "#e4d6ff" },
    { label: "Rose", value: "#ffd3df" },
    { label: "Peach", value: "#ffdfc4" },
    { label: "Clear", value: "" },
  ];
  const RIBBON_COLORS = {
    connection: [
      { label: "Cobalt", value: "#0f6cbd" },
      { label: "Violet", value: "#6b48a8" },
      { label: "Teal", value: "#03787c" },
      { label: "Amber", value: "#c2500e" },
      { label: "Crimson", value: "#b8252a" },
      { label: "Charcoal", value: "#4b4c50" },
    ],
  };
  /* Item factories keep the model compact and consistent. */
  const rb = {
    large: (command, label, iconName, extra = {}) => ({
      kind: "large",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    small: (command, label, iconName, extra = {}) => ({
      kind: "small",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    icon: (command, label, iconName, extra = {}) => ({
      kind: "icon",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    toggle: (command, label, iconName, extra = {}) => ({
      kind: "small",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      toggle: true,
      ...extra,
    }),
    iconToggle: (command, label, iconName, extra = {}) => ({
      kind: "icon",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      toggle: true,
      ...extra,
    }),
    combo: (combo, extra = {}) => ({ kind: "combo", combo, ...extra }),
    split: (command, label, iconName, menu, extra = {}) => ({
      kind: "split",
      command,
      label,
      icon: iconName,
      menu,
      tip: extra.tip || label,
      ...extra,
    }),
    iconSplit: (command, label, iconName, menu, extra = {}) => ({
      kind: "split",
      command,
      label,
      icon: iconName,
      menu,
      iconOnly: true,
      tip: extra.tip || label,
      ...extra,
    }),
    col: (...items) => ({ kind: "col", items }),
    sep: () => ({ kind: "sep" }),
  };
  const RIBBON_MODEL = {
    home: [
      {
        label: "Proofing",
        rows: [
          [
            rb.col(
              rb.small("tools-spelling", "Spelling", "check-circle", { tip: "Check spelling of the document (F7)" }),
              rb.small("tools-thesaurus", "Thesaurus", "book", { tip: "Look up synonyms (Shift+F7)" }),
            ),
          ],
        ],
      },
      {
        label: "Clipboard",
        rows: [
          [
            rb.large("edit-paste", "Paste", "clipboard", { split: "paste", tip: "Paste from the clipboard" }),
            rb.col(
              rb.small("edit-cut", "Cut", "scissors", { tip: "Cut the selection (Ctrl+X)" }),
              rb.small("edit-copy", "Copy", "copy", { tip: "Copy the selection (Ctrl+C)" }),
            ),
          ],
        ],
      },
      {
        label: "Font",
        rows: [
          [
            rb.icon("format-bold", "Bold", "bold", { format: "bold", cls: "format-btn", tip: "Bold (Ctrl+B)" }),
            rb.icon("format-italic", "Italic", "italic", { format: "italic", cls: "format-btn", tip: "Italic (Ctrl+I)" }),
            rb.icon("format-underline", "Underline", "underline", { format: "underline", cls: "format-btn", tip: "Underline (Ctrl+U)" }),
            rb.icon("format-strike", "Strike Out", "strike", { format: "strikeThrough", cls: "format-btn", tip: "Strike out the selection (Ctrl+Shift+X)" }),
            rb.iconToggle("format-allcaps", "ALL CAPS", "case", { tip: "Set or unset the all-capitals style" }),
            rb.sep(),
            rb.iconSplit("format-highlight", "Highlighter", "highlight", "highlight", { tip: "Highlight the selected text" }),
            rb.iconSplit("format-text-color", "Text Color", "text-color", "text-color", { tip: "Change the color of the selected text" }),
          ],
        ],
      },
      {
        label: "Insert",
        rows: [
          [
            rb.large("insert-scriptnote", "ScriptNote", "note", { tip: "Insert a ScriptNote (Ctrl+Shift+N)" }),
            rb.col(
              rb.small("insert-bookmark", "Bookmark", "bookmark", { tip: "Insert a bookmark" }),
              rb.small("insert-image", "Image", "image", { tip: "Insert a storyboard / reference image" }),
              rb.small("insert-pagebreak", "Page break", "page-break", { tip: "Toggle a page break before this paragraph" }),
              rb.small("insert-emoji", "Emoji", "emoji", { tip: "Insert emoji & symbols" }),
            ),
          ],
        ],
      },
      {
        label: "Script Elements",
        rows: [
          [rb.combo("element", { tip: "Change the element of the current paragraph" })],
          [
            rb.small("format-element-settings", "Elements Settings", "sliders", { tip: "Edit element indents, spacing and styles" }),
            rb.small("format-dual", "Dual Dialogue", "dual", { tip: "Toggle dual dialogue (Ctrl+D)" }),
          ],
        ],
      },
      {
        label: "Title Page",
        rows: [[rb.large("doc-title-page", "Open", "title", { tip: "Show or hide the title page" })]],
      },
      {
        label: "Views",
        rows: [
          [
            rb.small("view-normal", "Script", "script", { tip: "Switch to the continuous script view" }),
            rb.small("view-scene", "Scene View", "table", { tip: "Open the scene table" }),
            rb.small("view-cards-summary", "Index Cards", "grid", { tip: "Open Index Cards" }),
            rb.small("view-beatboard", "Beat Board", "board", { tip: "Open the Beat Board" }),
          ],
          [
            rb.iconToggle("view-toggle-outline", "Hide Outline Editor", "scene", { tip: "Show or hide the Outline Editor" }),
            rb.iconToggle("view-toggle-outline-script", "Hide Outline in Script", "structure", { tip: "Show or hide the outline inside the script" }),
            rb.iconToggle("view-toggle-navigator", "Show Navigator", "panel", { tip: "Show or hide the navigator panel" }),
          ],
        ],
      },
      {
        label: "Split",
        rows: [
          [
            rb.icon("view-split-off", "Unsplit", "unsplit", { tip: "Close the split view" }),
            rb.icon("view-split-v", "Vertically", "split", { tip: "Split vertically" }),
            rb.icon("view-split-h", "Horizontally", "split-h", { tip: "Split horizontally" }),
            rb.icon("view-split-swap", "Swap", "replace", { tip: "Swap the split panes" }),
          ],
        ],
      },
    ],
    file: [
      {
        label: "Document safety",
        rows: [[rb.small("file-compatibility", "Compatibility", "check-circle", { tip: "Review file preservation and exchange limitations" }),
          rb.small("file-history", "Version history", "backup", { tip: "Compare and restore earlier versions" }),
          rb.small("file-disk-status", "File status", "folder", { tip: "Compare changes made outside this editor" })]],
      },
      {
        label: "File",
        rows: [
          [
            rb.large("file-new", "New", "plus", { tip: "New screenplay (Ctrl+N)" }),
            rb.large("file-new-template", "New from Template", "template", { tip: "Start from a template in the Start Center" }),
            rb.large("file-open", "Open", "folder", { tip: "Open an FDX screenplay (Ctrl+O)" }),
            rb.large("file-close", "Close", "close", { tip: "Close this document" }),
          ],
        ],
      },
      {
        label: "Saving",
        rows: [
          [
            rb.large("file-save", "Save", "save", { tip: "Save (Ctrl+S)" }),
            rb.large("file-save-as", "Save As", "save", { tip: "Save with a new name (Ctrl+Shift+S)" }),
            rb.large("file-save-pdf", "Save as PDF", "pdf", { tip: "Save a paginated PDF" }),
            rb.large("file-save-template", "Save as Template", "template", { tip: "Save this document as an FDXT template" }),
            rb.split("file-export", "Export", "download", "file-export", { large: true, tip: "Export FDX, PDF, Fountain or Beat Board" }),
            rb.col(
              rb.small("file-revert", "Revert", "revert", { tip: "Revert to the last saved version" }),
              rb.small("file-backup", "Backup", "backup", { tip: "Create a backup copy" }),
            ),
          ],
        ],
      },
      {
        label: "Printing",
        rows: [
          [
            rb.large("file-print-preview", "Print Preview", "print", { tip: "Preview printable pages" }),
            rb.large("file-print", "Print", "print", { tip: "Print (Ctrl+P)" }),
          ],
        ],
      },
      {
        label: "Register",
        rows: [[rb.large("file-wga", "Register WGA", "register", { tip: "Prepare WGA registration details" })]],
      },
    ],
    edit: [
      {
        label: "Undo",
        rows: [
          [
            rb.large("edit-undo", "Undo", "undo", { tip: "Undo (Ctrl+Z)" }),
            rb.large("edit-redo", "Redo", "redo", { tip: "Redo (Ctrl+Y)" }),
          ],
        ],
      },
      {
        label: "Clipboard",
        rows: [
          [
            rb.large("edit-paste", "Paste", "clipboard", { split: "paste", tip: "Paste from the clipboard" }),
            rb.col(
              rb.small("edit-cut", "Cut", "scissors", { tip: "Cut (Ctrl+X)" }),
              rb.small("edit-copy", "Copy", "copy", { tip: "Copy (Ctrl+C)" }),
            ),
          ],
        ],
      },
      {
        label: "Editing",
        rows: [
          [
            rb.large("edit-delete", "Delete", "trash", { tip: "Delete the selection or paragraph" }),
            rb.col(
              rb.small("edit-select-all", "Select all", "select-all", { tip: "Select the whole scene (Ctrl+A)" }),
              rb.small("edit-select-scene", "Select scene", "scene", { tip: "Select the current scene" }),
              rb.small("edit-rename-character", "Rename character", "rename", { tip: "Rename a character everywhere" }),
              rb.small("edit-nonspeaking", "Non-speaking", "nonspeaking", { tip: "Manage non-speaking characters" }),
            ),
          ],
        ],
      },
      {
        label: "Find",
        rows: [
          [
            rb.large("edit-find", "Find & Replace", "search", { tip: "Find and replace (Ctrl+F)" }),
            rb.col(
              rb.small("edit-find-selection", "Find selection", "find-selection", { tip: "Find the selected text" }),
              rb.small("edit-goto", "Go to…", "target", { tip: "Go to a page, scene or bookmark (Ctrl+G)" }),
            ),
          ],
        ],
      },
      {
        label: "Tracking",
        rows: [
          [
            rb.toggle("edit-track-changes", "Track Changes", "track", { tip: "Track edits so they can be accepted or rejected" }),
            rb.col(
              rb.small("edit-accept-change", "Accept change", "check-circle", { tip: "Accept the tracked change in this paragraph" }),
              rb.small("edit-reject-change", "Reject change", "reject", { tip: "Reject the tracked change in this paragraph" }),
            ),
            rb.col(
              rb.icon("edit-prev-change", "Previous change", "prev", { tip: "Previous tracked change" }),
              rb.icon("edit-next-change", "Next change", "next", { tip: "Next tracked change" }),
            ),
          ],
        ],
      },
      {
        label: "Emoji",
        rows: [[rb.large("edit-emoji", "Emoji & Symbols", "emoji", { tip: "Insert emoji and symbols" })]],
      },
    ],
    view: [
      { label: "Writing environment", rows: [[rb.small("view-writing-reliability", "Typography & access", "sliders", { tip: "Font availability, document typography and interface scaling" })]] },
      {
        label: "Views",
        rows: [
          [
            rb.large("view-normal", "Normal", "script", { tip: "Continuous script view" }),
            rb.large("view-page", "Page", "page", { tip: "Paginated page view" }),
            rb.large("view-speed", "Speed", "eye", { tip: "Compact speed view" }),
            rb.col(
              rb.small("view-scene", "Scene view", "table", { tip: "Scene table" }),
              rb.small("view-cards-summary", "Index cards", "grid", { tip: "Index cards" }),
              rb.small("view-beatboard", "Beat board", "board", { tip: "Beat board" }),
            ),
          ],
        ],
      },
      {
        label: "Show / Hide",
        rows: [
          [
            rb.iconToggle("view-toggle-outline", "Outline editor", "scene", { tip: "Show / hide the Outline Editor timeline" }),
            rb.iconToggle("view-toggle-outline-script", "Outline in script", "script", { tip: "Show / hide the outline inside the script view" }),
            rb.iconToggle("view-toggle-structure", "Structure lines", "structure", { tip: "Show / hide structure metadata under scene headings" }),
            rb.iconToggle("view-toggle-alts", "Alternate dialogue", "dual", { tip: "Show / hide alternate dialogue badges" }),
          ],
          [
            rb.iconToggle("view-toggle-scriptnotes", "ScriptNotes", "note", { tip: "Show / hide ScriptNote badges" }),
            rb.iconToggle("view-toggle-ruler", "Ruler", "ruler", { tip: "Show / hide the horizontal ruler" }),
            rb.iconToggle("view-toggle-invisibles", "Invisibles", "eye", { tip: "Show / hide invisible characters" }),
            rb.iconToggle("view-toggle-navigator", "Navigator", "panel", { tip: "Show / hide the navigator panel" }),
          ],
        ],
      },
      {
        label: "Split",
        rows: [
          [
            rb.icon("view-split-off", "Unsplit", "unsplit", { tip: "Close the split view" }),
            rb.icon("view-split-v", "Split vertically", "split", { tip: "Split the editor vertically" }),
            rb.icon("view-split-h", "Split horizontally", "split-h", { tip: "Split the editor horizontally" }),
            rb.icon("view-split-swap", "Swap panes", "replace", { tip: "Swap the split panes" }),
          ],
        ],
      },
      {
        label: "Window",
        rows: [
          [
            rb.col(
              rb.small("view-arrange-docs", "Arrange documents", "window", { tip: "Arrange the workspace for reference" }),
              rb.small("view-open-docs", "Open documents", "folder", { tip: "Open a recent document" }),
              rb.small("view-classic", "Classic view", "classic", { tip: "Collapse the ribbon to a classic workspace" }),
            ),
          ],
        ],
      },
      {
        label: "Zoom",
        rows: [
          [rb.combo("zoom", { className: "rb-combo--narrow", tip: "Editor zoom" }), rb.icon("view-zoom-out", "Zoom out", "zoom-out", { tip: "Zoom out" }), rb.icon("view-zoom-in", "Zoom in", "zoom-in", { tip: "Zoom in" })],
          [rb.small("view-zoom-outline", "Zoom Outline", "target", { tip: "Fit the outline editor to the workspace" })],
        ],
      },
      {
        label: "Typewriter Mode",
        rows: [[rb.combo("typewriter", { className: "rb-combo--wide", tip: "Keep the active line centered" })]],
      },
      {
        label: "Appearance",
        rows: [
          [
            rb.col(
              rb.toggle("view-appearance-day", "Day", "sun", { tip: "Day mode" }),
              rb.toggle("view-appearance-night", "Night", "moon", { tip: "Night mode" }),
              rb.toggle("view-appearance-midnight", "Midnight", "midnight", { tip: "Midnight mode" }),
            ),
          ],
        ],
      },
    ],
    format: [
      {
        label: "Elements",
        rows: [
          [rb.combo("element", { tip: "Current script element" })],
          [
            rb.small("format-element-settings", "Elements Settings", "sliders", { tip: "Indents, spacing and styles" }),
            rb.small("format-dual", "Dual Dialogue", "dual", { tip: "Toggle dual dialogue" }),
            rb.small("format-cast-list", "Cast List Options", "users", { tip: "Manage the cast list and actor fields" }),
          ],
        ],
      },
      {
        label: "Characters",
        rows: [[rb.large("format-highlight-characters", "Highlight Characters", "highlight", { tip: "Assign a color to each speaking character" })]],
      },
      {
        label: "Text",
        rows: [
          [rb.combo("font", { className: "rb-combo--wide", tip: "Script font" }), rb.combo("size", { className: "rb-combo--size", tip: "Font size" })],
          [
            rb.icon("format-bold", "Bold", "bold", { format: "bold", cls: "format-btn", tip: "Bold (Ctrl+B)" }),
            rb.icon("format-italic", "Italic", "italic", { format: "italic", cls: "format-btn", tip: "Italic (Ctrl+I)" }),
            rb.icon("format-underline", "Underline", "underline", { format: "underline", cls: "format-btn", tip: "Underline (Ctrl+U)" }),
            rb.icon("format-strike", "Strikethrough", "strike", { format: "strikeThrough", cls: "format-btn", tip: "Strikethrough" }),
            rb.icon("format-case", "Toggle CASE", "case", { tip: "Cycle UPPER / lower / Title case" }),
            rb.iconToggle("format-allcaps", "ALL CAPS", "case", { tip: "Set or unset the all-capitals style" }),
            rb.iconSplit("format-text-color", "Text color", "text-color", "text-color", { tip: "Text color" }),
            rb.iconSplit("format-highlight", "Highlighter", "highlight", "highlight", { tip: "Highlighter color" }),
          ],
        ],
      },
      {
        label: "Paragraph",
        rows: [
          [rb.combo("align", { tip: "Alignment" }), rb.combo("spacing", { tip: "Line spacing" })],
          [rb.combo("space-before", { className: "rb-combo--narrow", tip: "Space before" }), rb.combo("leading", { className: "rb-combo--narrow", tip: "Leading" })],
          [rb.small("format-revert-paragraph", "Revert paragraph", "revert", { tip: "Revert to the element defaults" }), rb.small("format-page-break", "Page break", "page-break", { tip: "Force a page break before the paragraph" })],
        ],
      },
      {
        label: "Beat Board",
        rows: [
          [
            rb.split("format-beat-align", "Align", "align", "beat-align", { tip: "Align beats on the board" }),
            rb.toggle("format-beat-connect", "Connect", "connect", { tip: "Connect beats with story arrows" }),
            rb.toggle("format-beat-disconnect", "Disconnect", "disconnect", { tip: "Remove the selected connection" }),
          ],
          [
            rb.toggle("format-beat-snap", "Grid snap", "grid-snap", { tip: "Snap beats to the 24px grid" }),
            rb.iconSplit("format-beat-connection-color", "Connection color", "connection-color", "connection-color", { tip: "Connection color" }),
            rb.combo("beat-selected", { className: "rb-combo--wide", tip: "Select a beat" }),
          ],
        ],
      },
    ],
    insert: [
      {
        label: "Insert",
        rows: [
          [
            rb.large("insert-scriptnote", "ScriptNote", "note", { tip: "Insert a ScriptNote (Ctrl+Shift+N)" }),
            rb.large("insert-bookmark", "Bookmark", "bookmark", { tip: "Insert a bookmark" }),
            rb.large("insert-label", "Label", "tag", { tip: "Insert a production label" }),
            rb.large("insert-image", "Image", "image", { tip: "Insert a storyboard / reference image" }),
            rb.large("insert-pagebreak", "Page Break", "page-break", { tip: "Toggle a page break before this paragraph" }),
            rb.large("insert-nonspeaking", "Non-Speaking", "nonspeaking", { tip: "Manage non-speaking characters" }),
            rb.large("insert-alt-add", "Add Alt", "plus", { tip: "Add an alternate dialogue take" }),
            rb.large("insert-alt-remove", "Remove Alt", "minus", { tip: "Remove the active alternate take" }),
            rb.large("insert-beat", "New Beat", "board", { tip: "Add a beat on the Beat Board" }),
          ],
        ],
      },
      {
        label: "Scenes",
        rows: [
          [
            rb.large("insert-scene", "New Scene", "scene", { tip: "Insert a new scene (Ctrl+Enter)" }),
            rb.large("insert-send-to-script", "Send to Script", "script", { tip: "Send cards or beats into the script" }),
          ],
        ],
      },
    ],
    document: [
      {
        label: "Page Setup",
        rows: [
          [
            rb.large("doc-title-page", "Title Page", "title", { tip: "Edit the title page" }),
            rb.large("doc-header-footer", "Header & Footer", "page", { tip: "Header and footer text" }),
            rb.large("doc-page-layout", "Page Layout", "sliders", { tip: "Page size, margins and numbering" }),
            rb.large("doc-mores", "Mores and Continueds", "align", { tip: "Customize (MORE), (CONT'D) and continued lines" }),
            rb.large("doc-watermark", "Watermark", "water", { tip: "Add a page watermark" }),
          ],
        ],
      },
      {
        label: "Extras",
        rows: [
          [
            rb.large("doc-smarttype", "SmartType", "sparkle", { tip: "SmartType completion lists" }),
            rb.large("doc-macros", "Macros", "macros", { tip: "Manage text macros" }),
            rb.large("doc-bookmarks", "Bookmarks", "bookmark", { tip: "Jump to or manage bookmarks" }),
          ],
        ],
      },
      {
        label: "Length",
        rows: [
          [
            rb.large("doc-target-length", "Target Script Length", "target", { tip: "Set the page goal for this draft" }),
            rb.small("doc-details", "Document details", "info", { tip: "Document details and metadata" }),
          ],
        ],
      },
    ],
    tools: [
      {
        label: "Proofing",
        rows: [
          [
            rb.large("tools-spelling", "Spelling", "check-circle", { tip: "Spelling and proofing (F7)" }),
            rb.large("tools-thesaurus", "Thesaurus", "book", { tip: "Thesaurus (Shift+F7)" }),
          ],
        ],
      },
      {
        label: "Speech Control",
        rows: [
          [
            rb.large("tools-play", "Play", "play", { tip: "Start the table read" }),
            rb.large("tools-stop", "Stop", "stop", { tip: "Stop the table read" }),
            rb.large("tools-assign-voices", "Assign Voices", "users", { tip: "Assign a voice to each character" }),
            rb.col(
              rb.icon("tools-rewind", "Rewind", "rewind", { tip: "Previous speech block" }),
              rb.icon("tools-forward", "Fast forward", "forward", { tip: "Next speech block" }),
            ),
          ],
        ],
      },
      {
        label: "Tools",
        rows: [
          [
            rb.large("tools-collaboration", "Collaboration Files", "collab", { tip: "Share and merge screenplay files" }),
            rb.split("tools-combine-reports", "Combine Reports", "combine", "combine-reports", { large: true, tip: "Combine script reports" }),
            rb.large("tools-format-assistant", "Format Assistant", "check-circle", { tip: "Check screenplay formatting" }),
            rb.large("tools-script-compare", "Script Compare", "compare", { tip: "Compare two drafts" }),
            rb.large("tools-reformat", "Reformat", "refresh", { tip: "Reformat the current element" }),
            rb.large("tools-writing-stats", "Writing Stats", "chart", { tip: "Writing statistics and tracker" }),
            /* These five secondary tools used to be a SECOND ROW under the six large
             * buttons. That stack needs 66 + 3 + 23 = 92px, but the body only gets
             * 81px inside the ribbon's fixed 104px track, so it overflowed and the
             * bottom row's labels sat on the "TOOLS" caption (measured: content 91px
             * in an 81px box, deepest control 3px past the caption's top edge).
             * As a `.ribbon-col` beside the large buttons it costs one row of height
             * instead of two: five 23px buttons in a 2-column grid are 3 rows = 73px,
             * which fits, and the group keeps its place on a single ribbon row. */
            rb.col(
              rb.small("tools-names", "Names Database", "names", { tip: "Browse the character name database" }),
              rb.small("tools-show-navigator", "Show Navigator", "panel", { tip: "Show the navigator" }),
              rb.small("tools-sprint", "Sprint Timer", "timer", { tip: "Start the sprint timer" }),
              rb.small("tools-options", "Options", "settings", { tip: "Azkript settings" }),
              rb.small("tools-ask", "Ask Azkript", "sparkle", { tip: "Ask the writing assistant" }),
            ),
          ],
        ],
      },
    ],
    production: [
      {
        label: "Scenes",
        rows: [
          [
            rb.large("prod-scene-numbers", "Scene Numbers", "scene-number", { toggle: true, tip: "Show or hide scene numbers" }),
            rb.large("prod-edit-scene-number", "Edit Scene Number", "pencil", { tip: "Override the current scene number" }),
            rb.large("prod-omit-scene", "Omit Scene", "eye-off", { tip: "Omit or restore the current scene" }),
          ],
        ],
      },
      {
        label: "Revisions",
        rows: [
          [
            rb.large("prod-revisions-setup", "Revisions Setup", "revision", { tip: "Open the revision manager" }),
            rb.large("prod-revision-mode", "Revision Mode", "revision", { toggle: true, tip: "Toggle revision marking" }),
            rb.large("prod-mark-revised", "Mark Revised", "pencil", { tip: "Mark the current paragraph in the revision color" }),
            rb.large("prod-clear-revised", "Clear Revised", "close", { tip: "Clear the revision mark on the current paragraph" }),
            rb.col(
              rb.small("prod-prev-revision", "Previous revision", "prev", { tip: "Go to the previous revision set" }),
              rb.small("prod-next-revision", "Next revision", "next", { tip: "Start the next revision set" }),
            ),
          ],
        ],
      },
      {
        label: "Locked Pages",
        rows: [
          [
            rb.large("prod-lock-pages", "Lock Pages", "lock", { tip: "Lock pages for production" }),
            rb.col(
              rb.small("prod-unlock-a-pages", "Unlock A pages", "unlock", { tip: "Unlock all A-pages" }),
              rb.small("prod-unlock-all-pages", "Unlock all pages", "unlock", { tip: "Remove every page lock" }),
            ),
            rb.split("prod-locking-tools", "Locking Tools", "lock", "locking-tools", { tip: "Page locking tools" }),
          ],
        ],
      },
      {
        label: "Tags",
        rows: [
          [
            rb.large("prod-tags-mode", "Tags Mode", "tag", { toggle: true, tip: "Show production tags in the script" }),
            rb.large("prod-tag-all", "Tag All Characters", "users", { tip: "Tag every speaking character" }),
          ],
        ],
      },
    ],
    help: [
      {
        label: "Help",
        rows: [
          [
            rb.large("help-guide", "User Guide", "book", { tip: "Keyboard shortcuts and workflow guide" }),
            rb.large("help-welcome", "Welcome", "welcome", { tip: "Welcome to Azkript" }),
            rb.large("help-whats-new", "What's New", "sparkle", { tip: "What's new in this build" }),
            rb.large("help-get-help", "Get Help", "help", { tip: "Open the help guide" }),
          ],
        ],
      },
      {
        label: "Learn",
        rows: [
          [
            rb.split("help-tutorials", "Idea to Draft", "book", "tutorials", { large: true, tip: "Tutorials from idea to draft" }),
            rb.split("help-samples", "Sample Scripts", "script", "samples", { large: true, tip: "Sample scripts and templates" }),
          ],
        ],
      },
      {
        label: "Online",
        rows: [
          [
            rb.large("help-updates", "Release and Updates", "updates", { tip: "Review local update options" }),
            rb.large("help-feedback", "Submit Feedback", "feedback", { tip: "Report a problem or idea" }),
          ],
        ],
      },
      {
        label: "Account",
        rows: [
          [
            rb.large("help-account", "Manage Account", "account", { tip: "Local profile" }),
            rb.large("help-signout", "Sign Out", "signout", { tip: "Sign out of the local profile" }),
          ],
        ],
      },
      {
        label: "About",
        rows: [[rb.large("help-about", "About", "info", { tip: "About Azkript" })]],
      },
    ],
  };
  /* ------------------------------------------------------------------ */
  /* Combo + menu definitions                                            */
  /* ------------------------------------------------------------------ */
  function ribbonActiveParagraph() {
    return activeParagraph();
  }
  function ribbonParagraphValue(key, fallback) {
    const paragraph = ribbonActiveParagraph();
    if (!paragraph) return fallback;
    const value = paragraph[key];
    return value === undefined || value === null || value === "" ? fallback : String(value);
  }
  const RIBBON_COMBOS = {
    element: {
      label: "Element",
      value: () => {
        const paragraph = ribbonActiveParagraph();
        return paragraph ? paragraph.type : "Action";
      },
      options: () => {
        const paragraph = ribbonActiveParagraph();
        const current = paragraph ? paragraph.type : "Action";
        return Object.keys(ELEMENTS).map((type) => ({
          value: type,
          label: type,
          checked: current === type,
          hint: ELEMENTS[type].shortcut ? `Alt+${ELEMENTS[type].shortcut}` : "",
        }));
      },
      select: (value) => changeElementType(value),
    },
    font: {
      label: "Font",
      value: () => currentTypography().family,      options: () =>
        RIBBON_FONTS.map((font) => ({
          value: font,
          label: RIBBON_FONT_LABELS[font] || font,
          checked: currentTypography().family === font,
        })),
      select: (value) => {
        state.font = normalizeScriptFont(value);        applyStudioAppearance();
        useWorkspaceTypography();
        applyPageMetrics();
        persistPrefs();
        renderAll();
        toast("Workspace font", `${scriptFontLabel(state.font)} is active for the editor and PDF. FDX retains document font requests.`, "info", 4000);
      },
    },
    size: {
      label: "Size",
      value: () => `${currentTypography().size} pt`,
      options: () =>
        RIBBON_FONT_SIZES.map((size) => ({
          value: String(size),
          label: `${size} pt`,
          checked: currentTypography().size === size,
        })),
      select: (value) => {
        state.fontSize = clamp(Number(value) || 12, 8, 24);
        useWorkspaceTypography();
        applyPageMetrics();
        state.layoutDirty = true;
        persistPrefs();
        renderAll();
      },
    },
    align: {
      label: "Alignment",
      value: () => {
        const value = ribbonParagraphValue("alignment", "");
        return value ? value[0].toUpperCase() + value.slice(1) : "Default";
      },
      options: () => [
        { value: "", label: "Element default", checked: !ribbonParagraphValue("alignment", "") },
        { value: "left", label: "Left", checked: ribbonParagraphValue("alignment", "") === "left" },
        { value: "center", label: "Center", checked: ribbonParagraphValue("alignment", "") === "center" },
        { value: "right", label: "Right", checked: ribbonParagraphValue("alignment", "") === "right" },
      ],
      select: (value) => applyParagraphAlignment(value),
    },
    spacing: {
      label: "Spacing",
      value: () => {
        const value = ribbonParagraphValue("spacing", "");
        return value === "1.5" ? "1.5 lines" : value === "2" ? "Double" : "Single";
      },
      options: () => [
        { value: "", label: "Single (1.0)", checked: !ribbonParagraphValue("spacing", "") },
        { value: "1.5", label: "1.5 lines", checked: ribbonParagraphValue("spacing", "") === "1.5" },
        { value: "2", label: "Double (2.0)", checked: ribbonParagraphValue("spacing", "") === "2" },
      ],
      select: (value) => applyParagraphSpacing(value),
    },
    "space-before": {
      label: "Space before",
      value: () => {
        const value = Number(ribbonParagraphValue("spaceBefore", 0));
        return `${Number.isFinite(value) ? value : 0} pt`;
      },
      options: () =>
        [0, 6, 12, 18, 24].map((value) => ({
          value: String(value),
          label: `${value} pt`,
          checked: Number(ribbonParagraphValue("spaceBefore", 0)) === value,
        })),
      select: (value) => applyParagraphSpaceBefore(Number(value) || 0),
    },
    leading: {
      label: "Leading",
      value: () => {
        const value = ribbonParagraphValue("leading", "Regular");
        return value[0].toUpperCase() + value.slice(1);
      },
      options: () => [
        { value: "Regular", label: "Regular", checked: ribbonParagraphValue("leading", "Regular") === "Regular" },
        { value: "Tight", label: "Tight", checked: ribbonParagraphValue("leading", "Regular") === "Tight" },
        { value: "Loose", label: "Loose", checked: ribbonParagraphValue("leading", "Regular") === "Loose" },
      ],
      select: (value) => applyParagraphLeading(value),
    },
    cards: {
      label: "Cards",
      value: () => (state.cardMode === "script" ? "Script cards" : "Summary cards"),
      options: () => [
        { value: "summary", label: "Summary cards", checked: state.cardMode !== "script" },
        { value: "script", label: "Script cards", checked: state.cardMode === "script" },
      ],
      select: (value) => {
        state.cardMode = value === "script" ? "script" : "summary";
        setView("navigator");
        renderNavigator();
        syncRibbon();
      },
    },
    zoom: {
      label: "Zoom",
      value: () => `${Math.round(state.zoom * 100)}%`,
      options: () =>
        [50, 75, 90, 100, 110, 125, 150, 200].map((value) => ({
          value: String(value),
          label: `${value}%`,
          checked: Math.round(state.zoom * 100) === value,
        })),
      select: (value) => {
        state.zoom = clamp(Number(value) / 100, 0.5, 2.4);
        applyZoom();
        persistPrefs();
        syncRibbon();
      },
    },
    typewriter: {
      label: "Typewriter",
      value: () => {
        const mode = state.typewriterMode || (state.typewriterScroll ? "line" : "off");
        return mode === "frame" ? "Frame guide" : mode === "line" ? "Line guide" : "Off";
      },
      options: () => {
        const mode = state.typewriterMode || (state.typewriterScroll ? "line" : "off");
        return [
          { value: "off", label: "Off — free scroll", checked: mode === "off" },
          { value: "frame", label: "Frame guide", checked: mode === "frame" },
          { value: "line", label: "Line guide", checked: mode === "line" },
        ];
      },
      select: (value) => setTypewriterMode(value),
    },
    "beat-selected": {
      label: "Beat",
      value: () => {
        const beat = (state.doc.beats || []).find((entry) => entry.id === state.selectedBeatId);
        return beat ? beat.title : "Select beat";
      },
      options: () =>
        (state.doc.beats || []).length
          ? (state.doc.beats || []).map((beat) => ({
              value: beat.id,
              label: beat.title || "Untitled beat",
              checked: beat.id === state.selectedBeatId,
            }))
          : [{ value: "", label: "No beats on this board", disabled: true }],
      select: (value) => focusBeat(value),
    },
  };
  const RIBBON_MENUS = {
    paste: {
      items: [
        { label: "Paste", icon: "clipboard", command: "edit-paste", shortcut: "Ctrl+V" },
        { label: "Paste as plain text", icon: "script", command: "edit-paste-plain" },
      ],
    },
    "file-export": {
      items: [
        { label: "FDX document (.fdx)", icon: "download", command: "file-export-fdx", shortcut: "Ctrl+Shift+S" },
        { label: "PDF document…", icon: "pdf", command: "file-export-pdf", shortcut: "Ctrl+Shift+E" },
        { label: "Fountain / plain text…", icon: "file", command: "file-export-text" },
        { label: "Beat Board text…", icon: "board", command: "file-export-beatboard" },
      ],
    },
    "text-color": {
      type: "swatch",
      items: () =>
        RIBBON_TEXT_COLORS.map((color) => ({
          label: color.label,
          swatch: color.value || "none",
          checked: state.textColor === color.value,
          run: () => applyTextColor(color.value),
        })),
    },
    highlight: {
      type: "swatch",
      items: () =>
        RIBBON_HIGHLIGHTS.map((color) => ({
          label: color.label,
          swatch: color.value || "none",
          checked: state.highlightColor === color.value,
          run: () => applyHighlighter(color.value),
        })),
    },
    "beat-align": {
      items: [
        { label: "Arrange in a row", icon: "align", run: () => alignBeats("row") },
        { label: "Arrange in a column", icon: "align", run: () => alignBeats("column") },
        { label: "Cascade", icon: "board", run: () => alignBeats("cascade") },
        { label: "Grid", icon: "grid", run: () => alignBeats("grid") },
      ],
    },
    "connection-color": {
      type: "swatch",
      items: () =>
        RIBBON_COLORS.connection.map((color) => ({
          label: color.label,
          swatch: color.value,
          checked: state.beatConnectionColor === color.value,
          run: () => setBeatConnectionColor(color.value),
        })),
    },
    split: {
      items: [
        { label: "Unsplit view", icon: "unsplit", run: () => toggleSplitView(false) },
        { label: "Split vertically", icon: "split", run: () => toggleSplitView(true, "vertical") },
        { label: "Split horizontally", icon: "split-h", run: () => toggleSplitView(true, "horizontal") },
        { label: "Swap panes", icon: "replace", run: swapSplitPanes },
      ],
    },
    "locking-tools": {
      items: [
        { label: "Relock Pages", icon: "lock", run: lockAllPages },
        { label: "Adjust Locked Page…", icon: "settings", run: openLockPagesDialog },
        { label: "Edit Locked Page Number…", icon: "scene-number", run: openLockedPageNumberDialog },
        { label: "Lock New Page", icon: "lock", run: lockAllPages },
        { label: "Unlock Page", icon: "unlock", run: unlockAPages },
      ],
    },
    "combine-reports": {
      items: [
        { label: "Combine all reports…", icon: "combine", run: openCombineReportsDialog },
        { label: "Copy statistics report", icon: "chart", run: copyReport },
        { label: "Open reports workspace", icon: "chart", run: () => setView("reports") },
      ],
    },
    tutorials: {
      items: [
        { label: "Open the tutorial library", icon: "book", run: openTutorialsDialog },
        { label: "Start with a sample scene", icon: "script", run: () => loadSample() },
        { label: "Open the user guide", icon: "help", run: openUserGuide },
      ],
    },
    samples: {
      items: [
        { label: "Load the sample screenplay", icon: "script", run: () => loadSample() },
        { label: "Browse templates", icon: "template", run: showStartCenter },
        { label: "Open an FDX file…", icon: "folder", run: openFilePicker },
      ],
    },
  };
  /* ------------------------------------------------------------------ */
  /* Ribbon rendering                                                    */
  /* ------------------------------------------------------------------ */
  function ribbonEsc(value) {
    return escapeHtml(String(value == null ? "" : value));
  }
  function ribbonComboValue(combo) {
    const config = RIBBON_COMBOS[combo];
    if (!config) return "";
    try {
      return String(config.value() || "");
    } catch {
      return "";
    }
  }
  function renderRibbonCombo(item) {
    const config = RIBBON_COMBOS[item.combo];
    if (!config) return "";
    const value = ribbonComboValue(item.combo);
    return `<button type="button" class="rb-combo${item.className ? ` ${item.className}` : ""}" data-ribbon-combo="${ribbonEsc(item.combo)}" aria-haspopup="menu" aria-expanded="false" data-tooltip="${ribbonEsc(item.tip || config.label)}"><span class="rb-combo__value" data-combo-value="${ribbonEsc(item.combo)}">${ribbonEsc(value)}</span>${icon("chevron")}</button>`;
  }
  function renderRibbonItem(item) {
    if (!item) return "";
    if (item.kind === "sep") return `<span class="rb-sep" aria-hidden="true"></span>`;
    if (item.kind === "col") {
      return `<span class="ribbon-col">${item.items.map((entry) => renderRibbonItem(entry)).join("")}</span>`;
    }
    if (item.kind === "combo") return renderRibbonCombo(item);
    const idAttr = item.id ? ` id="${ribbonEsc(item.id)}"` : "";
    const formatAttr = item.format ? ` data-format="${ribbonEsc(item.format)}"` : "";
    const toggleAttr = item.toggle ? ` data-ribbon-toggle="1" aria-pressed="false"` : "";
    const tip = ribbonEsc(item.tip || item.label);
    const labelSpan = (cls) => `<span class="${cls}">${ribbonEsc(item.label)}</span>`;
    if (item.kind === "split") {
      const large = Boolean(item.large);
      const body = large
        ? `<button type="button" class="rb-btn rb-btn--large" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`
        : item.iconOnly
          ? `<button type="button" class="rb-btn rb-btn--icon" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}" aria-label="${ribbonEsc(item.label)}">${icon(item.icon)}</button>`
          : `<button type="button" class="rb-btn rb-btn--small" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
      return `<span class="rb-split${large ? " rb-split--large" : ""}">${body}<button type="button" class="rb-split__arrow" data-ribbon-menu="${ribbonEsc(item.menu)}" aria-label="${ribbonEsc(`${item.label} options`)}" data-tooltip="${ribbonEsc(`${item.label} options`)}">${icon("chevron")}</button></span>`;
    }
    if (item.kind === "large") {
      const splitClass = item.split ? " rb-split--large" : "";
      const inner = `<button type="button" class="rb-btn rb-btn--large${item.accent ? " rb-btn--accent" : ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
      if (!item.split) return inner;
      return `<span class="rb-split rb-split--large">${inner}<button type="button" class="rb-split__arrow" data-ribbon-menu="${ribbonEsc(item.split)}" aria-label="${ribbonEsc(`${item.label} options`)}" data-tooltip="${ribbonEsc(`${item.label} options`)}">${icon("chevron")}</button></span>`;
    }
    if (item.kind === "icon") {
      return `<button type="button" class="rb-btn rb-btn--icon ${item.cls || ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}" aria-label="${ribbonEsc(item.label)}">${icon(item.icon)}</button>`;
    }
    return `<button type="button" class="rb-btn rb-btn--small ${item.cls || ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
  }
  function renderRibbonGroup(group) {
    return `<div class="ribbon-group" role="group" aria-label="${ribbonEsc(group.label)}">
      <div class="ribbon-group__body">${group.rows
        .map((row) => `<div class="ribbon-row">${row.map((item) => renderRibbonItem(item)).join("")}</div>`)
        .join("")}</div>
      <span class="ribbon-group__label">${ribbonEsc(group.label)}</span>
    </div>`;
  }
  function renderRibbon() {
    if (!els.ribbonDeck) return;
    els.ribbonDeck.innerHTML = RIBBON_TAB_DEFS.map((tab) => {
      const active = tab.id === state.ribbonTab;
      return `<section class="ribbon-tab-panel${active ? " is-active" : ""}" data-ribbon-panel="${tab.id}" id="ribbon-${tab.id}" role="tabpanel" aria-labelledby="ribbonTab-${tab.id}"${active ? "" : " hidden"}>${(RIBBON_MODEL[tab.id] || [])
        .map((group) => renderRibbonGroup(group))
        .join("")}</section>`;
    }).join("");
    syncRibbon();
  }
  /* ------------------------------------------------------------------ */
  /* Ribbon switching, popovers and state sync                           */
  /* ------------------------------------------------------------------ */
  function switchRibbonTab(tabId) {
    const tab = RIBBON_TAB_DEFS.some((entry) => entry.id === tabId) ? tabId : "home";
    state.ribbonTab = tab;
    $$("[data-ribbon-tab]").forEach((button) => {
      const active = button.dataset.ribbonTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
    });
    $$(".ribbon-tab-panel").forEach((panel) => {
      const active = panel.dataset.ribbonPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
      if (active) {
        panel.classList.remove("is-entering");
        void panel.offsetWidth;
        panel.classList.add("is-entering");
      }
    });
    closeRibbonPopover(true);
    if (els.appShell && els.appShell.classList.contains("ribbon-collapsed")) {
      toggleRibbonCollapsed(false);
    }
    syncRibbon();
    requestAnimationFrame(updateRibbonScrollHint);
  }
  function updateRibbonScrollHint() {
    if (!els.ribbonBar || !els.ribbonScroller) return;
    const scroller = els.ribbonScroller;
    const overflow = scroller.scrollWidth > scroller.clientWidth + 2;
    els.ribbonBar.classList.toggle("is-scrollable", overflow);
    els.ribbonBar.classList.toggle(
      "is-scroll-end",
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2,
    );
  }
  function toggleRibbonCollapsed(force) {
    if (!els.appShell) return;
    const collapsed =
      typeof force === "boolean"
        ? force
        : !els.appShell.classList.contains("ribbon-collapsed");
    els.appShell.classList.toggle("ribbon-collapsed", collapsed);
    document.body.classList.toggle("mode-classic", collapsed);
    if (els.ribbonPinButton) {
      els.ribbonPinButton.setAttribute("aria-pressed", String(collapsed));
      els.ribbonPinButton.dataset.tooltip = collapsed ? "Show the ribbon" : "Collapse ribbon (Classic View)";
      els.ribbonPinButton.setAttribute("aria-label", collapsed ? "Show ribbon" : "Collapse ribbon");
    }
    requestAnimationFrame(() => fitPaper());
    if (!collapsed) requestAnimationFrame(updateRibbonScrollHint);
    syncRibbon();
  }
  function closeRibbonPopover(immediate = false) {
    if (!els.ribbonPopover) return;
    els.ribbonPopover.hidden = true;
    els.ribbonPopover.innerHTML = "";
    $$("[data-ribbon-menu][aria-expanded='true'], [data-ribbon-combo][aria-expanded='true']").forEach((control) => {
      control.setAttribute("aria-expanded", "false");
    });
    if (immediate) return;
  }
  function positionRibbonPopover(anchor) {
    const popover = els.ribbonPopover;
    const bar = els.ribbonBar;
    if (!popover || !bar) return;
    const anchorRect = anchor.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    popover.style.visibility = "hidden";
    popover.hidden = false;
    const width = popover.offsetWidth || 220;
    const height = popover.offsetHeight || 200;
    const left = clamp(anchorRect.left - barRect.left, 6, Math.max(6, barRect.width - width - 8));
    const spaceBelow = window.innerHeight - anchorRect.bottom - 12;
    const spaceAbove = anchorRect.top - 12;
    let top = anchorRect.bottom - barRect.top + 3;
    if (spaceBelow >= 170 || spaceBelow >= spaceAbove) {
      popover.style.maxHeight = `${clamp(spaceBelow - 6, 170, 340)}px`;
    } else {
      top = Math.max(4, anchorRect.top - barRect.top - height - 3);
      popover.style.maxHeight = `${clamp(spaceAbove - 6, 170, 340)}px`;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "";
  }
  function openRibbonMenu(anchor, menuId) {
    const menu = RIBBON_MENUS[menuId];
    if (!menu || !els.ribbonPopover) return;
    closeRibbonPopover(true);
    const items = typeof menu.items === "function" ? menu.items() : menu.items;
    els.ribbonPopover.classList.toggle("ribbon__popover--palette", menu.type === "swatch");
    els.ribbonPopover.innerHTML = items
      .map((item, index) => {
        if (!item) return "";
        if (item.sep) return `<div class="rb-menu__sep" role="separator"></div>`;
        if (item.header) return `<div class="rb-menu__header">${ribbonEsc(item.header)}</div>`;
        const checkIcon = item.checked
          ? `<span class="rb-menu__check">${icon("check")}</span>`
          : `<span class="rb-menu__check"></span>`;
        const swatch = menu.type === "swatch"
          ? `<span class="rb-swatch${item.swatch === "none" ? " rb-swatch--none" : ""}${item.checked ? " is-selected" : ""}" style="--swatch:${ribbonEsc(item.swatch || "transparent")}"></span>`
          : "";
        return `<button type="button" class="rb-menu__item${item.checked ? " is-checked" : ""}" role="menuitem" data-ribbon-menu-index="${index}"${item.disabled ? " disabled" : ""}>${swatch}${!swatch ? checkIcon : checkIcon}${item.icon ? icon(item.icon) : ""}<span>${ribbonEsc(item.label)}</span>${item.shortcut ? `<span class="rb-menu__shortcut">${ribbonEsc(item.shortcut)}</span>` : ""}</button>`;
      })
      .join("");
    $$("[data-ribbon-menu-index]", els.ribbonPopover).forEach((button) => {
      button.addEventListener("click", () => {
        const item = items[Number(button.dataset.ribbonMenuIndex)];
        closeRibbonPopover();
        if (!item || item.disabled) return;
        if (item.command) runRibbonCommand(item.command);
        else if (item.run) item.run();
      });
    });
    anchor.setAttribute("aria-expanded", "true");
    positionRibbonPopover(anchor);
    const first = els.ribbonPopover.querySelector(".rb-menu__item:not([disabled])");
    if (first) first.focus({ preventScroll: true });
  }
  function openRibbonCombo(anchor, comboId) {
    const config = RIBBON_COMBOS[comboId];
    if (!config || !els.ribbonPopover) return;
    closeRibbonPopover(true);
    const options = config.options();
    els.ribbonPopover.classList.remove("ribbon__popover--palette");
    els.ribbonPopover.innerHTML = [
      `<div class="rb-menu__header">${ribbonEsc(config.label)}</div>`,
      ...options.map(
        (option, index) =>
          `<button type="button" class="rb-menu__item${option.checked ? " is-checked" : ""}" role="menuitemradio" aria-checked="${Boolean(option.checked)}" data-ribbon-option-index="${index}"${option.disabled ? " disabled" : ""}><span class="rb-menu__check">${option.checked ? icon("check") : ""}</span><span>${ribbonEsc(option.label)}</span>${option.hint ? `<span class="rb-menu__shortcut">${ribbonEsc(option.hint)}</span>` : ""}</button>`,
      ),
    ].join("");
    $$("[data-ribbon-option-index]", els.ribbonPopover).forEach((button) => {
      button.addEventListener("click", () => {
        const option = options[Number(button.dataset.ribbonOptionIndex)];
        closeRibbonPopover();
        if (!option || option.disabled) return;
        config.select(option.value);
        syncRibbon();
      });
    });
    anchor.setAttribute("aria-expanded", "true");
    positionRibbonPopover(anchor);
    const active = els.ribbonPopover.querySelector(".rb-menu__item.is-checked") || els.ribbonPopover.querySelector(".rb-menu__item:not([disabled])");
    if (active) active.focus({ preventScroll: true });
  }
  function toggleRibbonMenu(anchor, menuId) {
    const open = anchor.getAttribute("aria-expanded") === "true" && !els.ribbonPopover.hidden;
    closeRibbonPopover(true);
    if (!open) {
      saveRibbonSelection();
      openRibbonMenu(anchor, menuId);
    }
  }
  function toggleRibbonCombo(anchor, comboId) {
    const open = anchor.getAttribute("aria-expanded") === "true" && !els.ribbonPopover.hidden;
    closeRibbonPopover(true);
    if (!open) {
      saveRibbonSelection();
      openRibbonCombo(anchor, comboId);
    }
  }
  let ribbonSelectionRange = null;
  function saveRibbonSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    if (!els.editor || !els.editor.contains(selection.anchorNode)) return;
    ribbonSelectionRange = selection.getRangeAt(0).cloneRange();
  }
  function restoreRibbonSelection() {
    if (!ribbonSelectionRange) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(ribbonSelectionRange);
    return true;
  }
  function updateRailIndicator() {
    if (!els.railIndicator) return;
    const active = $(".rail__item[data-view].is-active");
    if (!active) return;
    els.railIndicator.style.transform = `translateY(${active.offsetTop - 8}px)`;
    els.railIndicator.style.height = `${active.offsetHeight}px`;
  }
  const RIBBON_TOGGLES = {
    "edit-track-changes": () => state.trackChanges,
    "format-allcaps": () => selectionHasCapsStyle(),
    "view-toggle-outline": () => state.showOutline,
    "view-toggle-outline-script": () => state.showOutlineInScript !== false,
    "view-toggle-structure": () => state.showStructureLines,
    "view-toggle-alts": () => state.showAlts,
    "view-toggle-scriptnotes": () => !state.hideScriptNotes,
    "view-toggle-ruler": () => state.showRuler,
    "view-toggle-invisibles": () => state.showInvisibles,
    "view-toggle-navigator": () => state.navigatorVisible !== false,
    "view-split-v": () => state.splitView.enabled && state.splitView.orientation !== "horizontal",
    "view-split-h": () => state.splitView.enabled && state.splitView.orientation === "horizontal",
    "format-beat-connect": () => state.beatConnectMode,
    "format-beat-disconnect": () => false,
    "format-beat-snap": () => state.beatSnap,
    "prod-scene-numbers": () => state.doc.settings.sceneNumbers,
    "prod-revision-mode": () => state.doc.revision.enabled,
    "prod-tags-mode": () => Boolean(state.tagsMode),
    "view-appearance-day": () => resolveTheme(state.theme) === "light",
    "view-appearance-night": () => resolveTheme(state.theme) === "dark",
    "view-appearance-midnight": () => resolveTheme(state.theme) === "midnight",
    "view-classic": () => Boolean(els.appShell && els.appShell.classList.contains("ribbon-collapsed")),
  };
  const RIBBON_DISABLED = {
    "edit-undo": () => !state.history || !state.history.past.length,
    "edit-redo": () => !state.history || !state.history.future.length,
    "edit-paste": () => false,
    "prod-clear-revised": () => {
      const paragraph = activeParagraph();
      return !paragraph || !paragraph.revision;
    },
    "prod-mark-revised": () => !activeParagraph(),
    "edit-reject-change": () => {
      const paragraph = activeParagraph();
      return !paragraph || !paragraph.changeType;
    },
    "edit-accept-change": () => {
      const paragraph = activeParagraph();
      return !paragraph || !paragraph.changeType;
    },
  };
  function syncRibbon() {
    if (!els.ribbonDeck) return;
    document.body.classList.toggle("show-structure-lines", Boolean(state.showStructureLines));
    document.body.classList.toggle("hide-scriptnotes", Boolean(state.hideScriptNotes));
    for (const [command, getter] of Object.entries(RIBBON_TOGGLES)) {
      const active = Boolean(getter());
      $$(`[data-ribbon-command="${command}"]`).forEach((control) => {
        control.setAttribute("aria-pressed", String(active));
        control.classList.toggle("is-active", active);
      });
    }
    for (const [command, getter] of Object.entries(RIBBON_DISABLED)) {
      let disabled = false;
      try {
        disabled = Boolean(getter());
      } catch {
        disabled = true;
      }
      $$(`[data-ribbon-command="${command}"]`).forEach((control) => {
        control.disabled = disabled;
      });
    }
    for (const [combo, config] of Object.entries(RIBBON_COMBOS)) {
      const valueNodes = $$(`[data-combo-value="${combo}"]`);
      if (!valueNodes.length) continue;
      const value = ribbonComboValue(combo);
      const options = config.options();
      const placeholder = options.length && options[0] && options[0].disabled;
      valueNodes.forEach((valueNode) => {
        if (valueNode.textContent !== value) valueNode.textContent = value;
        valueNode.classList.toggle("is-placeholder", Boolean(placeholder));
      });
    }
    if (els.sprintQuickButton) {
      const active = Boolean(state.sprint.open || state.sprint.running);
      els.sprintQuickButton.classList.toggle("is-active", active);
      els.sprintQuickButton.setAttribute("aria-pressed", String(active));
      /* While a sprint runs with the panel hidden, the button means "sprint is
       * active"; say so instead of implying a plain open/close toggle. */
      const tip = state.sprint.running && !state.sprint.open
        ? "Sprint running — click to reopen"
        : state.sprint.open
          ? "Hide the writing sprint"
          : "Writing sprint";
      if (els.sprintQuickButton.dataset.tooltip !== tip) {
        els.sprintQuickButton.dataset.tooltip = tip;
        els.sprintQuickButton.setAttribute("aria-label", tip);
      }
    }
    if (els.splitViewButton) {
      els.splitViewButton.setAttribute("aria-pressed", String(state.splitView.enabled));
      els.splitViewButton.classList.toggle("is-active", state.splitView.enabled);
    }
    if (els.ribbonPinButton) {
      const collapsed = Boolean(els.appShell && els.appShell.classList.contains("ribbon-collapsed"));
      els.ribbonPinButton.setAttribute("aria-pressed", String(collapsed));
    }
    $$("#viewSegmented .segmented__item").forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    updateRailIndicator();
    updateRibbonScrollHint();
  }
  /* ------------------------------------------------------------------ */
  /* Ribbon command dispatch                                             */
  /* ------------------------------------------------------------------ */
  const RIBBON_COMMANDS = {
    /* file */
    "file-new": () => newDocument(),
    "file-new-template": () => showStartCenter(),
    "file-open": () => openFilePicker(),
    "file-close": () => closeDocument(),
    "file-save": () => saveDocument(),
    "file-save-as": () => saveDocument({ saveAs: true }),
    "file-save-pdf": () => exportPDF(),
    "file-save-template": () => saveAsTemplate(),
    "file-export": () => exportFDX(),
    "file-export-fdx": () => exportFDX(),
    "file-export-pdf": () => exportPDF(),
    "file-export-text": () => exportFountainOrText("txt"),
    "file-export-beatboard": () => exportBeatBoard(),
    "file-revert": () => revertDocument(),
    "file-backup": () => backupVaultDialog(),
    "file-compatibility": () => openCompatibilityInspector(),
    "file-history": () => openVersionHistory(),
    "file-disk-status": () => openFileStatus(),
    "view-writing-reliability": () => openWritingReliability(),
    "file-print-preview": () => openPrintPreviewDialog(),
    "file-print": () => printDocument(),
    "file-wga": () => openWgaDialog(),
    /* edit */
    "edit-undo": () => undo(),
    "edit-redo": () => redo(),
    "edit-cut": () => document.execCommand("cut"),
    "edit-copy": () => document.execCommand("copy"),
    "edit-paste": () => pasteAsPlainText(),
    "edit-paste-plain": () => pasteAsPlainText(),
    "edit-delete": () => deleteSelectionAction(),
    "edit-select-all": () => {
      els.editor.focus();
      document.execCommand("selectAll");
    },
    "edit-select-scene": () => selectCurrentScene(),
    "edit-rename-character": () => openRenameCharacterDialog(),
    "edit-nonspeaking": () => openNonSpeakingDialog(),
    "edit-find": () => openFind("find"),
    "edit-find-selection": () => findSelectionAction(),
    "edit-goto": () => openGoToDialog(),
    "edit-track-changes": () => toggleTrackChanges(),
    "edit-accept-change": () => acceptCurrentChange(),
    "edit-reject-change": () => rejectCurrentChange(),
    "edit-prev-change": () => jumpToTrackedChange(-1),
    "edit-next-change": () => jumpToTrackedChange(1),
    "edit-emoji": () => openEmojiDialog(),
    /* view */
    "view-normal": () => setView("script", "write"),
    "view-page": () => setView("script", "page"),
    "view-speed": () => setView("script", "speed"),
    "view-scene": () => setView("sceneview"),
    "view-cards-summary": () => {
      state.cardMode = "summary";
      setView("navigator");
    },
    "view-cards-script": () => {
      state.cardMode = "script";
      setView("navigator");
    },
    "view-beatboard": () => setView("beatboard"),
    "view-toggle-outline": () => toggleOutlineLayer(),
    "view-toggle-outline-script": () => toggleOutlineInScript(),
    "view-toggle-structure": () => toggleStructureLines(),
    "view-toggle-alts": () => toggleAltBadges(),
    "view-toggle-scriptnotes": () => toggleScriptNoteVisibility(),
    "view-toggle-ruler": () => toggleRulerLayer(),
    "view-toggle-invisibles": () => toggleInvisibles(),
    "view-toggle-navigator": () => toggleNavigatorPanel(),
    "view-split-toggle": () => toggleSplitView(),
    "view-split-off": () => toggleSplitView(false),
    "view-split-v": () => toggleSplitView(true, "vertical"),
    "view-split-h": () => toggleSplitView(true, "horizontal"),
    "view-split-swap": () => swapSplitPanes(),
    "view-arrange-docs": () => openArrangeDocumentsDialog(),
    "view-open-docs": () => openOpenDocumentsDialog(),
    "view-classic": () => toggleRibbonCollapsed(),
    "view-zoom-out": () => setZoom(-0.1),
    "view-zoom-in": () => setZoom(0.1),
    "view-zoom-outline": () => cycleOutlineZoom(),
    "view-appearance-day": () => applyTheme("light"),
    "view-appearance-night": () => applyTheme("dark"),
    "view-appearance-midnight": () => applyTheme("midnight"),
    /* format */
    "format-element-settings": () => openElementSettings(),
    "format-element-options": () => openElementSettings(),
    "format-cast-list": () => openCastListOptions(),
    "format-dual": () => toggleDualDialogue(),
    "format-highlight-characters": () => openHighlightCharactersDialog(),
    "format-bold": () => formatSelection("bold"),
    "format-italic": () => formatSelection("italic"),
    "format-underline": () => formatSelection("underline"),
    "format-strike": () => formatSelection("strikeThrough"),
    "format-case": () => cycleCase(),
    "format-allcaps": () => applyAllCapsStyle(),
    "format-text-color": () => applyTextColor(state.textColor || "#171614"),
    "format-highlight": () => applyHighlighter(state.highlightColor || "#ffe9a3"),
    "format-page-break": () => insertPageBreak(),
    "format-revert-paragraph": () => revertParagraphFormatting(),
    "format-beat-align": () => alignBeats("row"),
    "format-beat-connect": () => toggleBeatConnectMode(),
    "format-beat-disconnect": () => disconnectSelectedBeat(),
    "format-beat-snap": () => toggleBeatSnap(),
    "format-beat-connection-color": () => setBeatConnectionColor(state.beatConnectionColor || "#0f6cbd"),
    /* insert */
    "insert-scriptnote": () => openScriptNote(),
    "insert-bookmark": () => openBookmarksDialog(true),
    "insert-label": () => insertLabelDialog(),
    "insert-image": () => insertImageMarker(),
    "insert-pagebreak": () => insertPageBreak(),
    "insert-nonspeaking": () => openNonSpeakingDialog(),
    "insert-alt-add": () => openAltDialogueDialog(),
    "insert-alt-remove": () => removeAlternateTake(),
    "insert-beat": () => addBeat("beat"),
    "insert-scene": () => insertScene(),
    "insert-send-to-script": () => sendToScriptAction(),
    "insert-emoji": () => openEmojiDialog(),
    /* document */
    "doc-title-page": () => openTitlePage(),
    "doc-header-footer": () => openHeaderFooterDialog(),
    "doc-page-layout": () => openPageSetup(),
    "doc-mores": () => openMoresDialog(),
    "doc-watermark": () => openWatermarkDialog(),
    "doc-smarttype": () => openSmartTypeDialog(),
    "doc-macros": () => openMacrosDialog(),
    "doc-bookmarks": () => openBookmarksDialog(false),
    "doc-target-length": () => openTargetLengthDialog(),
    "doc-details": () => openDocumentDetails(),
    /* tools */
    "tools-spelling": () => openSpellcheckDialog(),
    "tools-thesaurus": () => openThesaurus(),
    "tools-play": () => speechPlay(),
    "tools-stop": () => speechStop(),
    "tools-assign-voices": () => openAssignVoicesDialog(),
    "tools-rewind": () => speechTransport(-1),
    "tools-forward": () => speechTransport(1),
    "tools-collaboration": () => openCollaborationDialog(),
    "tools-combine-reports": () => openCombineReportsDialog(),
    "tools-format-assistant": () => openFormatAssistantDialog(),
    "tools-script-compare": () => openScriptCompareDialog(),
    "tools-reformat": () => openReformatDialog(),
    "tools-writing-stats": () => openWritingStatsDialog(),
    "tools-names": () => openNamesDatabaseDialog(),
    "tools-show-navigator": () => {
      if (state.navigatorVisible === false) toggleNavigatorPanel();
      else setView("script");
      syncRibbon();
    },
    "tools-sprint": () => toggleSprintWidget(),
    "tools-options": () => openSettings(),
    "tools-ask": () => openAskFdDialog(),
    /* production */
    "prod-scene-numbers": () => {
      state.doc.settings.sceneNumbers = !state.doc.settings.sceneNumbers;
      markDirty();
      renderAll();
    },
    "prod-edit-scene-number": () => editSceneNumberDialog(),
    "prod-omit-scene": () => omitCurrentScene(),
    "prod-revisions-setup": () => openRevisionManager(),
    "prod-revision-mode": () => toggleRevisionMode(),
    "prod-mark-revised": () => {
      const paragraph = activeParagraph();
      if (!paragraph) {
        toast("No paragraph selected", "Place the caret in the script first.", "info", 2000);
        return;
      }
      markCurrentRevision(paragraph);
      renderAll();
      toast("Marked revised", "The paragraph now carries the active revision color.", "success", 2000);
    },
    "prod-clear-revised": () => {
      const paragraph = activeParagraph();
      if (!paragraph || !paragraph.revision) {
        toast("Nothing to clear", "This paragraph has no revision mark.", "info", 2000);
        return;
      }
      paragraph.revision = null;
      markDirty();
      state.history.record();
      renderAll();
    },
    "prod-prev-revision": () => goToPreviousRevision(),
    "prod-next-revision": () => startNextRevision(),
    "prod-lock-pages": () => openLockPagesDialog(),
    "prod-unlock-a-pages": () => unlockAPages(),
    "prod-unlock-all-pages": () => unlockAllPages(),
    "prod-locking-tools": () => openLockPagesDialog(),
    "prod-tags-mode": () => toggleTagsMode(),
    "prod-tag-all": () => tagAllCharacters(),
    /* help */
    "help-guide": () => openHelp(),
    "help-welcome": () => openWelcomeDialog(),
    "help-whats-new": () => openWhatsNewDialog(),
    "help-get-help": () => openGetHelpDialog(),
    "help-tutorials": () => openTutorialsDialog(),
    "help-samples": () => openSamplesDialog(),
    "help-updates": () => openCheckUpdatesDialog(),
    "help-feedback": () => openFeedbackDialog(),
    "help-account": () => openAccountDialog(),
    "help-signout": () => signOutAction(),
    "help-about": () => openAboutDialog(),
  };
  function runRibbonCommand(command) {
    if (state.history) state.history.finishBurst();
    if (state.history) state.history.selectionCurrent = FDCoreWriting.captureSelection(els.editor) || state.history.selectionCurrent;
    if (!command) return;
    saveRibbonSelection();
    const handler = RIBBON_COMMANDS[command];
    if (handler) {
      try {
        handler();
      } catch (error) {
        console.error(`[ribbon] ${command} failed`, error);
        toast("Command failed", error && error.message ? error.message : String(error), "error", 5000);
      }
    } else {
      console.warn(`[ribbon] unknown command: ${command}`);
      toast("Command unavailable", `The command “${command}” is not available in this build.`, "warning", 3200);
    }
    requestAnimationFrame(syncRibbon);
  }
  function bindRibbonEvents() {
    renderRibbon();
    $$("[data-ribbon-tab]").forEach((button) => {
      button.addEventListener("click", () => switchRibbonTab(button.dataset.ribbonTab));
      button.addEventListener("dblclick", () => {
        if (button.dataset.ribbonTab === state.ribbonTab) toggleRibbonCollapsed();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = RIBBON_TAB_DEFS.findIndex((tab) => tab.id === button.dataset.ribbonTab);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = event.key === "Home" ? RIBBON_TAB_DEFS[0] : event.key === "End" ? RIBBON_TAB_DEFS[RIBBON_TAB_DEFS.length - 1]
          : RIBBON_TAB_DEFS[(index + delta + RIBBON_TAB_DEFS.length) % RIBBON_TAB_DEFS.length];
        switchRibbonTab(next.id);
        $(`#ribbonTab-${next.id}`).focus();
      });
    });
    if (els.ribbonPinButton) {
      els.ribbonPinButton.addEventListener("click", () => toggleRibbonCollapsed());
    }
    if (els.ribbonDeck) {
      els.ribbonDeck.addEventListener("mousedown", (event) => {
        if (event.target.closest("[data-format]")) event.preventDefault();
        saveRibbonSelection();
      });
      els.ribbonDeck.addEventListener("click", (event) => {
        if (event.target.closest(".format-btn")) return;
        const commandControl = event.target.closest("[data-ribbon-command]");
        if (commandControl && !event.target.closest(".rb-split__arrow")) {
          if (commandControl.disabled) return;
          runRibbonCommand(commandControl.dataset.ribbonCommand);
          return;
        }
        const menuControl = event.target.closest("[data-ribbon-menu]");
        if (menuControl) {
          toggleRibbonMenu(menuControl, menuControl.dataset.ribbonMenu);
          return;
        }
        const comboControl = event.target.closest("[data-ribbon-combo]");
        if (comboControl) {
          toggleRibbonCombo(comboControl, comboControl.dataset.ribbonCombo);
        }
      });
    }
    if (els.ribbonScroller) {
      els.ribbonScroller.addEventListener("scroll", () => {
        updateRibbonScrollHint();
        if (els.ribbonPopover && !els.ribbonPopover.hidden) {
          closeRibbonPopover(true);
        }
      }, { passive: true });
    }
    document.addEventListener("pointerdown", (event) => {
      if (!els.ribbonPopover || els.ribbonPopover.hidden) return;
      if (event.target.closest("#ribbonBar") || event.target.closest("#ribbonPopover")) return;
      closeRibbonPopover(true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (els.ribbonPopover && !els.ribbonPopover.hidden) {
        closeRibbonPopover();
        event.stopPropagation();
      }
    });
    window.addEventListener("resize", updateRibbonScrollHint);
    requestAnimationFrame(updateRibbonScrollHint);
  }
  /* ================================================================== */
  /* Ribbon feature implementations                                      */
  /* ================================================================== */
  /* Compat helper: several beat/character flows build paragraphs from
     pre-escaped HTML. Kept next to the model helpers. */
  function createParagraph(type, html, extra = {}) {
    const paragraph = makeParagraph(type, "", extra);
    paragraph.html = String(html == null ? "" : html);
    return paragraph;
  }
  function ribbonToast(title, message, type = "info", duration = 2600) {
    toast(title, message, type, duration);
  }
  function ribbonFileName(extension) {
    const base =
      String(state.doc.title || "screenplay")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
        .trim() || "screenplay";
    return `${base}.${extension}`;
  }
  async function saveTextFile(contents, filename, mime = "text/plain;charset=utf-8", defaultName = null) {
    if (isDesktop) {
      const result = await desktop.saveFile({
        path: null,
        saveAs: true,
        contents,
        defaultName: defaultName || filename.replace(/\.[^.]+$/, ""),
      });
      if (result && !result.canceled) {
        toast("File saved", `${result.name} written to disk.`, "success");
        return true;
      }
      return false;
    }
    FDX.download(filename, contents, mime);
    toast("File exported", `${filename} downloaded.`, "success");
    return true;
  }
  /* ---------- file lifecycle ---------------------------------------- */
  function closeDocument() {
    const finish = () => {
      state.dirty = false;
      updateSaveState();
      showStartCenter();
      ribbonToast("Document closed", "The Start Center is ready for the next draft.", "info", 2400);
    };
    if (!state.dirty) {
      finish();
      return;
    }
    openDialog({
      eyebrow: "File · Close",
      title: "Close this document?",
      body: `<p class="dialog-note">“${escapeHtml(state.doc.title || "Untitled Screenplay")}” has unsaved changes. Save before closing, or discard them.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Discard",
          kind: "danger",
          onClick: () => {
            closeDialog();
            finish();
          },
        },
        {
          label: "Save & Close",
          kind: "primary",
          onClick: async () => {
            const saved = await saveDocument();
            if (!saved) return;
            closeDialog();
            finish();
          },
        },
      ],
    });
  }
  async function saveAsTemplate() {
    try {
      const xml = FDX.serialize(state.doc, { template: true });
      const filename = ribbonFileName("fdxt");
      if (isDesktop) {
        const result = await desktop.saveFile({
          path: null,
          saveAs: true,
          contents: xml,
          defaultName: state.doc.title || "screenplay template",
        });
        if (result && !result.canceled) {
          toast("Template saved", `${result.name} is saved as a reusable FDX template.`, "success");
        }
        return;
      }
      FDX.download(filename, xml, "application/xml;charset=utf-8");
      toast("Template exported", `${filename} downloaded.`, "success");
    } catch (error) {
      toast("Template export failed", error.message || String(error), "error");
    }
  }
  async function exportBeatBoard() {
    const beats = state.doc.beats || [];
    if (!beats.length) {
      toast("No beats to export", "Add story beats on the Beat Board first.", "info", 2400);
      return;
    }
    const lines = [
      `BEAT BOARD — ${state.doc.title || "Untitled Screenplay"}`,
      state.doc.author ? `By ${state.doc.author}` : "",
      "",
      ...beats.map((beat, index) => {
        const target = beats.find((entry) => entry.id === beat.targetId);
        return [
          `${String(index + 1).padStart(2, "0")}. [${beat.category || "Beat"}] ${beat.title || "Untitled beat"}`,
          beat.body ? `    ${beat.body}` : "",
          target ? `    → connects to: ${target.title}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ].filter(Boolean);
    await saveTextFile(lines.join("\n"), ribbonFileName("beatboard.txt"));
  }
  function revertDocument() {
    if (state.saving) {
      toast("Save in progress", "Wait for the current save to finish before reverting.", "info");
      return;
    }
    if (!state.savedSnapshot) {
      toast("Nothing to revert to", "Save the screenplay first, then Revert can restore that version.", "info", 2800);
      return;
    }
    confirmAction(
      "Revert to the last saved version?",
      "Current unsaved edits will be replaced by the last saved snapshot.",
      "Revert",
      () => {
        state.doc = normalizeDocument(cloneDocument(state.savedSnapshot));
        state.history = new History(state.doc);
        state.layoutDirty = true;
        state.dirty = false;
        persistWorkspace(false);
        if (isDesktop) desktop.clearRecovery().catch(() => {});
        syncDesktopState(true);
        renderAll();
        updateHistoryButtons();
        ribbonToast("Document reverted", "The last saved version is back in the editor.", "success");
      },
    );
  }
  function backupVaultDialog() {
    const last = state.lastBackupAt ? new Date(state.lastBackupAt).toLocaleString() : "No backups yet";
    openDialog({
      eyebrow: "File · Backup",
      title: "Backup Vault",
      body: `
        <div class="setting-line"><div><strong>Create a portable backup</strong><span>Writes a complete FDX copy that can be archived or opened on another machine.</span></div><button type="button" class="pill-btn" id="backupNowButton" style="margin-left:auto">${icon("backup")}Create backup</button></div>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Last backup</span><strong>${escapeHtml(last)}</strong></div>
          <div class="shortcut-row"><span>Recovery</span><strong>${isDesktop ? "Automatic (native recovery)" : "Automatic (local autosave)"}</strong></div>
          <div class="shortcut-row"><span>Format</span><strong>FDX v6 (screenplay interchange)</strong></div>        </div>
        <p class="dialog-note">Backups are never overwritten automatically. Keep them next to your draft or in a synced folder.</p>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
    const button = $("#backupNowButton", els.dialogBody);
    if (button) {
      button.addEventListener("click", async () => {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
        const xml = FDX.serialize(state.doc);
        await saveTextFile(xml, ribbonFileName(`backup-${stamp}.fdx`), "application/xml;charset=utf-8", `${state.doc.title || "screenplay"} backup`);
        state.lastBackupAt = Date.now();
        persistPrefs();
        button.textContent = "Backup created";
        button.disabled = true;
      });
    }
  }
  function openWgaDialog() {
    const doc = state.doc;
    const summary = [
      `WGA REGISTRATION SUMMARY`,
      `Title: ${doc.title || "Untitled Screenplay"}`,
      `Author: ${doc.author || ""}`,
      `Draft date: ${doc.titlePage && doc.titlePage.draftDate ? doc.titlePage.draftDate : new Date().toLocaleDateString()}`,
      `Pages: ${pageCount()}`,
      `Scenes: ${getScenes(doc).length}`,
      `Words: ${getStats(doc).words}`,
    ].join("\n");
    openDialog({
      eyebrow: "File · Register",
      title: "WGA Registration",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Title</span><strong>${escapeHtml(doc.title || "Untitled Screenplay")}</strong></div>
          <div class="shortcut-row"><span>Author</span><strong>${escapeHtml(doc.author || "Not set")}</strong></div>
          <div class="shortcut-row"><span>Pages / Scenes</span><strong>${pageCount()} pages · ${getScenes(doc).length} scenes</strong></div>
        </div>
        <p class="dialog-note">Registration is completed with the Writers Guild of America. Copy this summary into the WGA registration form; registration numbers are issued by the WGA, not by Azkript.</p>`,
      actions: [
        { label: "Close" },
        {
          label: "Copy summary",
          kind: "primary",
          onClick: () => {
            copyText(summary, "Registration summary copied", "Paste it into the WGA registration form.");
          },
        },
      ],
    });
  }
  /* ---------- editing ---------------------------------------------- */
  function pasteAsPlainText() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast("Plain-text paste unavailable", "The clipboard API is not available in this build.", "warning", 2600);
      return;
    }
    const el = activeParagraphElement();
    if (!el) return;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount && el.contains(selection.anchorNode) && el.contains(selection.focusNode)
      ? selection.getRangeAt(0).cloneRange() : null;
    const documentAtPaste = state.doc;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) return;
        if (!el.isConnected || state.doc !== documentAtPaste) return;
        el.focus({ preventScroll: true });
        if (range) { selection.removeAllRanges(); selection.addRange(range); }
        else placeCaret(el, "end");
        onPaste({ target: el, preventDefault() {}, clipboardData: { getData: () => text } });
      })
      .catch(() => toast("Plain-text paste unavailable", "Clipboard permission was denied.", "warning", 2600));
  }
  function deleteSelectionAction() {
    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount && !selection.isCollapsed && els.editor.contains(selection.anchorNode);
    if (hasSelection) {
      document.execCommand("delete");
      return;
    }
    const paragraph = activeParagraph();
    if (!paragraph) return;
    if (state.doc.paragraphs.length <= 1) {
      paragraph.html = "";
      renderAll();
      markDirty();
      return;
    }
    const index = state.doc.paragraphs.indexOf(paragraph);
    state.doc.paragraphs.splice(index, 1);
    state.layoutDirty = true;
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Paragraph deleted", "The block was removed from the script.", "info", 1800);
  }
  function selectCurrentScene() {
    const paragraph = activeParagraph();
    if (!paragraph) return;
    const scene = sceneForParagraphId(paragraph.id);
    if (!scene) {
      ribbonToast("No scene selected", "Place the caret inside a scene first.", "info", 2200);
      return;
    }
    const paragraphs = state.doc.paragraphs.slice(scene.startIndex, scene.endIndex);
    const firstEl = paragraphElement(paragraphs[0].id);
    const lastEl = paragraphElement(paragraphs[paragraphs.length - 1].id);
    if (!firstEl || !lastEl) return;
    const range = document.createRange();
    range.setStart(firstEl, 0);
    range.setEnd(lastEl, lastEl.childNodes.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    ribbonToast("Scene selected", `${scene.heading || "Scene"} · ${paragraphs.length} blocks`, "info", 2000);
  }
  function findSelectionAction() {
    const text = String(window.getSelection() || "").trim();
    if (!text) {
      openFind("find");
      return;
    }
    openFind("find");
    state.find.query = text;
    if (els.findInput) els.findInput.value = text;
    runFind();
  }
  function toggleTrackChanges() {
    state.trackChanges = !state.trackChanges;
    decorateEditor();
    renderAll();
    ribbonToast(
      "Track Changes",
      state.trackChanges ? "Edits are now tracked. Accept or reject them from the Edit tab." : "New edits are no longer tracked.",
      "info",
      2600,
    );
  }
  function acceptCurrentChange() {
    const paragraph = activeParagraph();
    if (!paragraph || !paragraph.changeType) {
      ribbonToast("No tracked change here", "Place the caret in a tracked paragraph first.", "info", 2200);
      return;
    }
    delete paragraph.changeType;
    delete paragraph.trackedOriginal;
    if (state.trackedBaseline) delete state.trackedBaseline[paragraph.id];
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Change accepted", "The tracked edit is now part of the draft.", "success", 1800);
  }
  function rejectCurrentChange() {
    const paragraph = activeParagraph();
    if (!paragraph || !paragraph.changeType) {
      ribbonToast("No tracked change here", "Place the caret in a tracked paragraph first.", "info", 2200);
      return;
    }
    if (typeof paragraph.trackedOriginal === "string") {
      paragraph.html = paragraph.trackedOriginal;
    }
    delete paragraph.changeType;
    delete paragraph.trackedOriginal;
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Change rejected", "The paragraph was restored to its previous text.", "info", 2000);
  }
  function jumpToTrackedChange(direction) {
    const paragraphs = state.doc.paragraphs;
    const current = activeParagraph();
    const start = current ? paragraphs.indexOf(current) : -1;
    const count = paragraphs.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (start + direction * step + count * 2) % count;
      const paragraph = paragraphs[index];
      if (paragraph && paragraph.changeType) {
        setView("script");
        focusParagraph(paragraph.id, "start");
        ribbonToast("Tracked change", `${paragraph.type} · ${paragraphText(paragraph).slice(0, 60) || "empty"}`, "info", 2200);
        return;
      }
    }
    ribbonToast("No tracked changes", "Track Changes is off or the draft has no tracked edits.", "info", 2400);
  }
  /* ---------- view -------------------------------------------------- */
  function toggleOutlineInScript() {
    state.showOutlineInScript = state.showOutlineInScript === false;
    renderOutlineAndRuler();
    persistPrefs();
    syncRibbon();
    ribbonToast("Outline in script", state.showOutlineInScript ? "Outline timeline is visible inside the script." : "Outline timeline is hidden inside the script.", "info", 2000);
  }
  function toggleStructureLines() {
    state.showStructureLines = !state.showStructureLines;
    decorateEditor();
    seedStructureMeta();
    persistPrefs();
    syncRibbon();
    ribbonToast("Structure lines", state.showStructureLines ? "Scene structure metadata is visible." : "Structure metadata is hidden.", "info", 2000);
  }
  function seedStructureMeta() {
    const scenes = getScenes(state.doc);
    scenes.forEach((scene) => {
      const el = paragraphElement(scene.id);
      if (!el) return;
      const parts = [scene.title, scene.synopsis, scene.omit ? "Omitted" : ""].filter(Boolean);
      el.dataset.structure = parts.join("  ·  ") || "Scene structure";
    });
  }
  function toggleAltBadges() {
    state.showAlts = !state.showAlts;
    decorateEditor();
    persistPrefs();
    syncRibbon();
    ribbonToast("Alt dialogue badges", state.showAlts ? "Alternate takes are visible in the script." : "Alternate takes are hidden.", "info", 1800);
  }
  function toggleScriptNoteVisibility() {
    state.hideScriptNotes = !state.hideScriptNotes;
    decorateEditor();
    persistPrefs();
    syncRibbon();
    ribbonToast("ScriptNotes", state.hideScriptNotes ? "ScriptNote badges are hidden." : "ScriptNote badges are visible.", "info", 1800);
  }
  function toggleInvisibles() {
    state.showInvisibles = !state.showInvisibles;
    if (els.paper) els.paper.classList.toggle("has-invisibles", state.showInvisibles);
    if (els.editor) els.editor.classList.toggle("has-invisibles", state.showInvisibles);
    persistPrefs();
    syncPrefsUI();
    syncRibbon();
  }
  function toggleNavigatorPanel() {
    state.navigatorVisible = state.navigatorVisible === false;
    const panel = els.scenesPanel;
    if (panel) panel.hidden = !state.navigatorVisible;
    const workspace = $(".workspace");
    if (workspace) workspace.classList.toggle("no-navigator", !state.navigatorVisible);
    requestAnimationFrame(() => fitPaper());
    persistPrefs();
    syncRibbon();
    ribbonToast("Navigator", state.navigatorVisible ? "Scene navigator shown." : "Scene navigator hidden. Toggle it again in View.", "info", 1800);
  }
  function cycleOutlineZoom() {
    state.outlineZoom = state.outlineZoom >= 1.8 ? 1 : state.outlineZoom >= 1.4 ? 1.8 : 1.4;
    renderOutlineAndRuler();
    syncRibbon();
    ribbonToast("Zoom Outline", `Outline editor at ${Math.round(state.outlineZoom * 100)}%.`, "info", 1800);
  }
  function openArrangeDocumentsDialog() {
    openDialog({
      eyebrow: "View · Window",
      title: "Arrange the workspace",
      body: `
        <p class="dialog-note">Azkript edits one screenplay per window. These arrangements restore the reference layouts you can use while writing.</p>
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <button type="button" class="shortcut-row" data-arrange="script" style="border:0;background:transparent;text-align:left"><span>${icon("script")} Script only</span><strong>Focus the page</strong></button>
          <button type="button" class="shortcut-row" data-arrange="vertical" style="border:0;background:transparent;text-align:left"><span>${icon("split")} Script + reference — vertical</span><strong>Side by side</strong></button>
          <button type="button" class="shortcut-row" data-arrange="horizontal" style="border:0;background:transparent;text-align:left"><span>${icon("split-h")} Script + reference — horizontal</span><strong>Stacked</strong></button>
          <button type="button" class="shortcut-row" data-arrange="focus" style="border:0;background:transparent;text-align:left"><span>${icon("focus")} Focus mode</span><strong>Hide the chrome</strong></button>
        </div>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
    $$("[data-arrange]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.arrange;
        closeDialog();
        if (mode === "script") {
          toggleSplitView(false);
          setView("script");
        } else if (mode === "vertical") {
          toggleSplitView(true, "vertical");
        } else if (mode === "horizontal") {
          toggleSplitView(true, "horizontal");
        } else if (mode === "focus") {
          if (!document.body.classList.contains("focus-mode")) toggleFocus();
        }
      });
    });
  }
  async function openOpenDocumentsDialog() {
    const recents = isDesktop && desktop ? await desktop.recent().catch(() => []) : [];
    const rows = (recents || [])
      .map(
        (item) => `<button type="button" class="shortcut-row" data-open-recent="${escapeHtml(item.path)}" style="border:0;background:transparent;text-align:left;width:100%"><span>${icon("file")} ${escapeHtml(item.name || item.path)}</span><strong>${escapeHtml(item.title || "Screenplay")}</strong></button>`,
      )
      .join("");
    openDialog({
      eyebrow: "View · Window",
      title: "Open Documents",
      body: rows
        ? `<div class="shortcut-grid" style="grid-template-columns:1fr">${rows}</div>`
        : `<p class="dialog-note">No recent documents yet. Open an FDX file from the File tab, or start from the Start Center.</p>`,
      actions: [
        { label: "Start Center", onClick: () => { closeDialog(); showStartCenter(); } },
        { label: "Close", kind: "primary" },
      ],
    });
    $$("[data-open-recent]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", async () => {
        const path = button.dataset.openRecent;
        if (!path || !desktop) return;
        closeDialog();
        const file = await desktop.readFile(path);
        if (file && file.contents) {
          await handleOpenDocument({ ...file, path: file.path || path });
        }
      });
    });
  }
  function setTypewriterMode(mode) {
    const value =
      typeof mode === "boolean"
        ? mode
          ? "line"
          : "off"
        : ["off", "frame", "line"].includes(mode)
          ? mode
          : "off";
    state.typewriterMode = value;
    state.typewriterScroll = value !== "off";
    document.body.dataset.typewriter = value;
    persistPrefs();
    syncRibbon();
    ribbonToast(
      "Typewriter mode",
      value === "off"
        ? "Free scrolling restored."
        : value === "frame"
          ? "The writing frame stays centered while the script scrolls."
          : "The active line stays vertically centered.",
      "info",
      2000,
    );
  }
  /* ---------- paragraph + text formatting --------------------------- */
  function computeParagraphLineHeight(paragraph) {
    const base = paragraph.spacing === "2" ? 1.72 : paragraph.spacing === "1.5" ? 1.36 : null;
    if (paragraph.leading === "Tight") return base ? String(base * 0.9) : "1.02";
    if (paragraph.leading === "Loose") return base ? String(base * 1.12) : "1.32";
    return base ? String(base) : "";
  }
  function applyParagraphVisuals(el, paragraph) {
    if (!el || !paragraph) return;
    el.style.textAlign = paragraph.alignment || "";
    el.style.marginTop = paragraph.spaceBefore ? `${Number(paragraph.spaceBefore) || 0}pt` : "";
    const lineHeight = computeParagraphLineHeight(paragraph);
    el.style.lineHeight = lineHeight;
    el.classList.toggle("has-page-break", Boolean(paragraph.pageBreakBefore));
    el.classList.toggle("has-track-change", Boolean(state.trackChanges && paragraph.changeType));
    applyDocumentTypography(el, paragraph);
  }
  function activeRibbonParagraphForFormatting() {
    const paragraph = activeParagraph();
    if (!paragraph) {
      ribbonToast("No paragraph selected", "Place the caret in the script, then apply the format.", "info", 2200);
      return null;
    }
    return paragraph;
  }
  function commitParagraphFormatting(paragraph) {
    const el = paragraphElement(paragraph.id);
    if (el) applyParagraphVisuals(el, paragraph);
    state.layoutDirty = true;
    markDirty();
    state.history.record();
    syncRibbon();
  }
  function applyParagraphAlignment(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.alignment = value;
    else delete paragraph.alignment;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphSpacing(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.spacing = value;
    else delete paragraph.spacing;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphSpaceBefore(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value) paragraph.spaceBefore = value;
    else delete paragraph.spaceBefore;
    commitParagraphFormatting(paragraph);
  }
  function applyParagraphLeading(value) {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    if (value && value !== "Regular") paragraph.leading = value;
    else delete paragraph.leading;
    commitParagraphFormatting(paragraph);
  }
  function revertParagraphFormatting() {
    const paragraph = activeRibbonParagraphForFormatting();
    if (!paragraph) return;
    delete paragraph.alignment;
    delete paragraph.spacing;
    delete paragraph.spaceBefore;
    delete paragraph.leading;
    delete paragraph.pageBreakBefore;
    const el = paragraphElement(paragraph.id);
    if (el) {
      el.style.textAlign = "";
      el.style.marginTop = "";
      el.style.lineHeight = "";
      el.classList.remove("has-page-break");
    }
    state.layoutDirty = true;
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Paragraph reset", "Element defaults restored for this block.", "info", 1800);
  }
  function applyTextColor(color) {
    state.textColor = color;
    persistPrefs();
    if (!restoreRibbonSelection()) {
      ribbonToast("Select text first", "Highlight the words you want to color.", "info", 2400);
      return;
    }
    els.editor.focus();
    try {
      document.execCommand("styleWithCSS", false, true);
      if (color) document.execCommand("foreColor", false, color);
      else document.execCommand("removeFormat", false, null);
    } catch (error) {
      ribbonToast("Color unavailable", error.message || String(error), "warning");
    }
    markDirty();
    state.history.record();
    syncRibbon();
  }
  function applyHighlighter(color) {
    state.highlightColor = color;
    persistPrefs();
    if (!restoreRibbonSelection()) {
      ribbonToast("Select text first", "Highlight the words you want to mark.", "info", 2400);
      return;
    }
    els.editor.focus();
    try {
      document.execCommand("styleWithCSS", false, true);
      if (color) document.execCommand("hiliteColor", false, color);
      else document.execCommand("hiliteColor", false, "transparent");
    } catch (error) {
      ribbonToast("Highlighter unavailable", error.message || String(error), "warning");
    }
    markDirty();
    state.history.record();
    syncRibbon();
  }
  function openCastListOptions() {
    const characters = getCharacters(state.doc);
    const rows = characters.length
      ? characters
          .map(
            (character, index) => `
            <div class="shortcut-row">
              <span style="display:flex;align-items:center;gap:8px"><span class="revision-dot" style="background:${escapeHtml(character.color || "#0f6cbd")}"></span>${escapeHtml(character.name)}</span>
              <input type="text" class="cast-actor-input" data-cast-index="${index}" value="${escapeHtml((state.doc.cast[character.id] && state.doc.cast[character.id].actor) || character.actor || "")}" placeholder="Actor" style="max-width:150px">
            </div>`,
          )
          .join("")
      : `<p class="dialog-note">No speaking characters yet. Write dialogue to populate the cast list.</p>`;
    openDialog({
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
              state.doc.cast[character.id] = state.doc.cast[character.id] || {};
              state.doc.cast[character.id].actor = input.value.trim();
            });
            markDirty();
            state.history.record();
            renderAll();
            toast("Cast list updated", "Actor names are saved with the screenplay.", "success");
          },
        },
      ],
    });
  }
  /* ---------- beat board -------------------------------------------- */
  function toggleBeatSnap() {
    state.beatSnap = !state.beatSnap;
    syncBeatSnapButton();
    persistPrefs();
    syncRibbon();
    ribbonToast("Grid snapping", state.beatSnap ? "Beats snap to the 24 px story grid." : "Beats move freely.", "info", 1800);
  }
  /* The snap toggle is a standalone control, not a `[data-ribbon-command]` node,
   * so syncRibbon() never touches it. Keep its visual and accessible state in
   * one place — the click handler used to toggle the class only, leaving
   * aria-pressed stuck at its initial "true" while the grid was off. */
  function syncBeatSnapButton() {
    const button = $("#beatSnapToggle");
    if (!button) return;
    button.classList.toggle("is-active", state.beatSnap);
    button.setAttribute("aria-pressed", String(state.beatSnap));
  }
  function toggleBeatConnectMode() {
    if (state.view !== "beatboard") setView("beatboard");
    state.beatConnectMode = !state.beatConnectMode;
    state.beatConnectSource = null;
    ribbonToast(
      "Beat connections",
      state.beatConnectMode ? "Click a beat, then another, to draw a story arrow." : "Connection mode off.",
      "info",
      2400,
    );
    syncRibbon();
  }
  function connectBeats(sourceId, targetId) {
    const beats = state.doc.beats || [];
    const source = beats.find((beat) => beat.id === sourceId);
    const target = beats.find((beat) => beat.id === targetId);
    if (!source || !target || source.id === target.id) return;
    source.targetId = target.id;
    markDirty();
    state.history.record();
    renderBeatBoard();
    ribbonToast("Beats connected", `${source.title} → ${target.title}`, "success", 1800);
  }
  function disconnectSelectedBeat() {
    const beatId = state.selectedBeatId;
    const beats = state.doc.beats || [];
    const beat = beatId ? beats.find((entry) => entry.id === beatId) : null;
    if (!beat || !beat.targetId) {
      ribbonToast("No connection selected", "Select a connected beat, then disconnect it.", "info", 2200);
      return;
    }
    delete beat.targetId;
    markDirty();
    state.history.record();
    renderBeatBoard();
    ribbonToast("Connection removed", beat.title, "info", 1800);
  }
  function setBeatConnectionColor(color) {
    state.beatConnectionColor = color;
    persistPrefs();
    const wires = $("#beatBoardWires");
    if (wires) wires.style.setProperty("--beat-wire-color", color);
    renderBeatBoardWires();
    syncRibbon();
  }
  function focusBeat(beatId) {
    if (!beatId) return;
    state.selectedBeatId = beatId;
    if (state.view !== "beatboard") setView("beatboard");
    const card = $(`.beat-card[data-beat-id="${escapeSelector(beatId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      card.classList.add("is-selected");
      setTimeout(() => card.classList.remove("is-selected"), 1400);
    }
    syncRibbon();
  }
  /* ---------- insert ----------------------------------------------- */
  function insertLabelDialog() {
    openDialog({
      eyebrow: "Insert · Label",
      title: "Insert a production label",
      body: `
        <label class="field"><span>Label text</span><input id="labelTextInput" type="text" maxlength="80" placeholder="INSERT - CLOSE ON THE TELESCOPE"></label>
        <label class="field"><span>Color</span><select id="labelColorInput">
          <option value="#0f6cbd">Cobalt</option>
          <option value="#6b48a8">Violet</option>
          <option value="#03787c">Teal</option>
          <option value="#c2500e">Amber</option>
          <option value="#b8252a">Crimson</option>
        </select></label>
        <p class="dialog-note">Labels are production markers that stand apart from action and dialogue.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Insert label",
          kind: "primary",
          onClick: () => {
            const text = $("#labelTextInput", els.dialogBody).value.trim() || "PRODUCTION LABEL";
            const color = $("#labelColorInput", els.dialogBody).value;
            const active = activeParagraph();
            const index = active ? state.doc.paragraphs.indexOf(active) + 1 : state.doc.paragraphs.length;
            const paragraph = makeParagraph("General", "", {});
            paragraph.html = `<span class="script-label" style="--label-color:${escapeHtml(color)}">${escapeHtml(text.toUpperCase())}</span>`;
            state.doc.paragraphs.splice(index, 0, paragraph);
            markDirty();
            state.history.record();
            renderAll();
            setTimeout(() => focusParagraph(paragraph.id, "end"), 30);
            toast("Label inserted", text, "success", 2000);
          },
        },
      ],
    });
  }
  function removeAlternateTake() {
    const paragraph = activeParagraph();
    if (!paragraph || !Array.isArray(paragraph.alts) || !paragraph.alts.length) {
      ribbonToast("No alternate takes", "Select a dialogue paragraph with an alternate take.", "info", 2200);
      return;
    }
    const index = Number(paragraph.activeAlt) || 0;
    paragraph.alts.splice(index, 1);
    paragraph.activeAlt = Math.max(0, Math.min(index, paragraph.alts.length - 1));
    if (!paragraph.alts.length) {
      delete paragraph.alts;
      delete paragraph.activeAlt;
    }
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Alternate removed", "The active take was deleted.", "info", 1800);
  }
  function sendToScriptAction() {
    if (state.view === "beatboard") {
      sendBeatToScript(state.selectedBeatId || "");
    } else if (state.view === "navigator") {
      sendCardsToScript();
    } else {
      ribbonToast("Nothing to send", "Open the Beat Board or Index Cards to send material into the script.", "info", 2600);
    }
  }
  /* ---------- document / production -------------------------------- */
  function openTargetLengthDialog() {
    openDialog({
      eyebrow: "Document · Length",
      title: "Target Script Length",
      body: `
        <div class="field-grid">
          <label class="field"><span>Target pages</span><input id="targetLengthInput" type="number" min="1" max="999" value="${escapeHtml(String(state.doc.settings.targetPages))}"></label>
          <label class="field"><span>Current length</span><input type="text" value="${pageCount()} pages · ${getStats(state.doc).words.toLocaleString()} words" readonly></label>
        </div>
        <p class="dialog-note">Progress appears in the navigator footer, reports and the status bar.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Set target",
          kind: "primary",
          onClick: () => {
            state.doc.settings.targetPages = clamp(Number($("#targetLengthInput", els.dialogBody).value) || 120, 1, 999);
            markDirty();
            state.history.record();
            renderAll();
            toast("Target updated", `${state.doc.settings.targetPages} pages.`, "success", 2000);
          },
        },
      ],
    });
  }
  function editSceneNumberDialog() {
    const paragraph = activeParagraph();
    const scene = paragraph ? sceneForParagraphId(paragraph.id) : null;
    if (!scene) {
      ribbonToast("No scene selected", "Place the caret in a scene heading first.", "info", 2400);
      return;
    }
    openDialog({
      eyebrow: "Production · Scene Numbers",
      title: "Edit Scene Number",
      body: `
        <label class="field"><span>Scene number override</span><input id="sceneNumberInput" type="text" maxlength="12" value="${escapeHtml(scene.number || "")}" placeholder="${escapeHtml(String(scene.index))}"></label>
        <p class="dialog-note">Leave blank to use automatic numbering. Overrides are written to FDX scene properties.</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply",
          kind: "primary",
          onClick: () => {
            const paragraphEl = paragraphElement(scene.id) || paragraphElement(scene.headingParagraphId || "");
            const targetParagraph = state.doc.paragraphs.find((entry) => entry.id === scene.headingParagraphId) || state.doc.paragraphs[scene.startIndex];
            if (!targetParagraph) return;
            targetParagraph.scene = targetParagraph.scene || {};
            const value = $("#sceneNumberInput", els.dialogBody).value.trim();
            if (value) targetParagraph.scene.number = value;
            else delete targetParagraph.scene.number;
            markDirty();
            state.history.record();
            renderAll();
            toast("Scene number updated", value || "Automatic numbering restored.", "success", 2000);
          },
        },
      ],
    });
  }
  function omitCurrentScene() {
    const paragraph = activeParagraph();
    const scene = paragraph ? sceneForParagraphId(paragraph.id) : null;
    if (!scene) {
      ribbonToast("No scene selected", "Place the caret inside a scene first.", "info", 2200);
      return;
    }
    toggleSceneOmit(scene.id);
  }
  function goToPreviousRevision() {
    const revision = state.doc.revision;
    const ordered = (revision.history || []).slice().sort((a, b) => a.id - b.id);
    const currentIndex = ordered.findIndex((entry) => entry.id === revision.current);
    const previous = currentIndex > 0 ? ordered[currentIndex - 1] : null;
    if (!previous) {
      ribbonToast("First revision", "This is already the earliest revision set.", "info", 2400);
      return;
    }
    revision.current = previous.id;
    markDirty();
    renderAll();
    ribbonToast(`Rev ${previous.id} · ${previous.name}`, "Revision color is now used for new marks.", "info", 2400);
  }
  function lockAllPages() {
    state.history.finishBurst();
    state.doc=FDProduction.lock(state.doc,layoutOptions());
    const lockedPages = (state.doc.lockedPages = state.doc.lockedPages || {});
    lockedPages.enabled = true;
    lockedPages.lockedAt = new Date().toISOString();
    lockedPages.lockedPageCount = pageCount();
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Pages locked", `Production page lock recorded at ${pageCount()} pages.`, "success", 2600);
  }
  function unlockAPages() { return productionUI?.locking(); }
  function unlockAllPages() {
    state.history.finishBurst();
    delete state.doc.production.lock;
    const lockedPages = (state.doc.lockedPages = state.doc.lockedPages || {});
    lockedPages.enabled = false;
    lockedPages.lockedAt = null;
    lockedPages.lockedPageCount = 0;
    lockedPages.aPages = [];
    markDirty();
    state.history.record();
    renderAll();
    ribbonToast("Pages unlocked", "Dynamic pagination restored.", "success", 2400);
  }
  function toggleTagsMode() {
    state.tagsMode = !state.tagsMode;
    document.body.classList.toggle("tags-mode", Boolean(state.tagsMode));
    if (state.tagsMode) {
      setView("script");
      document.body.classList.add("tags-mode");
    }
    renderAll();
    syncRibbon();
    ribbonToast("Tags mode", state.tagsMode ? "Production tags are highlighted in the navigator." : "Tags mode off.", "info", 2200);
  }
  /* ---------- speech transport ------------------------------------- */
  function speechPlay() {
    if (!("speechSynthesis" in window)) {
      toast("Table read unavailable", "This browser does not expose speech synthesis.", "warning");
      return;
    }
    if (!state.read.active) {
      openReadDock(false);
      return;
    }
    if (state.read.paused) pauseOrResume();
    else if (!state.read.playing) speakCurrent();
  }
  function speechStop() {
    if (!state.read.active) {
      ribbonToast("Table read", "The table read is not running.", "info", 1800);
      return;
    }
    stopRead();
    ribbonToast("Table read stopped", "Speech playback stopped.", "info", 1800);
  }
  function speechTransport(direction) {
    if (!state.read.active) {
      openReadDock(false);
      return;
    }
    advanceRead(direction);
  }
  /* ---------- tools dialogs ---------------------------------------- */
  function openCollaborationDialog() {
    openDialog({
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
        closeDialog();
        if (action === "export") exportFDX();
        else if (action === "compare") openScriptCompareDialog();
        else {
          const stats = getStats(state.doc);
          const summary = [
            `COLLABORATION SUMMARY — ${state.doc.title || "Untitled Screenplay"}`,
            `By ${state.doc.author || "Unknown writer"}`,
            `${stats.words} words · ${stats.scenes} scenes · ${pageCount()} pages`,
            `Revision set: Rev ${state.doc.revision.current} (${state.doc.revision.enabled ? "on" : "off"})`,
            `Characters: ${getCharacters(state.doc).map((character) => character.name).join(", ") || "none"}`,
          ].join("\n");
          copyText(summary, "Collaboration summary copied", "Paste it with the shared file.");
        }
      });
    });
  }
  function openCombineReportsDialog() {
    const options = [
      ["statistics", "Statistics & pacing", true],
      ["scenes", "Scene breakdown", true],
      ["cast", "Cast and dialogue balance", true],
      ["revisions", "Revision notes", false],
    ];
    openDialog({
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
            copyText(text, "Reports combined", "The combined report is on the clipboard.");
            closeDialog();
          },
        },
      ],
    });
  }
  function buildCombinedReport(parts) {
    const stats = getStats(state.doc);
    const scenes = getScenes(state.doc);
    const characters = getCharacters(state.doc);
    const lines = [
      `SCRIPT REPORT — ${state.doc.title || "Untitled Screenplay"}`,
      state.doc.author ? `By ${state.doc.author}` : "",
      `Generated ${new Date().toLocaleString()} · Rev ${state.doc.revision.current}`,
      "",
    ];
    if (parts.includes("statistics")) {
      lines.push(
        "STATISTICS",
        `Pages: ${pageCount()} / target ${state.doc.settings.targetPages}`,
        `Words: ${stats.words.toLocaleString()}`,
        `Scenes: ${stats.scenes} · Locations: ${stats.locations} · Speaking roles: ${stats.characters}`,
        `Revised blocks: ${stats.revised} · Reading time: ${stats.readingMinutes} min`,
        "",
      );
    }
    if (parts.includes("scenes")) {
      lines.push("SCENE BREAKDOWN");
      scenes.forEach((scene) => {
        lines.push(`${String(scene.index).padStart(2, "0")}. ${scene.heading || "Untitled"} — ${scene.wordCount} words${scene.omit ? " [omitted]" : ""}`);
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
      const revision = state.doc.revision;
      const entry = revisionEntry(state.doc, revision.current);
      lines.push(`Active set: Rev ${revision.current} · ${entry.name} (${revision.enabled ? "on" : "off"})`);
      const counts = new Map();
      state.doc.paragraphs.forEach((paragraph) => {
        if (paragraph.revision) counts.set(paragraph.revision, (counts.get(paragraph.revision) || 0) + 1);
      });
      [...counts.entries()].sort((a, b) => a[0] - b[0]).forEach(([id, count]) => {
        lines.push(`Rev ${id}: ${count} marked blocks`);
      });
      lines.push("");
    }
    return lines.filter((line) => line !== undefined).join("\n");
  }
  function openFormatAssistantDialog() {
    const issues = validateDocument(state.doc);
    const extra = [];
    state.doc.paragraphs.forEach((paragraph, index) => {
      const text = paragraphText(paragraph).trim();
      if (!text) return;
      if (paragraph.type === "Scene Heading" && !/^(INT|EXT|I\/E|EST)[.\s]/i.test(text) && !/^(ACT|END OF ACT)/i.test(text)) {
        extra.push({ code: "SCENE_HEADING", message: `Scene heading “${text.slice(0, 48)}” does not start with INT./EXT.`, index });
      }
      if (paragraph.type === "Character" && text !== text.toUpperCase()) {
        extra.push({ code: "CHARACTER_CASE", message: `Character cue “${text.slice(0, 48)}” should be uppercase.`, index });
      }
    });
    const all = [...issues, ...extra];
    openDialog({
      eyebrow: "Tools · Format Assistant",
      title: all.length ? `${all.length} formatting note${all.length === 1 ? "" : "s"}` : "Formatting looks clean",
      body: all.length
        ? `<div class="shortcut-grid" style="grid-template-columns:1fr">${all
            .slice(0, 30)
            .map(
              (issue) =>
                `<button type="button" class="shortcut-row" data-format-jump="${issue.index != null ? issue.index : ""}" style="border:0;background:transparent;text-align:left;width:100%"><span><strong>${escapeHtml(issue.code)}</strong><br>${escapeHtml(issue.message)}</span><kbd>${escapeHtml(issue.severity || "note")}</kbd></button>`,
            )
            .join("")}</div><p class="dialog-note">Click a note to jump to the paragraph in the script.</p>`
        : `<p class="dialog-note">No scene-heading or character-cue problems were found. The document also passed the structural validation check.</p>`,
      actions: [
        { label: "Run document check", onClick: () => { closeDialog(); validateDocumentAction(); } },
        { label: "Done", kind: "primary" },
      ],
    });
    $$("[data-format-jump]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const target = state.doc.paragraphs[Number(button.dataset.formatJump)];
        if (!target) return;
        closeDialog();
        setView("script");
        focusParagraph(target.id, "start");
      });
    });
  }
  /* ---------- help & account --------------------------------------- */
  function appVersionString() {
    if (state.appInfo && state.appInfo.version) return state.appInfo.version;
    return "1.2.0";
  }
  function openWebsite(url) {
    if (!url) return;
    if (isDesktop && desktop && desktop.openExternal) {
      desktop.openExternal(url).catch(() => {});
      toast("Opening browser", url, "info", 2200);
      return;
    }
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast("Link unavailable", url, "warning", 2600);
    }
  }
  function openWelcomeDialog() {
    openDialog({
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
        closeDialog();
        if (button.dataset.welcome === "template") showStartCenter();
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
    openDialog({
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
    openDialog({
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
        closeDialog();
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
      ["Structure the story", "Use the Beat Board and Outline Editor to plan acts and turning points.", () => { setView("beatboard"); }],
      ["Write production-ready pages", "Revision colors, A-pages and locked pages for a production draft.", () => { openRevisionManager(); }],
      ["Run a table read", "Hear your screenplay with per-character voices and follow the highlighted page.", () => { openReadDock(false); }],
    ];
    openDialog({
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
        closeDialog();
        if (tutorial) tutorial[2]();
      });
    });
  }
  function openSamplesDialog() {
    const samples = [
      ["The Last Signal", "A feature opening: scene headings, action, dual dialogue and a revision pass.", () => loadSample()],
      ["Feature template", "A blank feature screenplay with the standard element flow.", () => { newDocument("feature", true); }],
      ["TV pilot template", "A pilot structure ready for act breaks and teaser scenes.", () => { newDocument("tv", true); }],
      ["Stage play template", "Acts, scenes and stage-direction conventions.", () => { newDocument("stage", true); }],
    ];
    openDialog({
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
        closeDialog();
        if (sample) sample[2]();
      });
    });
  }
  function openCheckUpdatesDialog() {
    const version = appVersionString();
    openDialog({
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
    openDialog({
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
            copyText(
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
  function normalizeProfile() {
    const profile = state.profile || {};
    const name = String(profile.name || "Local Writer").trim();
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "LW";
    return { name, initials, role: String(profile.role || "Writer") };
  }
  function applyProfile() {
    const profile = normalizeProfile();
    state.profile = profile;
    const avatar = els.avatar;
    if (avatar) {
      avatar.textContent = profile.initials;
      avatar.title = `${profile.name} · ${profile.role}`;
    }
    persistPrefs();
  }
  function openAccountDialog() {
    const profile = normalizeProfile();
    openDialog({
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
            state.profile = {
              name: $("#accountName", els.dialogBody).value.trim() || "Local Writer",
              role: $("#accountRole", els.dialogBody).value,
            };
            applyProfile();
            closeDialog();
            toast("Profile saved", "The workspace now greets you by name.", "success");
          },
        },
      ],
    });
  }
  function signOutAction() {
    confirmAction("Sign out of the local profile?", "The display name and initials will be cleared from this workspace.", "Sign out", () => {
      state.profile = { name: "Local Writer", role: "Writer" };
      applyProfile();
      toast("Signed out", "The local profile is cleared. Your screenplay is untouched.", "info");
    });
  }
  function openAboutDialog() {
    openDialog({
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
  function selectionHasCapsStyle() {
    try {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return false;
      let node = selection.anchorNode;
      while (node && node !== els.editor) {
        if (node.nodeType === 1 && node.classList && node.classList.contains("caps-style")) return true;
        node = node.parentNode;
      }
      const paragraph = activeParagraph();
      return Boolean(paragraph && /caps-style/.test(paragraph.html || ""));
    } catch {
      return false;
    }
  }
  function applyAllCapsStyle() {
    if (!restoreRibbonSelection()) {
      ribbonToast("Select text first", "Highlight the words you want to set in capitals.", "info", 2400);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      ribbonToast("Select text first", "Highlight the words you want to set in capitals.", "info", 2400);
      return;
    }
    let node = selection.anchorNode;
    while (node && node !== els.editor) {
      if (node.nodeType === 1 && node.classList && node.classList.contains("caps-style")) {
        const parent = node.parentNode;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        const paragraph = activeParagraph();
        if (paragraph) {
          const el = paragraphElement(paragraph.id);
          if (el) syncParagraphElement(el);
        }
        markDirty();
        state.history.record();
        syncRibbon();
        return;
      }
      node = node.parentNode;
    }
    const text = selection.toString();
    if (!text) return;
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(
      "insertHTML",
      false,
      '<span class="caps-style" style="text-transform: uppercase">' + escapeHtml(text) + "</span>",
    );
    const paragraph = activeParagraph();
    if (paragraph) {
      const el = paragraphElement(paragraph.id);
      if (el) syncParagraphElement(el);
    }
    markDirty();
    state.history.record();
    syncRibbon();
  }
  function openLockedPageNumberDialog() { return productionUI?.locking(); }
  /* Legacy action name compatibility for the command palette & old markup. */
  function handleRibbonAction(action) {
    const legacy = {
      "midnight-mode": () => applyTheme(resolveTheme(state.theme) === "midnight" ? "light" : "midnight"),
      "toggle-alts": () => toggleAltBadges(),
      "toggle-invisibles": () => toggleInvisibles(),
      "track-changes": () => toggleTrackChanges(),
      "omit-scene": () => omitCurrentScene(),
      "toggle-scene-nums": () => {
        state.doc.settings.sceneNumbers = !state.doc.settings.sceneNumbers;
        markDirty();
        renderAll();
      },
      "sprint-timer": () => toggleSprintWidget(),
      "start-center": () => showStartCenter(),
      "save-as": () => saveDocument({ saveAs: true }),
      "export-txt": () => exportFountainOrText("txt"),
      "print": () => printDocument(),
      "spellcheck": () => openSpellcheckDialog(),
      "names-db": () => openNamesDatabaseDialog(),
      "assign-voices": () => openAssignVoicesDialog(),
      "highlight-chars": () => openHighlightCharactersDialog(),
      "rename-char": () => openRenameCharacterDialog(),
      "reformat-tool": () => openReformatDialog(),
      "script-compare": () => openScriptCompareDialog(),
      "writing-stats": () => openWritingStatsDialog(),
      "revision-toggle": () => toggleRevisionMode(),
      "revision-next": () => startNextRevision(),
      "lock-pages": () => openLockPagesDialog(),
      "tags-mode": () => toggleTagsMode(),
      "tag-all-chars": () => tagAllCharacters(),
      "bookmarks": () => openBookmarksDialog(false),
      "insert-bookmark": () => openBookmarksDialog(true),
      "goto": () => openGoToDialog(),
    };
    if (legacy[action]) {
      legacy[action]();
      return;
    }
    runRibbonCommand(action);
  }
  /* ------------------------------------------------------------------ */
  /* scene navigator                                                     */
  /* ------------------------------------------------------------------ */
  function matchesScene(scene, query) {
    if (!query) return true;
    const haystack = `${scene.heading} ${scene.synopsis} ${scene.notes} ${scene.location} ${scene.timeOfDay}`.toLowerCase();
    return haystack.includes(query);
  }
  function renderScenes() {
    const scenes = getScenes(state.doc);
    const query = state.sceneQuery.trim().toLowerCase();
    const filtered = scenes.filter((scene) => matchesScene(scene, query));
    const pages = scenePageMap();
    els.sceneCount.textContent = String(scenes.length);
    els.sceneList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "scene-list__empty";
      empty.innerHTML = `${icon("scene")}<span>${query ? "No scenes match that search." : "Add a scene heading to begin."}</span><button class="pill-btn" type="button">Add scene</button>`;
      empty.querySelector("button").addEventListener("click", insertScene);
      els.sceneList.appendChild(empty);
    } else {
      filtered.forEach((scene, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `scene-item${scene.index - 1 === state.activeScene ? " is-active" : ""}${scene.omit ? " is-omitted" : ""}`;
        button.style.setProperty("--i", String(index));
        button.style.setProperty("--scene-color", scene.color);
        button.dataset.sceneId = scene.id;
        button.innerHTML = `
          <span class="scene-index">${String(scene.index).padStart(2, "0")}</span>
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
    if (state.view === "sceneview") renderSceneView();
    if (state.view === "reports") renderReports();
  }
  function renderNavigatorSubTabs(query = "") {
    const notesList = $("#navNotesList");
    const charsList = $("#navCharsList");
    const tagsList = $("#navTagsList");
    if (notesList) {
      const notedParas = state.doc.paragraphs.filter((p) => p.note && String(p.note).trim());
      const sceneNotes = getScenes(state.doc).filter((s) => s.notes && String(s.notes).trim());
      const items = [
        ...notedParas.map((p) => ({
          id: p.id,
          title: `ScriptNote · ${p.type}`,
          meta: String(p.note),
          color: "#ca5010",
          onClick: () => {
            setView("script");
            focusParagraph(p.id, "start");
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
      if (addBtn) addBtn.addEventListener("click", openScriptNote);
    }
    if (charsList) {
      const chars = getCharacters(state.doc).filter(
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
      state.doc.paragraphs.forEach((p) => {
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
          setView("script");
          focusParagraph(btn.dataset.navTagPara, "start");
        });
      });
      const addTagBtn = $("#navAddTagBtn", tagsList);
      if (addTagBtn) addTagBtn.addEventListener("click", openTagsDialog);
      const tagAllBtn = $("#navTagAllCharsBtn", tagsList);
      if (tagAllBtn) tagAllBtn.addEventListener("click", tagAllCharacters);
    }
  }
  function setNavigatorTab(tab) {
    state.navTab = ["scenes", "notes", "characters", "tags"].includes(tab) ? tab : "scenes";
    $$(".navigator-tab").forEach((btn) => {
      const active = btn.dataset.navTab === state.navTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (els.sceneList) els.sceneList.hidden = state.navTab !== "scenes";
    const notesList = $("#navNotesList");
    const charsList = $("#navCharsList");
    const tagsList = $("#navTagsList");
    if (notesList) notesList.hidden = state.navTab !== "notes";
    if (charsList) charsList.hidden = state.navTab !== "characters";
    if (tagsList) tagsList.hidden = state.navTab !== "tags";
  }
  function goToScene(scene) {
    setView("script");
    setMode("write");
    requestAnimationFrame(() => {
      const el = paragraphElement(scene.id);
      if (!el) return;
      placeCaret(el, "start");
      setActiveParagraph(scene.id);
      scrollParagraphIntoView(el, "center", true);
      state.activeScene = scene.index - 1;
      renderScenes();
      renderOutlineAndRuler();
    });
  }
  /* `SCENE_ANCHOR_FRACTION` and `sceneAnchorOffset()` live near the top of this IIFE,
   * just above scrollParagraphIntoView, because that is their first consumer. */
  function updateActiveSceneFromScroll() {
    if (state.scrollTick) return;
    state.scrollTick = true;
    requestAnimationFrame(() => {
      state.scrollTick = false;
      if (state.mode !== "write" && state.mode !== "speed") return;
      const headings = $$(".type-scene-heading", els.editor);
      if (!headings.length) return;
      const containerTop = els.paperScroll.getBoundingClientRect().top;
      /* null means the reading viewport is not laid out yet (see sceneAnchorOffset).
       * Nothing has scrolled, so there is no scene position to derive — skipping is
       * correct, and better than measuring against a guessed band. The explicit
       * navigation intent is deliberately NOT consumed here, so it still applies on the
       * first tick that has real geometry. */
      const offset = sceneAnchorOffset();
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
      const navigatedId = state.navigatedSceneId;
      if (navigatedId) {
        const scenes = getScenes(state.doc);
        const navigatedIndex = scenes.findIndex((scene) => scene.id === navigatedId);
        const heading = headings[navigatedIndex];
        /* Once the programmatic scroll has finished, stop forcing: from then on the
         * geometry is authoritative and free scrolling must track the viewport. Before
         * that, keep the target pinned so the highlight does not flash through every
         * scene the smooth scroll passes. `state.navigationInFlight` is cleared by the
         * settle timer in scrollParagraphIntoView, or here once the scroll has arrived. */
        const arrived = state.navigationTarget != null &&
          Math.abs(els.paperScroll.scrollTop - state.navigationTarget) <= 2;
        if (arrived) state.navigationInFlight = false;
        const clamped = !heading || heading.getBoundingClientRect().top > anchor + 1;
        if (navigatedIndex >= 0 && (clamped || state.navigationInFlight)) {
          active = navigatedIndex;
          forced = true;
        }
        /* Consume the intent only when it is no longer needed: a clamped target keeps it
         * for the settle window, then the next tick releases it. */
        if (!state.navigationInFlight) {
          state.navigatedSceneId = null;
          state.navigationTarget = null;
        }
      }
      if (active !== state.activeScene || forced) {
        state.activeScene = active;
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
        const scenes = getScenes(state.doc);
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
  /* ------------------------------------------------------------------ */
  /* scene view / index cards / beat board / cast / reports              */
  /* ------------------------------------------------------------------ */
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
    const cols = state.sceneViewCols || { title: true, summary: true, action: true };
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
          const actionPreview = state.doc.paragraphs
            .slice(scene.startIndex + 1, scene.endIndex)
            .map(paragraphText)
            .join(" ")
            .trim();
          return `
            <div class="sv-row${scene.omit ? " is-omitted" : ""}" data-sv-scene="${escapeHtml(scene.id)}" style="--scene-color:${escapeHtml(scene.color || "#0f6cbd")};--i:${idx}">
              <span class="sv-cell sv-cell--num"><i class="sv-color-bar"></i>${escapeHtml(scene.number || String(scene.index))}</span>
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
                  ? `<span class="sv-cell sv-cell--action" title="${escapeHtml(actionPreview || "—")}">${escapeHtml(truncate(actionPreview || "—", 95))}</span>`
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
        const target = getScenes(state.doc).find((s) => s.id === input.dataset.svTitle);
        if (target) {
          target.paragraph.scene = { ...(target.paragraph.scene || {}), title: input.value.trim() };
          markDirty();
          state.history.record();
          renderScenes();
        }
      });
    });
    $$("[data-sv-synopsis]", table).forEach((input) => {
      input.addEventListener("change", () => {
        const target = getScenes(state.doc).find((s) => s.id === input.dataset.svSynopsis);
        if (target) {
          target.paragraph.scene = { ...(target.paragraph.scene || {}), synopsis: input.value };
          markDirty();
          state.history.record();
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
      btn.addEventListener("click", () => openSceneDetails(btn.dataset.svEdit));
    });
  }
  function renderNavigator() {
    const scenes = getScenes(state.doc);
    const query = state.navigatorQuery.trim().toLowerCase();
    const filtered = scenes.filter((scene) => matchesScene(scene, query));
    const pages = scenePageMap();
    els.sceneGrid.innerHTML = "";
    const cols = Number(state.cardsAcross) || 0;
    if (cols >= 1 && cols <= 9) {
      els.sceneGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    } else {
      els.sceneGrid.style.removeProperty("grid-template-columns");
    }
    $$("#cardModeSegmented .segmented__item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.cardMode === state.cardMode);
    });
    if (!filtered.length) {
      els.sceneGrid.innerHTML = `<div class="scene-list__empty">${icon("grid")}<span>${query ? "No cards match that search." : "Add a scene heading to start the board."}</span></div>`;
      return;
    }
    filtered.forEach((scene, index) => {
      const card = document.createElement("article");
      card.className = `scene-card${scene.omit ? " is-omitted" : ""}${state.cardMode === "script" ? " is-script-card" : ""}`;
      card.style.setProperty("--i", String(index));
      card.style.setProperty("--scene-color", scene.color);
      card.dataset.sceneId = scene.id;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `Open scene ${scene.index}: ${scene.heading}`);
      const sceneLines = state.doc.paragraphs
        .slice(scene.startIndex + 1, scene.endIndex)
        .map((p) => `${p.type === "Character" ? `${paragraphText(p)}: ` : ""}${paragraphText(p)}`)
        .filter(Boolean);
      const snippet = sceneLines.join(" ").trim();
      const bodyText =
        state.cardMode === "script"
          ? snippet || "No script lines in this scene yet."
          : scene.synopsis || snippet || "An empty scene. Open it and give it a first line.";
      card.innerHTML = `
        <div class="scene-card__top">
          <span class="scene-card__number">${String(scene.index).padStart(2, "0")}</span>
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
          ${scene.revisionCount ? `<span class="revision-dot revision-dot--mini" style="--revision-color:${revisionEntry(state.doc, scene.paragraph.revision || 1).hex}"></span>` : ""}
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
        openSceneDetails(scene.id);
      });
      card.querySelector('[data-card-action="omit"]').addEventListener("click", (event) => {
        event.stopPropagation();
        card.classList.add("is-omitting");
        setTimeout(() => toggleSceneOmit(scene.id), 120);
      });
      card.addEventListener("dragstart", (event) => {
        state.dragScene = scene.id;
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/x-fd-scene", scene.id);
        document.body.classList.add("is-reordering");
      });
      card.addEventListener("dragend", () => {
        state.dragScene = null;
        card.classList.remove("is-dragging");
        clearDropHints();
        document.body.classList.remove("is-reordering");
      });
      card.addEventListener("dragover", (event) => {
        if (!state.dragScene || state.dragScene === scene.id) return;
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
        const fromId = event.dataTransfer.getData("text/x-fd-scene") || state.dragScene;
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
    const beats = state.doc.beats || [];
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
        state.history.finishBurst();
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
        beat.x = state.beatSnap ? Math.round(rawX / 24) * 24 : rawX;
        beat.y = state.beatSnap ? Math.round(rawY / 24) * 24 : rawY;
        el.style.left = `${beat.x}px`;
        el.style.top = `${beat.y}px`;
        if (!wireFrame) wireFrame = requestAnimationFrame(() => { wireFrame = null; renderBeatBoardWires(); });
      });
      const finishDrag = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("is-dragging");
        if (wireFrame) { cancelAnimationFrame(wireFrame); wireFrame = null; renderBeatBoardWires(); }
        if (moved) { markDirty({layout:false}); state.history.record(); }
      };
      el.addEventListener("pointerup", finishDrag);
      el.addEventListener("pointercancel", finishDrag);
      el.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        openBeatDialog(beat.id);
      });
      el.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        if (state.beatConnectMode) {
          if (!state.beatConnectSource) {
            state.beatConnectSource = beat.id;
            state.selectedBeatId = beat.id;
            el.classList.add("is-connect-source");
            ribbonToast("Connection started", "Click another beat to draw the story arrow.", "info", 2200);
          } else if (state.beatConnectSource !== beat.id) {
            connectBeats(state.beatConnectSource, beat.id);
            state.beatConnectSource = null;
            $$(".beat-card", canvas).forEach((card) => card.classList.remove("is-connect-source"));
          }
          return;
        }
        state.selectedBeatId = beat.id;
        $$(".beat-card", canvas).forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.beatId === beat.id);
        });
        syncRibbon();
      });
      if (state.beatConnectSource === beat.id) el.classList.add("is-connect-source");
      if (state.selectedBeatId === beat.id) el.classList.add("is-selected");
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
            state.doc.beats = (state.doc.beats || []).filter((b) => b.id !== btn.dataset.beatDel);
            markDirty();
            state.history.record();
            renderBeatBoard();
          }, 180);
        } else {
          state.doc.beats = (state.doc.beats || []).filter((b) => b.id !== btn.dataset.beatDel);
          markDirty();
          state.history.record();
          renderBeatBoard();
        }
      });
    });
    renderBeatBoardWires();
  }
  function renderBeatBoardWires() {
    const wires = $("#beatBoardWires");
    if (!wires) return;
    const beats = state.doc.beats || [];
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
      const color = state.beatConnectionColor || beat.color || "#0f6cbd";
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
    const scenes = getScenes(state.doc);
    const from = scenes.find((scene) => scene.id === fromId);
    const to = scenes.find((scene) => scene.id === toId);
    if (!from || !to) return;
    const slice = state.doc.paragraphs.slice(from.startIndex, from.endIndex);
    let target = before ? to.startIndex : to.endIndex;
    if (from.startIndex < target) target -= slice.length;
    const rest = state.doc.paragraphs.filter(
      (_paragraph, index) => index < from.startIndex || index >= from.endIndex,
    );
    target = clamp(target, 0, rest.length);
    rest.splice(target, 0, ...slice);
    state.doc.paragraphs = rest;
    markDirty();
    state.history.record();
    renderAll();
    renderNavigator();
    toast("Scene moved", `“${from.heading}” now sits at ${plural(scenes.indexOf(from) + 1, "position")} in the board.`, "success", 2200);
  }
  function toggleSceneOmit(sceneId) {
    const scene = getScenes(state.doc).find((item) => item.id === sceneId);
    if (!scene) return;
    scene.paragraph.scene = {
      ...(scene.paragraph.scene || {}),
      omit: !scene.omit,
    };
    if (state.doc.revision.enabled) markRevision(state.doc, scene.paragraph);
    markDirty();
    state.history.record();
    renderAll();
    renderNavigator();
    toast(
      scene.omit ? "Scene restored" : "Scene omitted",
      scene.omit
        ? `${scene.heading} is back in the printed draft.`
        : `${scene.heading} stays in the editor but is skipped in page view and exports.`,
      "info",
      2600,
    );
  }
  function scenesWithPages() {
    const pages = scenePageMap();
    return getScenes(state.doc).map((scene) => ({
      ...scene,
      displayPage: pages.get(scene.id) || scene.startPage,
    }));
  }
  function renderCharacters() {
    const characters = getCharacters(state.doc);
    const stats = getStats(state.doc);
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
      const isHighlighted = Boolean((state.doc.characterHighlights || {})[character.name]);
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
    (state.doc.nonSpeaking || []).forEach((ns, index) => {
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
    if (!characters.length && !(state.doc.nonSpeaking || []).length) {
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
    const paragraph = state.doc.paragraphs.find(
      (item) =>
        item.type === "Character" &&
        paragraphText(item).toUpperCase().startsWith(character.name),
    );
    if (paragraph) {
      setView("script");
      setMode("write");
      focusParagraph(paragraph.id, "start");
    }
  }
  function renderReports() {
    const stats = getStats(state.doc);
    const layout = getLayout();
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
      btn.classList.toggle("is-active", btn.dataset.reportType === state.reportType);
    });
    renderCustomReportPanel(state.reportType, stats, scenes, totalPages);
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
        const labelText = scene.heading.split(" - ")[0] || `Scene ${scene.index}`;
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
        <div class="longest-scene__meta"><span>Scene ${stats.longestScene.index}</span><span>${stats.longestScene.wordCount} words</span><span>${stats.longestScene.startPage}p</span></div>
        <div class="longest-scene__meter"><span style="width:${clamp((stats.longestScene.wordCount / max) * 100, 8, 100)}%"></span></div>`;
    } else {
      els.longestScene.innerHTML = `<p class="subtle">Add at least one scene heading to see the longest scene.</p>`;
    }
    const target = Math.max(1, state.doc.settings.targetPages);
    const percent = clamp(Math.round((totalPages / target) * 100), 0, 100);
    els.targetReport.innerHTML = `
      <div class="target-report__number"><strong>${totalPages}</strong><span>of ${target} pages</span></div>
      <div class="target-report__track"><span style="width:${percent}%"></span></div>
      <p>${percent >= 90 ? "The draft is at or past the target. Time for a read-through." : `${Math.max(0, target - totalPages)} pages to the target. ${stats.revised ? `${stats.revised} revised blocks.` : "No revisions marked yet."}`}</p>
      <button class="text-btn" id="targetEdit">Edit target</button>`;
    const locations = getLocations(state.doc);
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
            <span>${String(scene.index).padStart(2, "0")}</span>
            <span>${escapeHtml(scene.heading || "Untitled scene")}${scene.omit ? " <em>omitted</em>" : ""}</span>
            <span>${escapeHtml(scene.location || "—")}</span>
            <span>${scene.omit ? "—" : scene.displayPage}</span>
            <span>${scene.wordCount}</span>
            <span>${scene.revisionCount ? `<i class="revision-dot revision-dot--mini" style="--revision-color:${revisionEntry(state.doc, scene.paragraph.revision || 1).hex}"></i>` : "—"}</span>
          </button>`,
        )
        .join("")}`;
    $$("[data-report-scene]", els.reportsView).forEach((button) => {
      button.addEventListener("click", () => {
        const scene = getScenes(state.doc).find((item) => item.id === button.dataset.reportScene);
        if (scene) goToScene(scene);
      });
    });
    const targetEdit = $("#targetEdit", els.targetReport);
    if (targetEdit) {
      targetEdit.addEventListener("click", () => {
        setView("script");
        setInspectorTab("document");
        toggleInspector(true);
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
      const locs = getLocations(state.doc);
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Location</span><span>INT / EXT</span><span>Scenes</span><span>Words</span><span>Share</span></div>${locs
        .map(
          (loc, i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(loc.name)}</span><span>${loc.interiors ? `INT (${loc.interiors})` : ""} ${loc.exteriors ? `EXT (${loc.exteriors})` : ""}</span><span>${loc.scenes}</span><span>${loc.words}</span><span>${Math.round((loc.scenes / Math.max(1, scenes.length)) * 100)}%</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "character" || type === "cast") {
      const chars = getCharacters(state.doc);
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Character</span><span>Role / Actor</span><span>Speeches</span><span>Words</span><span>Scenes</span></div>${chars
        .map(
          (c, i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(c.name)}</span><span>${escapeHtml(c.actor || "Speaking")}${c.notes ? ` — ${escapeHtml(truncate(c.notes, 45))}` : ""}</span><span>${c.speeches}</span><span>${c.dialogueWords}</span><span>${c.sceneCount}</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "script") {
      const counts = {};
      state.doc.paragraphs.forEach((p) => {
        counts[p.type] = (counts[p.type] || 0) + 1;
      });
      body.innerHTML = `<div class="scene-table"><div class="scene-table__head"><span>#</span><span>Element Type</span><span>Shortcut</span><span>Paragraphs</span><span>Share</span><span>Next Element</span></div>${Object.entries(counts)
        .map(
          ([k, count], i) =>
            `<div class="scene-table__row"><span>${i + 1}</span><span>${escapeHtml(k)}</span><span>Alt+${escapeHtml((ELEMENTS[k] && ELEMENTS[k].shortcut) || "—")}</span><span>${count}</span><span>${Math.round((count / Math.max(1, state.doc.paragraphs.length)) * 100)}%</span><span>${escapeHtml((ELEMENTS[k] && ELEMENTS[k].next) || "Action")}</span></div>`,
        )
        .join("")}</div>`;
    } else if (type === "note") {
      const notes = [
        ...state.doc.paragraphs
          .filter((p) => p.note)
          .map((p) => ({ kind: `Paragraph (${p.type})`, head: truncate(paragraphText(p), 48), text: p.note })),
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
      state.doc.paragraphs.forEach((p) => {
        (p.tags || []).forEach((t) => tags.push({ ...t, paraType: p.type, snippet: truncate(paragraphText(p), 50) }));
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
    const stats = getStats(state.doc);
    const scenes = scenesWithPages();
    const lines = [
      `${state.doc.title || "Untitled Screenplay"}`,
      `by ${state.doc.author || "Unknown"}`,
      "",
      `${stats.words} words · ${pageCount()} pages · ${stats.scenes} scenes · ${stats.characters} speaking roles · ${stats.locations} locations`,
      "",
      "SCENES",
      ...scenes.map(
        (scene) =>
          `${String(scene.index).padStart(2, "0")}. ${scene.heading} — ${scene.wordCount} words, p.${scene.displayPage}${scene.omit ? " [omitted]" : ""}`,
      ),
      "",
      "LOCATIONS",
      ...getLocations(state.doc).map((location) => `${location.name} — ${location.scenes} scenes / ${location.words} words`),
      "",
      "CHARACTERS",
      ...getCharacters(state.doc).map(
        (character) => `${character.name} — ${character.speeches} speeches / ${character.dialogueWords} words / ${character.sceneCount} scenes`,
      ),
    ];
    return lines.join("\n");
  }
  /* ------------------------------------------------------------------ */
  /* inspector                                                           */
  /* ------------------------------------------------------------------ */
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
      changeElementType(button.dataset.type);
    });
    els.elementSelect.addEventListener("change", () => changeElementType(els.elementSelect.value));
  }
  function sceneForParagraphId(id) {
    const index = state.doc.paragraphs.findIndex((paragraph) => paragraph.id === id);
    if (index < 0) return null;
    return getScenes(state.doc).find((scene) => scene.startIndex <= index && index < scene.endIndex) || null;
  }
  function renderInspector() {
    const paragraph = activeParagraph() || state.doc.paragraphs[0];
    if (paragraph) {
      state.selectedId = paragraph.id;
      syncInspectorForParagraph(paragraph.id);
    }
    renderInsights();
    els.titleInput.value = state.doc.title;
    els.authorInput.value = state.doc.author;
    els.targetPagesInput.value = String(state.doc.settings.targetPages);
    els.sceneNumbersToggle.classList.toggle("is-on", state.doc.settings.sceneNumbers);
    els.sceneNumbersToggle.setAttribute("aria-checked", String(state.doc.settings.sceneNumbers));
    $$(".theme-swatch").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.themeChoice === state.theme);
    });
    renderSceneInspector();
    renderRevisionChrome();
  }
  function renderSceneInspector() {
    const paragraph = activeParagraph();
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
    const displayPage = scenePageMap().get(scene.id) || scene.startPage;
    els.sceneInspectorMeta.textContent = `Scene ${scene.index} · ${scene.wordCount} words · ${scene.omit ? "omitted" : `page ${displayPage}`}`;
    els.sceneNumberInput.value = scene.paragraph.scene?.number || "";
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
    const paragraph = activeParagraph();
    const scene = paragraph ? sceneForParagraphId(paragraph.id) : null;
    if (!scene) return;
    scene.paragraph.scene = {
      ...(scene.paragraph.scene || {}),
      ...patch,
    };
    markDirty();
    state.history.schedule();
    scheduleChrome();
    if (state.view === "sceneview") renderSceneView();
    if (state.view === "navigator") renderNavigator();
  }
  function setInspectorTab(tab) {
    state.inspectorTab = tab;
    renderViewChrome();
    if (tab === "insights") renderInsights();
    if (tab === "scene") renderSceneInspector();
    if (tab === "document") {
      els.targetPagesInput.value = String(state.doc.settings.targetPages);
      renderRevisionChrome();
    }
  }
  /* ------------------------------------------------------------------ */
  /* views, panels, focus mode                                           */
  /* ------------------------------------------------------------------ */
  const viewTransitionTimers = new WeakMap();
  function setView(view) {
    if (!["script", "sceneview", "navigator", "beatboard", "characters", "reports"].includes(view)) return;
    hideSmartType();
    const changed = state.view !== view;
    if (!changed) return;
    const prevView = state.view;
    const animate = !prefersReducedMotion();
    state.view = view;
    $$(".view").forEach((panel) => {
      clearTimeout(viewTransitionTimers.get(panel));
      const active = panel.dataset.viewPanel === view;
      const outgoing = panel.dataset.viewPanel === prevView;
      panel.inert = !active;
      if (active) {
        panel.hidden = false;
        panel.classList.add("is-active");
        panel.classList.remove("is-exiting");
        /* Restart the ONE entrance animation. `is-active` deliberately carries no
         * animation of its own (see the note in styles.css): the transition lives only
         * on `is-entering`, so it runs once and then stops when the class is dropped.
         * Adding a second animated class here is what previously made every view change
         * animate twice, ~350ms apart. */
        panel.classList.remove("is-entering");
        if (animate) {
          void panel.offsetWidth;
          panel.classList.add("is-entering");
          viewTransitionTimers.set(panel, setTimeout(() => panel.classList.remove("is-entering"), 360));
        }
      } else if (outgoing && animate) {
        panel.classList.remove("is-entering");
        panel.classList.add("is-exiting");
        viewTransitionTimers.set(panel, setTimeout(() => {
          if (panel.dataset.viewPanel !== state.view) {
            panel.hidden = true;
            panel.classList.remove("is-active", "is-exiting");
          }
        }, 140));
      } else {
        panel.hidden = true;
        panel.classList.remove("is-active", "is-entering", "is-exiting");
      }
    });
    if (view === "sceneview") renderSceneView();
    if (view === "navigator") renderNavigator();
    if (view === "beatboard") renderBeatBoard();
    if (view === "characters") renderCharacters();
    if (view === "reports") renderReports();
    renderViewChrome();
    if (view === "script") {
      requestAnimationFrame(() => {
        fitPaper();
        updateActiveSceneFromScroll();
      });
    }
  }
  function setMode(mode) {
    if (!["write", "page", "speed"].includes(mode)) return;
    hideSmartType();
    state.mode = mode;
    const write = mode !== "page";
    els.paperScroll.hidden = !write;
    els.pagePreview.hidden = write;
    els.editorWatermark.textContent = mode === "page" ? "PAGE" : mode === "speed" ? "SPEED" : "WRITE";
    els.paperScroll.parentElement.classList.toggle("is-page-mode", !write);
    document.body.classList.toggle("page-mode", !write);
    if (els.editor) els.editor.classList.toggle("speed-view-on", mode === "speed");
    if (!write) renderPagePreview();
    if (write) {
      requestAnimationFrame(() => {
        fitPaper();
        updateActiveSceneFromScroll();
      });
    }
    renderViewChrome();
    renderPageDock();
    renderStatus();
    persistPrefs();
  }
  function toggleInspector(force) {
    const inspector = $(".inspector");
    if (inspector) inspector.inert = false;
    /* Match the CSS breakpoint that turns the inspector into a drawer
     * (styles.css / styles-ribbon.css both switch at 1200px). Using 1080px here
     * meant that between 1080 and 1199px — including the app's own minimum
     * window width — the desktop branch toggled a class on a `display: none`
     * element and the button appeared dead. */
    if (window.matchMedia("(max-width: 1200px)").matches) {
      const open =
        typeof force === "boolean" ? force : !els.workspace.classList.contains("inspector-open");
      els.workspace.classList.toggle("inspector-open", open);
    } else {
      const closed =
        typeof force === "boolean"
          ? !force
          : !els.appShell.classList.contains("inspector-closed");
      els.appShell.classList.toggle("inspector-closed", closed);
    }
    requestAnimationFrame(() => {
      if (state.mode !== "page") fitPaper();
    });
  }
  function toggleRail() {
    const collapsed = !document.body.classList.contains("rail-collapsed");
    document.body.classList.toggle("rail-collapsed", collapsed);
    if (els.appShell) els.appShell.classList.toggle("rail-collapsed", collapsed);
    requestAnimationFrame(() => {
      if (state.mode !== "page") fitPaper();
      const activeRail = $(".rail__item[data-view].is-active");
      if (activeRail && els.railIndicator) {
        els.railIndicator.style.transform = `translateX(${activeRail.offsetLeft}px)`;
        els.railIndicator.style.width = `${activeRail.offsetWidth}px`;
      }
    });
  }
  function toggleFocus() {
    const focus = !document.body.classList.contains("focus-mode");
    document.body.classList.toggle("focus-mode", focus);
    els.focusToggle.classList.toggle("is-active", focus);
    let exit = $(".focus-exit");
    if (focus && !exit) {
      exit = document.createElement("button");
      exit.className = "focus-exit";
      exit.type = "button";
      exit.innerHTML = `${icon("arrow-left")} Exit focus`;
      exit.addEventListener("click", toggleFocus);
      document.body.appendChild(exit);
    }
    if (exit) exit.hidden = !focus;
    if (focus) {
      requestAnimationFrame(() => fitPaper());
      toast("Focus mode", "Chrome hidden. Press Esc or the exit button to return.", "info", 2400);
    }
  }
  /* ------------------------------------------------------------------ */
  /* pagination, page dock, print                                        */
  /* ------------------------------------------------------------------ */
  function renderPageDock() {
    if (!els.pageDock) return;
    const layout = getLayout();
    const pages = layout.pages;
    const show = state.mode === "page" && pages.length > 0;
    els.pageDock.hidden = !show;
    if (!show) return;
    state.pageIndex = clamp(state.pageIndex, 0, pages.length - 1);
    const current = pages[state.pageIndex];
    const scriptPages = getLayout().scriptPageCount;
    els.pageDockLabel.textContent =
      current && current.kind === "title"
        ? `Title · ${scriptPages} ${scriptPages === 1 ? "page" : "pages"}`
        : `${current ? current.label || current.number : state.pageIndex + 1} / ${scriptPages}`;
    els.pagePrev.disabled = state.pageIndex <= 0;
    els.pageNext.disabled = state.pageIndex >= pages.length - 1;
    if (els.pageDots) {
      if (pages.length <= 18) {
        els.pageDots.innerHTML = pages
          .map(
            (page, index) =>
              `<button type="button" class="page-dot${index === state.pageIndex ? " is-active" : ""}" data-page-index="${index}" aria-label="Page ${index + 1}"></button>`,
          )
          .join("");
        $$(".page-dot", els.pageDots).forEach((dot) => {
          dot.addEventListener("click", () => goToPage(Number(dot.dataset.pageIndex)));
        });
      } else {
        els.pageDots.innerHTML = "";
      }
    }
    $$(".page-card", els.pagePreview).forEach((card, index) => {
      card.classList.toggle("is-current", index === state.pageIndex);
    });
  }
  function scrollToPage(index, smooth = true) {
    const cards = $$(".page-card", els.pagePreview);
    const card = cards[index];
    if (!card) return;
    const top = card.offsetTop - 10;
    if (smooth && !prefersReducedMotion()) {
      els.pagePreview.scrollTo({ top, behavior: "smooth" });
      card.classList.remove("is-turning");
      void card.offsetWidth;
      card.classList.add("is-turning");
      setTimeout(() => card.classList.remove("is-turning"), 700);
    } else {
      els.pagePreview.scrollTop = top;
    }
    state.pageIndex = index;
    renderPageDock();
  }
  function goToPage(index) {
    const pages = getLayout().pages;
    state.pageIndex = clamp(index, 0, pages.length - 1);
    scrollToPage(state.pageIndex, true);
  }
  function updatePageFromScroll() {
    if (state.mode !== "page" || state.scrollTick) return;
    state.scrollTick = true;
    requestAnimationFrame(() => {
      state.scrollTick = false;
      const cards = $$(".page-card", els.pagePreview);
      if (!cards.length) return;
      const top = els.pagePreview.scrollTop + 30;
      let active = 0;
      cards.forEach((card, index) => {
        if (card.offsetTop <= top) active = index;
      });
      if (active !== state.pageIndex) {
        state.pageIndex = active;
        renderPageDock();
      }
    });
  }
  function renderPagePreview() {
    if (state.mode !== "page") return;
    const layout = getLayout();
    const previousIndex = state.pageIndex;
    if (pagePreviewObserver) pagePreviewObserver.disconnect();
    els.pagePreview.innerHTML = "";
    const lazy = layout.pages.length > 24 && "IntersectionObserver" in window;
    const makePlaceholder = (page, index) => {
      const card = document.createElement("article"); card.className = "page-card page-lazy";
      card.dataset.pageIndex = String(index); card.dataset.page = String(page.number || "");
      card.style.setProperty("--page-w", `${state.doc.page.width}in`);
      card.style.setProperty("--page-h", `${state.doc.page.height}in`);
      card.style.zoom = String(state.zoom * state.fit);
      card.setAttribute("aria-label", `${page.kind === "title" ? "Title page" : `Page ${page.number}`} preview`);
      card.textContent = page.kind === "title" ? "Title page" : `Page ${page.number}`;
      return card;
    };
    if (lazy) pagePreviewObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const old = entry.target;
        if (!old.isConnected) continue;
        const index = Number(old.dataset.pageIndex), page = layout.pages[index];
        if (entry.isIntersecting && old.classList.contains("page-lazy")) {
          const card = buildPageCard(page, false); card.dataset.pageIndex = String(index);
          card.style.zoom = String(state.zoom * state.fit);
          pagePreviewObserver.unobserve(old); old.replaceWith(card); pagePreviewObserver.observe(card);
        } else if (!entry.isIntersecting && !old.classList.contains("page-lazy")) {
          const card = makePlaceholder(page, index);
          pagePreviewObserver.unobserve(old); old.replaceWith(card); pagePreviewObserver.observe(card);
        }
      }
    }, { root: els.pagePreview, rootMargin: "1000px 0px" });
    layout.pages.forEach((page, index) => {
      const card = lazy ? makePlaceholder(page, index) : buildPageCard(page, false);
      card.style.setProperty("--i", String(index));
      if (index === previousIndex) card.classList.add("is-current");
      els.pagePreview.appendChild(card);
      if (lazy) pagePreviewObserver.observe(card);
    });
    applyZoom();
    const max = Math.max(0, layout.pages.length - 1);
    state.pageIndex = clamp(previousIndex, 0, max);
    requestAnimationFrame(() => {
      fitPaper();
      const cards = $$(".page-card", els.pagePreview);
      if (cards[state.pageIndex]) {
        els.pagePreview.scrollTop = cards[state.pageIndex].offsetTop - 10;
      }
      renderPageDock();
    });
  }
  function buildPageCard(page, forPrint) {
    const spacing = LINE_SPACING_OPTIONS[state.lineSpacing] || LINE_SPACING_OPTIONS.normal;
    const card = document.createElement("article");
    card.className = `page-card${page.kind === "title" ? " page-card--title" : ""}${forPrint ? " print-page" : ""}`;
    card.dataset.page = String(page.number || "");
    card.style.setProperty("--page-w", `${state.doc.page.width}in`);
    card.style.setProperty("--page-h", `${state.doc.page.height}in`);
    card.style.setProperty("--page-top", `${state.doc.page.top}in`);
    card.style.setProperty("--page-bottom", `${state.doc.page.bottom}in`);
    card.style.setProperty("--script-font", scriptFontStack(state.font));    card.style.setProperty("--script-size", `${state.fontSize}pt`);
    card.style.setProperty("--script-line-height", spacing.css);
    const applyCardWatermark = (target) => {
      const wm = state.doc.watermark || {};
      if (wm.enabled && wm.text) {
        target.classList.add("has-watermark");
        target.dataset.watermark = wm.text;
        target.style.setProperty("--wm-opacity", String((Number(wm.opacity) || 14) / 100));
      }
    };
    if (page.kind === "title") {
      card.innerHTML = titlePageMarkup(page.titlePage, false);
      applyCardWatermark(card);
      return card;
    }
    const title = (state.doc.title || "Untitled Screenplay").toUpperCase();
    const revision = state.doc.revision.enabled
      ? revisionEntry(state.doc, state.doc.revision.current)
      : null;
    const hf = state.doc.headerFooter || {};
    const startPage = Math.max(1, Number(hf.startingPageNumber || hf.startingPage || 1));
    const pageNumber = page.label || ((Number(page.number) || 1) + startPage - 1);
    const folio = state.doc.settings.pageNumbers !== false ? `${escapeHtml(String(pageNumber))}.` : "";
    const headerText =
      hf.headerText ||
      [hf.left, hf.center, hf.right].filter(Boolean).join("    ");
    const showHeader =
      hf.showHeader !== false &&
      hf.enabled !== false &&
      (page.number > 1 || hf.showOnFirstPage);
    const header = document.createElement("div");
    header.className = "page-card__header";
    const headerLabel = showHeader && headerText ? headerText.replace(/\{PAGE\}/g, String(pageNumber)) : title;
    header.innerHTML = `<span class="page-card__title">${escapeHtml(headerLabel)}</span><span class="page-card__folio">${folio}</span>`;
    const body = document.createElement("div");
    body.className = "page-card__body screenplay-editor";
    body.style.height = `${(state.doc.page.height - state.doc.page.top - state.doc.page.bottom).toFixed(3)}in`;
    for (const block of page.blocks) {
      body.appendChild(buildPublishedBlock(block));
    }
    if (page.omitted) { const notice = document.createElement('p'); notice.textContent='OMITTED'; body.appendChild(notice); }
    const footer = document.createElement("div");
    footer.className = "page-card__footer";
    const revisedCount = page.blocks.reduce(
      (count, block) =>
        count +
        (block.kind === "paragraph" && block.paragraph && block.paragraph.revision ? 1 : 0),
      0,
    );
    const footerText =
      hf.footerText ||
      [hf.footerLeft, hf.footerRight].filter(Boolean).join("    ");
    const footerLeft = hf.showFooter && footerText ? footerText.replace(/\{PAGE\}/g, String(pageNumber)) : state.doc.title || "";
    footer.innerHTML = `<span>${escapeHtml(footerLeft)}</span><span>${revision ? `${escapeHtml(revision.name)} revision${revisedCount ? ` · ${revisedCount} marks` : ""}` : "AZKRIPT"}</span>`;
    card.append(header, body, footer);
    applyCardWatermark(card);
    card.addEventListener("click", (event) => {
      const target = event.target.closest(".pub-para[data-id]");
      if (!target) return;
      setMode("write");
      setView("script");
      requestAnimationFrame(() => focusParagraph(target.dataset.id, "start"));
    });
    return card;
  }
  function buildPublishedBlock(block) {
    if (block.kind === "more") {
      const more = document.createElement("div");
      more.className = "pub-more";
      more.textContent = block.text || (state.doc.moresContinueds && state.doc.moresContinueds.dialogueMore) || "(MORE)";
      return more;
    }
    if (block.kind === "dual") {
      const wrapper = document.createElement("div");
      wrapper.className = "dual-block pub-dual";
      const geometry = block.geometry || FDPagination.dualGeometry(state.doc, layoutOptions());
      wrapper.style.width = `${geometry.widthInches}in`;
      wrapper.style.marginLeft = `${geometry.leftInches}in`;
      for (const column of block.columns || []) {
        const cell = document.createElement("div");
        cell.className = "dual-col";
        for (const item of column.blocks) {
          cell.appendChild(publishedParagraph(item));
        }
        wrapper.appendChild(cell);
      }
      return wrapper;
    }
    return publishedParagraph(block);
  }
  function publishedParagraph(block) {
    const paragraph = block.paragraph;
    const el = document.createElement("div");
    el.className = `para pub-para type-${slug(block.type)}${block.isContinuation ? " is-continued" : ""}`;
    el.dataset.id = paragraph ? paragraph.id : "";
    el.dataset.type = block.type;
    el.dataset.placeholder = "";
    if (paragraph) applyDocumentTypography(el, paragraph, true);
    if (block.font) {
      el.style.fontFamily = `${JSON.stringify(block.font.font)}, "Courier New", monospace`;
      el.style.fontSize = `${block.font.size}pt`;
    }
    if (block.lineHeight) el.style.lineHeight = `${block.lineHeight}pt`;
    if (block.geometry) {
      el.style.marginLeft = `${block.geometry.left}in`;
      el.style.marginRight = `${state.doc.page.width - block.geometry.right}in`;
      el.style.textIndent = `${block.geometry.first}in`;
    }
    // A continuation block always has its own sliced HTML; only fall back to the
    // full paragraph HTML for blocks that begin the paragraph.
    el.innerHTML = block.html != null
      ? block.html
      : !block.isContinuation && paragraph
        ? paragraph.html
        : "";
    if (block.revision) {
      const revision = revisionEntry(state.doc, block.revision);
      el.classList.add("has-revision");
      el.style.setProperty("--revision-color", revision.hex);
    }
    if (block.sceneNumber && state.doc.settings.sceneNumbers) {
      const side = state.doc.settings.sceneNumberSide || "both";
      if (side === "both" || side === "left") {
        const left = document.createElement("span");
        left.className = "scene-number scene-number--left";
        left.textContent = block.sceneNumber;
        el.appendChild(left);
      }
      if (side === "both" || side === "right") {
        const right = document.createElement("span");
        right.className = "scene-number scene-number--right";
        right.textContent = block.sceneNumber;
        el.appendChild(right);
      }
    }
    return el;
  }
  function titlePageMarkup(titlePage, compact) {
    if (!titlePage) return "";
    const values = titlePage;
    return `
      <div class="title-page${compact ? " title-page--compact" : ""}">
        <div class="title-page__top">${values.notes ? `<span>${escapeHtml(values.notes)}</span>` : ""}</div>
        <div class="title-page__center">
          <h1>${escapeHtml(values.title || state.doc.title || "Untitled Screenplay")}</h1>
          <span class="title-page__rule"></span>
          <p class="title-page__credit">${escapeHtml(values.credit || "Written by")}</p>
          <p class="title-page__author">${escapeHtml(values.author || state.doc.author || "")}</p>
          ${values.source ? `<p class="title-page__source">${escapeHtml(values.source)}</p>` : ""}
        </div>
        <div class="title-page__bottom">
          ${values.draftDate ? `<p>${escapeHtml(values.draftDate)}</p>` : ""}
          ${values.contact ? `<p>${escapeHtml(values.contact)}</p>` : ""}
        </div>
      </div>`;
  }
  function renderPrintRoot(selectedPages) {
    const layout = getLayout(true);
    if (state.layoutError) throw new Error(state.layoutError);
    els.printRoot.innerHTML = "";
    (selectedPages || layout.pages).forEach((page) => {
      const card = buildPageCard(page, true);
      els.printRoot.appendChild(card);
    });
    els.printStyle.textContent = `@page { size: ${state.doc.page.width}in ${state.doc.page.height}in; margin: 0; }`;
    document.body.classList.add("is-printing");
  }
  function cleanupPrint() {
    document.body.classList.remove("is-printing");
    els.printRoot.innerHTML = "";
  }
  async function runPreflight(selectedPages) {
    const layout=getLayout(true);
    if(state.layoutError)throw new Error(state.layoutError);
    renderPrintRoot(selectedPages);
    try {
      await document.fonts.ready;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const fonts=new Set(state.doc.paragraphs.map(p=>FDPagination.paragraphTypography(state.doc,p,layoutOptions()).font));
      const missingFonts=[...fonts].filter(font=>FDCoreWriting.typography(font,state.fontSize).available!==true);
      const domIssues=[...els.printRoot.querySelectorAll('.page-card__body,.pub-para')].filter(el=>el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2).map(el=>'Rendered text exceeds its box: '+el.textContent.slice(0,80));
      return FDProduction.preflight(state.doc,layout,{missingFonts,domIssues});
    } finally { cleanupPrint(); }
  }
  async function exportPDF(options = {}) {
    try {
      const exportVersion=state.editVersion;
      if(options.expectedVersion!==undefined&&options.expectedVersion!==exportVersion)throw new Error('The draft changed. Preview the revision packet again.');
      const pages=Array.isArray(options.pages)?options.pages:undefined;
      if(pages&&!pages.length)throw new Error('There are no changed pages to export.');
      const preflight=await runPreflight(pages);
      if(state.editVersion!==exportVersion)throw new Error('The draft changed during preflight. Export again.');
      if(!preflight.ok)throw new Error('PDF preflight failed: '+preflight.issues.filter(i=>i.severity==='error').map(i=>i.message).join('; '));
      renderPrintRoot(pages);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if(state.editVersion!==exportVersion)throw new Error('The draft changed while preparing the PDF. Export again.');
      if (isDesktop) {
        const result = await desktop.exportPdf({
          defaultName: (state.doc.title || "screenplay") + (options.suffix || ''),
        });
        if (!result.canceled) {
          toast("PDF exported", `${result.name} is ready to share.`, "success");
        }
      } else {
        window.print();
      }
    } catch (error) {
      toast("PDF export failed", error.message || "Could not render the PDF.", "error");
    } finally {
      setTimeout(cleanupPrint, 300);
    }
  }
  async function printDocument() {
    try {
      renderPrintRoot();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (isDesktop) {
        const result = await desktop.print({
          pageSize: { width: state.doc.page.width, height: state.doc.page.height },
        });
        if (result && result.ok === false && result.reason) {
          toast("Printing cancelled", String(result.reason), "info", 2600);
        }
      } else {
        window.print();
      }
    } catch (error) {
      toast("Print failed", error.message || "Could not open the print dialog.", "error");
    } finally {
      setTimeout(cleanupPrint, 500);
    }
  }
  /* ------------------------------------------------------------------ */
  /* dialogs, toasts, command palette                                    */
  /* ------------------------------------------------------------------ */
  const modalCloseTokens = new WeakMap();
  function invalidateModalClose(dialog) { modalCloseTokens.set(dialog, (modalCloseTokens.get(dialog) || 0) + 1); }
  function closeModalAnimated(dialog, callback) {
    if (!dialog || !dialog.open) {
      if (callback) callback();
      return;
    }
    const token = (modalCloseTokens.get(dialog) || 0) + 1;
    modalCloseTokens.set(dialog, token);
    /* An interrupted close used to latch here forever: `is-closing` stayed on
     * the element, every later close returned early, and the dialog became
     * impossible to dismiss from the UI. Rather than bailing out, finish the
     * close immediately — it is always safer to let the user out. */
    if (dialog.classList.contains("is-closing")) {
      dialog.classList.remove("is-closing");
      try {
        dialog.close();
      } catch (_) {}
      if (callback) callback();
      return;
    }
    if (prefersReducedMotion()) {
      dialog.close();
      if (callback) callback();
      return;
    }
    dialog.classList.add("is-closing");
    const duration = 180;
    setTimeout(() => {
      if (modalCloseTokens.get(dialog) !== token) return;
      dialog.classList.remove("is-closing");
      try {
        dialog.close();
      } catch (_) {}
      if (callback) callback();
    }, duration);
  }
  function closeDialog(callback) {
    closeModalAnimated(els.dialog, callback);
  }
  /* Wire a dialog switch so its visual state and its ARIA state move together.
  *
  * Six dialogs had a hand-rolled `sw.classList.toggle("is-on")` listener that
  * flipped the class but never touched `aria-checked`, so screen readers
  * announced the pre-click state forever (verified desync in Header/Footer and
  * Watermark). Routing every dialog switch through this helper makes the two
  * states impossible to separate.
  */  function bindDialogSwitch(id) {
    const sw = $(`#${id}`, els.dialogBody);
    if (!sw) return null;
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("is-on");
      sw.classList.toggle("is-on", next);
      sw.setAttribute("aria-checked", String(next));
    });
    return sw;
  }
  function closeCommandDialog(callback) {
    closeModalAnimated(els.commandDialog, callback);
  }
  /* Every openDialog() bumps this counter. An action handler that replaces the
   * dialog content (e.g. a confirm prompt opened from a settings dialog) is
   * detected by the generation changing underneath it, so the outer handler
   * must not close the dialog the inner one just opened. Before this, "Clear
   * local data" showed its confirmation for one frame and closed it again. */
  let dialogGeneration = 0;
  function openDialog({ eyebrow, title, body, actions = [], wide = false }) {
    invalidateModalClose(els.dialog);
    hideSmartType();
    dialogGeneration += 1;
    els.dialog.classList.remove("is-closing");
    els.dialog.classList.toggle("app-dialog--wide", Boolean(wide));
    els.dialogEyebrow.textContent = eyebrow || "Azkript";
    els.dialogTitle.textContent = title || "Dialog";
    els.dialogBody.innerHTML = body || "";
    // A switch's adjacent visible heading is not an accessible name. Bind
    // it explicitly before the dialog enters the platform accessibility tree.
    $$("[role='switch']", els.dialogBody).forEach((control, index) => {
      if (control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby")) return;
      const row = control.closest(".setting-line, .toggle-row, .shortcut-row, .field");
      const label = row && (row.querySelector("strong") || row.querySelector(":scope > span"));
      if (!label || !label.textContent.trim()) return;
      if (!label.id) label.id = `dialog-switch-label-${dialogGeneration}-${index}`;
      control.setAttribute("aria-labelledby", label.id);
    });
    els.dialogActions.innerHTML = "";
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn${action.kind ? ` btn--${action.kind}` : ""}`;
      button.textContent = action.label;
      const generation = dialogGeneration;
      button.addEventListener("click", () => {
        if (action.keepOpen) {
          action.onClick && action.onClick();
        } else {
          if (action.onClick) action.onClick();
          /* The handler may have opened a follow-up dialog in this same
           * element. Only close if nothing replaced it. */
          if (dialogGeneration === generation) closeDialog();
        }
      });
      els.dialogActions.appendChild(button);
    });
    if (!els.dialog.open) els.dialog.showModal();
    requestAnimationFrame(() => {
      const first = els.dialogBody.querySelector("input, select, textarea, button");
      if (first) first.focus();
    });
  }
  function confirmAction(title, message, confirmLabel, onConfirm) {
    openDialog({
      eyebrow: "Please confirm",
      title,
      body: `<p>${escapeHtml(message)}</p><div class="dialog-note">${isDesktop ? "A recovery copy is kept while this window is open." : "Your current draft is autosaved in this browser."}</div>`,
      actions: [
        { label: "Cancel" },
        { label: confirmLabel, kind: "danger", onClick: onConfirm },
      ],
    });
  }
  function toast(title, message, type = "info", duration = 3800) {
    /* Cap the stack, removing overflow synchronously: dismissToast animates
       asynchronously, so a plain while-loop would spin forever. */
    while (els.toastStack.children.length >= 4) {
      const oldest = els.toastStack.firstElementChild;
      if (!oldest) break;
      oldest.remove();
    }
    const toastEl = document.createElement("div");
    toastEl.className = `toast toast--${type}`;
    toastEl.style.setProperty("--toast-duration", `${duration}ms`);
    const iconName =
      type === "success" ? "check" : type === "warning" || type === "error" ? "warning" : "sparkle";
    toastEl.innerHTML = `<span class="toast__icon">${icon(iconName)}</span><div class="toast__body"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div><span class="toast__progress"></span>`;
    toastEl.addEventListener("click", () => dismissToast(toastEl));
    els.toastStack.appendChild(toastEl);
    setTimeout(() => dismissToast(toastEl), duration);
  }
  function dismissToast(el) {
    if (!el || !el.isConnected || el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 260);
  }
  function commandActions() {
    const scenes = getScenes(state.doc);
    const base = [
      { id: "compatibility", label: "Review FDX compatibility", group: "File", icon: "check-circle", run: openCompatibilityInspector },
      { id: "native-metadata", label: "Edit native FDX metadata", group: "File", icon: "sliders", run: openNativeMetadataEditor },
      { id: "history", label: "Version history and restore", group: "File", icon: "backup", run: openVersionHistory },
      { id: "file-status", label: "Compare external file changes", group: "File", icon: "folder", run: openFileStatus },
      { id: "writing-reliability", label: "Typography and accessibility", group: "View", icon: "sliders", run: openWritingReliability },
      { id: "start", label: "Open Start Center", group: "File", icon: "sparkle", shortcut: "Ctrl Shift O", run: showStartCenter },
      { id: "new", label: "New screenplay", group: "File", icon: "plus", shortcut: "Ctrl N", run: newDocument },
      { id: "open", label: "Open FDX file", group: "File", icon: "folder", shortcut: "Ctrl O", run: openFilePicker },
      { id: "save", label: isDesktop ? "Save screenplay" : "Save locally", group: "File", icon: "save", shortcut: "Ctrl S", run: () => saveDocument() },
      { id: "saveas", label: "Save as…", group: "File", icon: "save", shortcut: "Ctrl Shift S", run: () => saveDocument({ saveAs: true }) },
      { id: "export", label: "Export as FDX", group: "File", icon: "download", shortcut: "", run: exportFDX },
      { id: "pdf", label: "Export as PDF", group: "File", icon: "download", shortcut: "Ctrl Shift E", run: exportPDF },
      { id: "print", label: "Print screenplay", group: "File", icon: "page", shortcut: "Ctrl P", run: printDocument },
      { id: "undo", label: "Undo", group: "Edit", icon: "undo", shortcut: "Ctrl Z", run: undo },
      { id: "redo", label: "Redo", group: "Edit", icon: "redo", shortcut: "Ctrl Y", run: redo },
      { id: "find", label: "Find in screenplay", group: "Edit", icon: "search", shortcut: "Ctrl F", run: () => openFind("find") },
      { id: "replace", label: "Find and replace", group: "Edit", icon: "replace", shortcut: "Ctrl H", run: () => openFind("replace") },
      { id: "titlepage", label: "Edit title page", group: "Document", icon: "title", shortcut: "", run: openTitlePage },
      { id: "pagesetup", label: "Page setup", group: "Document", icon: "page", shortcut: "", run: openPageSetup },
      { id: "revision", label: "Revision manager", group: "Document", icon: "revision", shortcut: "", run: openRevisionManager },
      { id: "revision-toggle", label: state.doc.revision.enabled ? "Turn off revision marks" : "Turn on revision marks", group: "Document", icon: "revision", shortcut: "Ctrl Alt V", run: toggleRevisionMode },
      { id: "revision-next", label: "Start next revision", group: "Document", icon: "revision", shortcut: "Ctrl Alt N", run: startNextRevision },
      { id: "read", label: "Start table read", group: "Tools", icon: "headphones", shortcut: "Ctrl Alt R", run: () => openReadDock(false) },
      { id: "read-here", label: "Read from here", group: "Tools", icon: "headphones", shortcut: "", run: () => openReadDock(true) },
      { id: "theme", label: `Switch to ${resolveTheme(state.theme) === "light" ? "dark" : "light"} theme`, group: "View", icon: resolveTheme(state.theme) === "light" ? "moon" : "sun", shortcut: "", run: toggleTheme },
      { id: "focus", label: "Toggle focus mode", group: "View", icon: "focus", shortcut: "Esc exits", run: toggleFocus },
      { id: "view-script", label: "Open script editor", group: "View", icon: "script", shortcut: "Ctrl 1", run: () => setView("script") },
      { id: "view-sceneview", label: "Open Scene View table", group: "View", icon: "table", shortcut: "", run: () => setView("sceneview") },
      { id: "view-cards", label: "Open index cards", group: "View", icon: "grid", shortcut: "Ctrl 2", run: () => setView("navigator") },
      { id: "view-beatboard", label: "Open Beat Board", group: "View", icon: "board", shortcut: "", run: () => setView("beatboard") },
      { id: "view-cast", label: "Open characters", group: "View", icon: "users", shortcut: "Ctrl 3", run: () => setView("characters") },
      { id: "view-reports", label: "Open reports", group: "View", icon: "chart", shortcut: "Ctrl 4", run: () => setView("reports") },
      { id: "write", label: "Switch to Normal / Write view", group: "View", icon: "script", shortcut: "", run: () => { setView("script"); setMode("write"); } },
      { id: "page", label: "Switch to Page preview", group: "View", icon: "page", shortcut: "Ctrl Alt P", run: () => { setView("script"); setMode("page"); } },
      { id: "speed", label: "Switch to Speed View", group: "View", icon: "eye", shortcut: "", run: () => { setView("script"); setMode("speed"); } },
      { id: "midnight", label: "Toggle Midnight Mode", group: "View", icon: "moon", shortcut: "", run: () => applyTheme(resolveTheme(state.theme) === "midnight" ? "light" : "midnight") },
      { id: "scene", label: "Add a new scene", group: "Script", icon: "scene", shortcut: "Ctrl Enter", run: insertScene },
      { id: "scene-prev", label: "Previous scene", group: "Script", icon: "scene", shortcut: "Ctrl Alt ↑", run: () => moveScene(-1) },
      { id: "scene-next", label: "Next scene", group: "Script", icon: "scene", shortcut: "Ctrl Alt ↓", run: () => moveScene(1) },
      { id: "scene-details", label: "Edit current scene card", group: "Script", icon: "grid", shortcut: "Ctrl Shift D", run: openSceneDetails },
      { id: "dual-dialogue", label: "Toggle dual dialogue", group: "Format", icon: "dual", shortcut: "Ctrl D", run: toggleDualDialogue },
      { id: "alt-dialogue", label: "Manage Alt Dialogue takes", group: "Format", icon: "dual", shortcut: "", run: openAltDialogueDialog },
      { id: "case-cycle", label: "Change paragraph case", group: "Format", icon: "case", shortcut: "", run: cycleCase },
      { id: "element-settings", label: "Script Elements settings", group: "Format", icon: "sliders", shortcut: "", run: openElementSettings },
      { id: "header-footer", label: "Header and Footer setup", group: "Document", icon: "page", shortcut: "", run: openHeaderFooterDialog },
      { id: "mores", label: "Mores and Continueds", group: "Document", icon: "align", shortcut: "", run: openMoresDialog },
      { id: "smarttype", label: "SmartType autocomplete lists", group: "Document", icon: "sparkle", shortcut: "", run: openSmartTypeDialog },
      { id: "macros", label: "Keyboard Macros", group: "Document", icon: "macros", shortcut: "", run: openMacrosDialog },
      { id: "bookmarks", label: "Bookmarks manager", group: "Document", icon: "bookmark", shortcut: "", run: () => openBookmarksDialog(false) },
      { id: "watermark", label: "Page Watermark", group: "Document", icon: "water", shortcut: "", run: openWatermarkDialog },
      { id: "script-note", label: "Insert or edit ScriptNote", group: "Insert", icon: "note", shortcut: "Ctrl Shift N", run: openScriptNote },
      { id: "thesaurus", label: "Open Thesaurus", group: "Tools", icon: "book", shortcut: "Shift F7", run: openThesaurus },
      { id: "spellcheck", label: "Spelling and proofing check", group: "Tools", icon: "check-circle", shortcut: "F7", run: openSpellcheckDialog },
      { id: "names-db", label: "Character Names Database", group: "Tools", icon: "users", shortcut: "", run: openNamesDatabaseDialog },
      { id: "highlight-chars", label: "Highlight Characters in Script", group: "Tools", icon: "highlight", shortcut: "", run: openHighlightCharactersDialog },
      { id: "rename-char", label: "Rename Character Everywhere", group: "Tools", icon: "replace", shortcut: "", run: openRenameCharacterDialog },
      { id: "script-compare", label: "ScriptCompare Draft Diff", group: "Tools", icon: "compare", shortcut: "", run: openScriptCompareDialog },
      { id: "writing-stats", label: "Writing Tracker & Statistics", group: "Tools", icon: "chart", shortcut: "", run: openWritingStatsDialog },
      { id: "sprint-timer", label: "Toggle Writing Sprint Timer", group: "Tools", icon: "timer", shortcut: "", run: () => toggleSprintWidget() },
      { id: "tags-mode", label: "Production Breakdown Tags", group: "Production", icon: "tag", shortcut: "", run: openTagsDialog },
      { id: "lock-pages", label: "Lock Pages / A-Pages", group: "Production", icon: "lock", shortcut: "", run: openLockPagesDialog },
      { id: "outline-toggle", label: "Toggle Outline Editor timeline", group: "View", icon: "scene", shortcut: "", run: () => toggleOutlineLayer() },
      { id: "ruler-toggle", label: "Toggle horizontal ruler", group: "View", icon: "ruler", shortcut: "", run: () => toggleRulerLayer() },
      { id: "split-toggle", label: "Toggle split view", group: "View", icon: "split", shortcut: "", run: () => toggleSplitView() },
      { id: "validate", label: "Run document check", group: "Tools", icon: "check", shortcut: "", run: validateDocumentAction },
      { id: "outline", label: "Copy scene outline", group: "Tools", icon: "grid", shortcut: "", run: copyOutline },
      { id: "report", label: "Copy full script report", group: "Tools", icon: "chart", shortcut: "", run: copyReport },
      { id: "settings", label: "Open settings", group: "Tools", icon: "settings", shortcut: "", run: openSettings },
      { id: "help", label: "Keyboard shortcuts", group: "Tools", icon: "help", shortcut: "F1", run: openHelp },
    ];
    const sceneActions = scenes.map((scene, index) => ({
      id: `scene-${index}`,
      label: `Go to scene ${scene.index}: ${scene.heading}${scene.omit ? " (omitted)" : ""}`,
      group: "Scenes",
      icon: "scene",
      shortcut: `p.${scene.startPage}`,
      run: () => goToScene(scene),
    }));
    const ribbonPalette = [];
    const seenLabels = new Set(base.map((command) => command.label.toLowerCase()));
    const walkRibbon = (items) => {
      (items || []).forEach((item) => {
        if (!item) return;
        if (item.kind === "col") {
          walkRibbon(item.items);
          return;
        }
        if (!item.command || !item.label) return;
        if (seenLabels.has(item.label.toLowerCase())) return;
        seenLabels.add(item.label.toLowerCase());
        ribbonPalette.push({
          id: `ribbon-${item.command}`,
          label: item.label,
          group: "Ribbon",
          icon: item.icon || "sparkle",
          shortcut: "",
          run: () => runRibbonCommand(item.command),
        });
      });
    };
    RIBBON_TAB_DEFS.forEach((tab) => {
      (RIBBON_MODEL[tab.id] || []).forEach((group) => {
        (group.rows || []).forEach((row) => walkRibbon(row));
      });
    });
    return [...(storyUI?.commands() || []), ...(productionUI?.commands() || []), ...(workspaceUI?.commands() || []), ...base, ...ribbonPalette, ...sceneActions];
  }
  function openPrintPreviewDialog() {
    const pages = pageCount();
    const layout = getLayout();
    const title = state.doc.title || "Untitled Screenplay";
    openDialog({
      eyebrow: "File · Print Preview",
      title: "Print Preview",
      body: `
        <div class="shortcut-grid" style="grid-template-columns:1fr">
          <div class="shortcut-row"><span>Document</span><strong>${escapeHtml(title)}</strong></div>
          <div class="shortcut-row"><span>Pages</span><strong>${pages} printable page${pages === 1 ? "" : "s"}</strong></div>
          <div class="shortcut-row"><span>Paper</span><strong>${escapeHtml(String(state.doc.page.width))} × ${escapeHtml(String(state.doc.page.height))} in</strong></div>
          <div class="shortcut-row"><span>Scene numbers</span><strong>${state.doc.settings.sceneNumbers ? "On" : "Off"}</strong></div>
          <div class="shortcut-row"><span>Revision color</span><strong>${state.doc.revision.enabled ? escapeHtml(revisionEntry(state.doc, state.doc.revision.current).name) + " revision" : "Hidden"}</strong></div>
        </div>
        <p class="dialog-note">Page view shows the same paginated cards used for printing and PDF export, including scene numbers, revision marks and (MORE)/(CONT'D).</p>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Open Page view",
          onClick: () => {
            closeDialog();
            setView("script");
            setMode("page");
          },
        },
        { label: "Print…", kind: "primary", onClick: () => { closeDialog(); printDocument(); } },
      ],
    });
  }
  function openCommandPalette() {
    invalidateModalClose(els.commandDialog);
    state.commands = commandActions();
    state.commandIndex = 0;
    els.commandInput.value = "";
    renderCommandList("");
    els.commandDialog.classList.remove("is-closing");
    if (!els.commandDialog.open) els.commandDialog.showModal();
    requestAnimationFrame(() => els.commandInput.focus());
  }
  function renderCommandList(query) {
    const q = query.trim().toLowerCase();
    const filtered = state.commands
      .filter((command) => `${command.label} ${command.group}`.toLowerCase().includes(q))
      .slice(0, 20);
    state.commandListItems = filtered;
    state.commandIndex = clamp(state.commandIndex, 0, Math.max(0, filtered.length - 1));
    els.commandList.innerHTML = "";
    if (!filtered.length) {
      els.commandInput.removeAttribute("aria-activedescendant");
      els.commandList.innerHTML = `<div class="scene-list__empty">${icon("search")}<span>No commands match “${escapeHtml(query)}”.</span></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `command-item${index === state.commandIndex ? " is-selected" : ""}`;
      button.setAttribute("role", "option");
      button.id = `command-option-${index}`;
      button.setAttribute("aria-selected", String(index === state.commandIndex));
      button.style.setProperty("--i", String(index));
      button.innerHTML = `${icon(command.icon || "sparkle")}<span>${escapeHtml(command.label)}</span>${command.shortcut ? `<small>${escapeHtml(command.shortcut)}</small>` : ""}`;
      button.addEventListener("click", () => runCommand(command));
      button.addEventListener("pointermove", () => {
        if (state.commandIndex === index) return;
        selectCommand(index);
      });
      fragment.appendChild(button);
    });
    els.commandList.appendChild(fragment);
    els.commandInput.setAttribute("aria-activedescendant", `command-option-${state.commandIndex}`);
  }
  function selectCommand(index, scroll = false) {
    const items = els.commandList.children;
    const count = (state.commandListItems || []).length;
    if (!count) return;
    const previous = items[state.commandIndex];
    state.commandIndex = clamp(index, 0, count - 1);
    const selected = items[state.commandIndex];
    if (previous !== selected) {
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-selected", "false");
      selected.classList.add("is-selected");
      selected.setAttribute("aria-selected", "true");
    }
    els.commandInput.setAttribute("aria-activedescendant", selected.id);
    if (scroll) selected.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  function runCommand(command) {
    if (!command) return;
    closeCommandDialog(() => {
      command.run();
    });
  }
  function onCommandKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectCommand(state.commandIndex + 1, true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectCommand(state.commandIndex - 1, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand((state.commandListItems || [])[state.commandIndex]);
    }
  }
  /* ------------------------------------------------------------------ */
  /* file operations                                                     */
  /* ------------------------------------------------------------------ */
  async function newDocument(kind = null, fromStart = false) {
    if (!(await confirmDiscard("Starting a new screenplay will replace the current edits."))) return;
    const doc = kind ? templateDocument(kind) : blankDocument();
    loadDocument(doc, { clearRecovery: true });
    requestAnimationFrame(() => focusParagraph(state.doc.paragraphs[0].id, "end"));
    toast(
      kind ? "Template ready" : "New screenplay",
      kind ? "A fresh document is waiting for its first line." : "A clean page is ready. Start with a scene heading.",
      "success",
    );
    if (fromStart) hideStartCenter();
  }
  async function openFilePicker() {
    if (!(await confirmDiscard("Opening another screenplay will replace the current edits."))) return;
    if (isDesktop) {
      try {
        const file = await desktop.openFile();
        if (file) {
          hideStartCenter();
          await handleFilePayload(file);
        }
      } catch (error) {
        toast("Open failed", error.message || "Could not read that file.", "error");
      }
    } else {
      els.fileInput.value = "";
      els.fileInput.click();
    }
  }
  async function handleFilePayload(payload) {
    if (!payload || typeof payload.contents !== "string") return;
    try {
      const parsed = FDX.parse(payload.contents);
      if (parsed.title === "Imported Screenplay" && payload.name) {
        parsed.title = payload.name.replace(/\.(fdx|fdxt|xml)$/i, "");
      }
      const warnings = parsed.warnings || [];
      const fromTemplate = Boolean(parsed.meta && parsed.meta.template) || /\.fdxt$/i.test(payload.name || payload.path || "");
      loadDocument(parsed, {
        path: fromTemplate ? null : payload.path || null,
        name: fromTemplate ? null : payload.name || null,
        dirty: fromTemplate,
        lastSaved: fromTemplate ? null : payload.mtimeMs || Date.now(),
        clearRecovery: true,
        identity: fromTemplate ? null : payload.identity || null,
      });
      if (fromTemplate) markDirty();
      if (isDesktop && payload.path) desktop.touchRecent(payload.path, state.doc.title).catch(() => {});
      if (fromTemplate) {
        toast("Template ready", "A new screenplay was created. Save to choose its filename and location.", "success");
        if (warnings.length) toast("Imported with notes", warnings.join(" "), "warning", 6500);
      } else if (warnings.length) {
        toast("Imported with notes", warnings.join(" "), "warning", 6500);
      } else {
        toast(
          "FDX imported",
          `${state.doc.paragraphs.length} blocks loaded${payload.name ? ` from ${payload.name}` : ""}.`,
          "success",
        );
      }
    } catch (error) {
      openDialog({
        eyebrow: "Import failed",
        title: "That file could not be read",
        body: `<p>${escapeHtml(error.message || "Unknown FDX error.")}</p><div class="dialog-note">Only FDX/FDXT XML files are supported. Your current draft was not changed.</div>`,
        actions: [{ label: "Close", kind: "primary" }],
      });
    }
  }
  async function onFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await handleFilePayload({ contents: text, name: file.name });
    } catch (error) {
      toast("Import failed", error.message || "Could not read that file.", "error");
    }
  }
  async function handleOpenDocument(payload) {
    if (!payload) return;
    if (!(await confirmDiscard("Opening this screenplay will replace the current edits."))) return;
    state.suppressStartCenter = true;
    hideStartCenter();
    await handleFilePayload(payload);
  }
  function loadDocument(doc, meta = {}) {
    workspaceUI?.beforeLoad();
    paginationSequence++; paginationClient.cancel(); clearTimeout(paginationTimer); paginationTimer = null;
    state.layout = null;
    regexClient.cancel();
    findGeneration++;
    clearTimeout(backupTimer);
    backupTimer = null;
    lastVersionSnapshot = 0;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    clearTimeout(state.history && state.history.timer);
    state.doc = normalizeDocument(doc);
    elementDocument = state.doc;
    populateElementControls();
    state.filePath = meta.path || null;
    state.fileIdentity = meta.identity || null;
    state.hasSafetyCopy = false;
    state.externalChange = null;
    renderExternalChangeBanner();
    if (desktop && desktop.watchFile && state.filePath) desktop.watchFile({ path: state.filePath, identity: state.fileIdentity }).catch(() => {});
    else if (desktop && desktop.unwatchFile) desktop.unwatchFile().catch(() => {});
    state.fileName = meta.name || null;
    state.dirty = Boolean(meta.dirty);
    state.lastSaved = meta.lastSaved || null;
    state.selectedId = null;
    state.activeScene = 0;
    state.layoutDirty = true;
    state.pageIndex = 0;
    state.recovery = null;
    state.recoveryWrittenAt = null;
    state.history = new History(state.doc);
    state.savedSnapshot = cloneDocument(state.doc);
    // Loading a file must replace the browser draft even if no edit follows.
    if (meta.persist !== false) persistWorkspace(false);
    renderAll();
    updateHistoryButtons();
    setView("script");
    setMode("write");
    hideStartCenter();
    state.suppressStartCenter = true;
    if (meta.clearRecovery && isDesktop) desktop.clearRecovery().catch(() => {});
    requestAnimationFrame(() => {
      const first = state.doc.paragraphs[0];
      if (first) focusParagraph(first.id, "start");
      workspaceUI?.afterLoad();
    });
  }
  async function saveDocument({ silent = false, saveAs = false, forClose = false } = {}) {
    if (!isDesktop) {
      if (forClose) return saveLocal(silent);
      return saveLocal(silent);
    }
    if (state.saving) {
      if (forClose) desktop.cancelClose();
      return false;
    }
    state.saving = true;
    updateSaveState();
    const version = state.editVersion;
    const savedDoc = cloneDocument(state.doc);
    try {
      const protectedSourcePath = !state.hasSafetyCopy && savedDoc.sourceFDX && state.filePath && FDX.compatibility(savedDoc).recommendSaveCopy ? state.filePath : null;
      const contents = FDX.serialize(savedDoc);
      const result = await desktop.saveFile({
        path: saveAs || protectedSourcePath ? null : state.filePath,
        saveAs: saveAs || Boolean(protectedSourcePath),
        protectedSourcePath,
        contents,
        defaultName: `${state.doc.title || "screenplay"}${protectedSourcePath ? " copy" : ""}`,
        documentId: savedDoc.documentId,
        ...(state.filePath ? { expectedPath: state.filePath, expectedIdentity: state.fileIdentity ?? null } : {}),
      });
      if (result?.copyRequired) {
        if (forClose) desktop.cancelClose();
        toast("Choose a separate copy", "This edit may affect retained production references. The original file was not overwritten.", "warning", 7000);
        openCompatibilityInspector(); return false;
      }
      if (result && result.conflict) {
        state.externalChange = result;
        renderExternalChangeBanner();
        if (forClose) desktop.cancelClose();
        toast("The file changed on disk", "Compare or reload the disk version, or save your draft as a separate copy.", "warning", 7000);
        openFileStatus();
        return false;
      }
      if (!result || result.canceled) {
        if (forClose) desktop.cancelClose();
        return false;
      }
      state.filePath = result.path;
      if (protectedSourcePath) state.hasSafetyCopy = true;
      state.fileName = result.name;
      state.fileIdentity = result.identity || state.fileIdentity;
      state.externalChange = null;
      renderExternalChangeBanner();
      if (desktop.watchFile && state.fileIdentity) desktop.watchFile({ path: result.path, identity: state.fileIdentity }).catch(() => {});
      state.savedSnapshot = savedDoc;
      state.lastSaved = Date.now();
      if (state.editVersion === version) state.dirty = false;
      if (!state.dirty) {
        state.recovery = null;
        state.recoveryWrittenAt = null;
        await desktop.clearRecovery().catch(() => {});
      }
      // A write saves its captured version. Keep newer edits in recovery,
      // including edits made while recovery cleanup was awaiting IPC.
      if (state.dirty) persistWorkspace();
      desktop.touchRecent(result.path, state.doc.title).catch(() => {});
      updateSaveState();
      renderMeta();
      syncDesktopState(true);
      if (!silent) {
        toast(
          "Screenplay saved",
          `${result.name} written to disk${state.dirty ? " (newer edits are still unsaved)" : ""}.`,
          "success",
        );
      }
      if (forClose) {
        if (state.dirty) {
          desktop.cancelClose();
          toast("Newer edits are unsaved", "Save again before closing to keep the edits made during this save.", "info");
        } else desktop.confirmClose();
      }
      return true;
    } catch (error) {
      if (forClose) desktop.cancelClose();
      toast("Save failed", error.message || "Could not write the screenplay.", "error", 5200);
      return false;
    } finally {
      state.saving = false;
      updateSaveState();
    }
  }
  async function exportFDX() {
    try {
      const xml = FDX.serialize(state.doc);
      const filename = `${(state.doc.title || "screenplay").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "screenplay"}.fdx`;
      if (isDesktop) {
        const protectedSourcePath = !state.hasSafetyCopy && state.doc.sourceFDX && state.filePath && FDX.compatibility(state.doc).recommendSaveCopy ? state.filePath : null;
        const result = await desktop.saveFile({
          path: null,
          saveAs: true,
          contents: xml,
          protectedSourcePath,
          ...(state.filePath ? { expectedPath: state.filePath, expectedIdentity: state.fileIdentity ?? null } : {}),
          defaultName: state.doc.title || "screenplay",
        });
        if (result?.copyRequired) { toast("Choose a separate copy", "The original file was not overwritten. Select another filename.", "warning"); return; }
        if (result?.conflict) { state.externalChange = result; renderExternalChangeBanner(); openFileStatus(); return; }
        if (!result.canceled) {
          toast("FDX exported", `${result.name} is ready to open in another FDX editor.`, "success");
        }
      } else {
        FDX.download(filename, xml, "application/xml;charset=utf-8");
        toast("FDX exported", `${filename} is ready to open in another FDX editor.`, "success");
      }
    } catch (error) {
      toast("Export failed", error.message || "Could not serialize the document.", "error");
    }
  }
  function undo() {
    if (!state.history || !state.history.undo()) {
      toast("Nothing to undo", "The history is at its beginning.", "info", 1800);
      return;
    }
    renderAll();
    updateHistoryButtons();
    markDirty();
  }
  /* File safety tools share the same document model as the editor. */
  function scheduleVersionSnapshot() {
    if (Date.now() - lastVersionSnapshot < 30000 || backupTimer) return;
    backupTimer = setTimeout(() => {
      backupTimer = null;
      saveVersionSnapshot("Automatic snapshot", true);
    }, 2000);
  }
  async function saveVersionSnapshot(label = "Snapshot", silent = false) {
    const live = state.doc;
    const document = cloneDocument(state.doc);
    try {
      const result = desktop?.createBackup
        ? await desktop.createBackup({ documentId: document.documentId, filePath: state.filePath, title: document.title, document, label: label === "Automatic snapshot" ? "" : label })
        : await browserBackups.create(document, { label, filePath: state.filePath });
      if (live === state.doc) lastVersionSnapshot = Date.now();
      state.versionBackupError = null;
      if (!silent) toast("Version saved", "This version is available in Version history.", "success");
      return result;
    } catch (error) {
      if (!silent || !state.versionBackupError) toast("Version was not saved", error.message || "Version history storage is unavailable.", "error");
      state.versionBackupError = error.message;
      return null;
    }
  }
  function diffMarkup(before, after) {
    const diff = FDWritingTools.compareDocuments(before, after);
    const counts = Object.entries(diff.counts).map(([name, count]) => `${count} ${name}`).join(" · ");
    return `<p>${escapeHtml(counts)}</p>${diff.metadataChanged.length ? `<p>Document settings changed: ${escapeHtml(diff.metadataChanged.join(", "))}</p>` : ""}
      <div class="text-diff">${diff.rows.map(row => `<details><summary>${escapeHtml(row.kind)} · ${escapeHtml(row.type)}</summary>
        <div><pre aria-label="Earlier text">${escapeHtml(row.before.slice(0, 2500))}</pre><pre aria-label="Current text">${escapeHtml(row.after.slice(0, 2500))}</pre></div></details>`).join("") || "<p>No paragraph changes.</p>"}</div>
      ${diff.truncated ? '<p>Showing the first 200 differences.</p>' : ''}`;
  }
  async function openVersionHistory() {
    const documentId = FDWritingTools.backupKey(state.doc);
    const current = state.doc;
    try {
      const versions = desktop?.listBackups
        ? await desktop.listBackups({ documentId, filePath: state.filePath }) : await browserBackups.list(documentId);
      if (current !== state.doc) return;
      openDialog({ eyebrow: "Document safety", title: "Version history", wide: true,
        body: `<p>Compare a version before restoring it. Restoring keeps a snapshot of your current draft.</p>
          <label class="field">Snapshot name<input id="snapshotLabel" class="input" maxlength="100" placeholder="Before the next revision"></label>
          <div class="history-versions">${versions.map(version => `<button type="button" class="history-version" data-version="${escapeHtml(version.id)}">
            <strong>${escapeHtml(version.label || version.title || "Saved version")}</strong>
            <span>${escapeHtml(new Date(version.createdAt || version.savedAt || Date.now()).toLocaleString())}</span></button>`).join("") || "<p>No earlier versions yet. Save a named snapshot to begin.</p>"}</div>`,
        actions: [{ label: "Save snapshot", keepOpen: true, onClick: async () => {
          const label = $("#snapshotLabel")?.value.trim() || "Named snapshot";
          if (await saveVersionSnapshot(label)) openVersionHistory();
        } }, { label: "Close", kind: "primary" }],
      });
      const historyGeneration = dialogGeneration;
      $$('[data-version]', els.dialogBody).forEach(button => button.addEventListener("click", async () => {
        try {
          const backup = desktop?.readBackup ? await desktop.readBackup(button.dataset.version) : await browserBackups.read(button.dataset.version);
          if (current !== state.doc || historyGeneration !== dialogGeneration || !els.dialog.open) return;
          if (!backup) throw new Error("That version is no longer available.");
          const older = backup.document ? normalizeDocument(backup.document) : FDX.parse(backup.contents);
          openDialog({ eyebrow: "Compare version", title: backup.label || "Earlier version", wide: true,
            body: diffMarkup(older, state.doc), actions: [
              { label: "Back", onClick: openVersionHistory },
              { label: "Restore this version", kind: "danger", keepOpen: true, onClick: async () => {
                if (state.saving) { toast("Save in progress", "Wait for the current save before restoring."); return; }
                const live = state.doc;
                const liveVersion = state.editVersion;
                const lastSavedDocument = state.savedSnapshot;
                if (!(await saveVersionSnapshot("Before restoring a version", true))) {
                  toast("Restore cancelled", "The current draft could not be backed up. Save an FDX copy before trying again.", "error"); return;
                }
                if (state.doc !== live || liveVersion !== state.editVersion) return;
                const meta = { path: state.filePath, name: state.fileName, identity: state.fileIdentity, lastSaved: state.lastSaved, dirty: true };
                loadDocument(older, meta);
                state.savedSnapshot = lastSavedDocument;
                markDirty();
                closeDialog();
                toast("Version restored", "Review the draft, then save when ready.", "success");
              } },
            ],
          });
        } catch (error) { toast("Version unavailable", error.message, "error"); }
      }));
    } catch (error) { toast("Version history unavailable", error.message, "error"); }
  }
  function openCompatibilityInspector() {
    const info = typeof FDX.compatibility === "function" ? FDX.compatibility(state.doc) : null;
    openDialog({ eyebrow: "FDX exchange", title: "Compatibility review", wide: true,
      body: `<p>${escapeHtml(info?.summary || "Review the document before exchanging it with another editor.")}</p>
        ${(info?.risks || []).map(risk => `<div class="dialog-note">${escapeHtml(risk.message)}</div>`).join("")}
        <div class="dialog-note">Original vendor data can be retained without being editable here. Save a copy when sharing a draft. Matching pagination and a trusted Final Draft open/save cycle still require reference verification.</div>
        <h3>Editable fields</h3><ul>${(info?.mapped || []).map(row => `<li>${escapeHtml(row.label || row.name)}</li>`).join("")}</ul>
        <details class="safety-details"><summary>Preserved original metadata (${info?.preserved?.length || 0} sections)</summary>
          <ul>${(info?.preserved || []).map(row => `<li><strong>${escapeHtml(row.label || row.name)}</strong> — ${escapeHtml(row.detail || "Preserved")}</li>`).join("")}</ul></details>
        <details class="safety-details"><summary>Document identity and source details</summary>
          <dl class="safety-facts"><dt>Document ID</dt><dd>${escapeHtml(state.doc.documentId || "")}</dd>
          <dt>Source fingerprint</dt><dd>${escapeHtml(state.doc.sourceFingerprint || "New document")}</dd></dl></details>`,
      actions: [
        { label: "Edit native metadata", onClick: openNativeMetadataEditor },
        { label: "Save a copy", onClick: () => isDesktop ? saveDocument({ saveAs: true }) : exportFDX() },
        { label: "Close", kind: "primary" },
      ],
    });
  }
  function openNativeMetadataEditor(selectedSection) {
    const current = state.doc;
    let metadata;
    try { metadata = FDX.nativeMetadata(current); }
    catch (error) { toast("Native metadata unavailable", error.message, "error"); return; }
    const sections = metadata.sections || [];
    const section = sections.find(entry => entry.name === selectedSection) || sections[0];
    const fields = [], operations = [];
    const renderNode = (node, depth = 0) => {
      const rows = (node.attributes || []).map(attribute => {
        if (!attribute.editable) return `<span class="native-metadata-reference">${escapeHtml(attribute.name)}: ${escapeHtml(attribute.value)}</span>`;
        const index = fields.push({ section: section.name, path: node.path, attribute: attribute.name, value: attribute.value }) - 1;
        return `<label class="field"><span>${escapeHtml(attribute.label || attribute.name)}</span><input class="input" data-native-field="${index}" value="${escapeHtml(attribute.value)}"></label>`;
      });
      if (node.editableText) {
        const index = fields.push({ section: section.name, path: node.path, text: node.text || "" }) - 1;
        rows.push(`<label class="field"><span>${escapeHtml(node.textLabel || "Text")}</span><textarea class="input" rows="3" data-native-field="${index}">${escapeHtml(node.text || "")}</textarea></label>`);
      } else if (node.text) rows.push(`<p>${escapeHtml(node.text)}</p>`);
      for (const action of ["duplicate", "delete"]) {
        if (!node.actions?.includes(action)) continue;
        const index = operations.push({ section: section.name, path: node.path, action }) - 1;
        rows.push(`<button type="button" class="btn" data-native-operation="${index}">${action === "delete" ? "Delete" : "Duplicate"} ${escapeHtml(node.label || node.name)}</button>`);
      }
      return `<details class="safety-details native-metadata-node"${depth === 0 ? " open" : ""}><summary>${escapeHtml(node.label || node.name)}</summary>${rows.join("")}${(node.children || []).map(child => renderNode(child, depth + 1)).join("")}</details>`;
    };
    openDialog({ eyebrow: "FDX exchange", title: "Native metadata", wide: true,
      body: `<p>Edit supported fields in the document’s original cast, tags, boards and page-lock data. Reference IDs stay protected; changes are checked before being applied. Keep a separate copy for production interchange.</p>
        ${metadata.warnings?.length ? `<details class="safety-details"><summary>Existing metadata warnings (${metadata.warnings.length})</summary><ul>${metadata.warnings.slice(0, 50).map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>${metadata.warnings.length > 50 ? '<p>Showing the first 50 warnings.</p>' : ''}</details>` : ""}
        ${section ? `<label class="field"><span>Metadata section</span><select id="nativeMetadataSection">${sections.map(entry => `<option value="${escapeHtml(entry.name)}"${entry === section ? " selected" : ""}>${escapeHtml(entry.label || entry.name)}</option>`).join("")}</select></label>
          <div id="nativeMetadataFields">${(section.nodes || []).map(node => renderNode(node)).join("")}</div>` : '<p>No supported native sections are present. Import an FDX with populated metadata to edit its supported fields.</p>'}
        <p id="nativeMetadataError" role="alert" class="dialog-note" hidden></p>`,
      actions: [{ label: "Cancel" }, ...(section ? [{ label: "Apply native changes", kind: "primary", keepOpen: true, onClick: () => applyChanges() }] : [])],
    });
    const showError = message => { const el = $("#nativeMetadataError"); if (el) { el.hidden = false; el.textContent = message; } };
    const collectChanges = () => [...els.dialogBody.querySelectorAll('[data-native-field]')].flatMap(input => {
      const field = fields[Number(input.dataset.nativeField)];
      const old = Object.hasOwn(field, "attribute") ? field.value : field.text;
      if (input.value === String(old ?? "")) return [];
      return [{ ...field, ...(Object.hasOwn(field, "attribute") ? { value: input.value } : { text: input.value }) }];
    });
    function applyChanges(operation, nextSection) {
      try {
        if (state.doc !== current) throw new Error("The document changed while this editor was open. Close and reopen it before applying changes.");
        const edits = collectChanges();
        if (operation) edits.push(operation);
        if (edits.length) {
          const updated = FDX.updateNativeMetadata(current, { signature: metadata.signature, edits });
          state.history.finishBurst();
          state.doc = updated;
          markDirty(); state.history.record(); renderAll();
        }
        if (operation || nextSection) openNativeMetadataEditor(nextSection || section.name);
        else { closeDialog(); if (edits.length) toast("Native metadata updated", "Save an FDX copy to exchange the changes.", "success"); }
      } catch (error) { showError(error.message); }
    }
    $("#nativeMetadataSection")?.addEventListener("change", event => {
      const next = event.target.value;
      if (collectChanges().length) {
        event.target.value = section.name;
        showError("Apply your native changes before switching sections, or cancel this editor to discard them.");
        return;
      }
      openNativeMetadataEditor(next);
    });
    $$('[data-native-operation]', els.dialogBody).forEach(button => button.addEventListener("click", () => applyChanges(operations[Number(button.dataset.nativeOperation)])));
  }
  function renderExternalChangeBanner() {
    let banner = $("#externalChangeBanner");
    if (!banner) {
      banner = document.createElement("div"); banner.id = "externalChangeBanner"; banner.className = "external-change-banner";
      banner.setAttribute("role", "status");
      banner.innerHTML = `<span>The file changed outside Azkript. Your draft is still here.</span><button type="button" class="btn" id="reviewExternalChange">Review changes</button>`;
      els.workspace.prepend(banner);
      banner.querySelector("button").addEventListener("click", openFileStatus);
    }
    banner.hidden = !state.externalChange;
  }
  async function openFileStatus() {
    if (!desktop || !state.filePath) {
      openDialog({ eyebrow: "Document safety", title: "File status", body: "<p>This draft has no active desktop file. Save it to choose a location.</p>", actions: [{ label: "Close", kind: "primary" }] }); return;
    }
    const filePath = state.filePath;
    try {
      const disk = await desktop.readFile(filePath);
      if (state.filePath !== filePath) return;
      const parsed = FDX.parse(disk.contents);
      const unchanged = state.fileIdentity && disk.identity === state.fileIdentity;
      openDialog({ eyebrow: "File on disk", title: unchanged ? "File is up to date" : "Compare disk changes", wide: true,
        body: `<p>${escapeHtml(filePath)}</p>${diffMarkup(parsed, state.doc)}`,
        actions: [
          { label: "Reload disk version", keepOpen: true, onClick: async () => {
            if (state.saving) { toast("Save in progress", "Wait for the current save before reloading."); return; }
            const live = state.doc;
            if (!(await saveVersionSnapshot("Before reloading from disk", true))) {
              toast("Reload cancelled", "The current draft could not be backed up. Save a copy first.", "error"); return;
            }
            if (state.doc !== live) return;
            // Re-read after the backup: the file can change during the review.
            const diskNow = await desktop.readFile(filePath);
            if (state.doc !== live || state.filePath !== filePath) return;
            const generation = dialogGeneration;
            await handleFilePayload(diskNow);
            if (dialogGeneration === generation) closeDialog();
          } },
          { label: "Save a copy", onClick: () => saveDocument({ saveAs: true }) },
          { label: "Keep editing", kind: "primary" },
        ],
      });
    } catch (error) {
      openDialog({ eyebrow: "File unavailable", title: "The disk file could not be read",
        body: `<p>${escapeHtml(error.message)}</p><p>Your current draft is still available. Save a separate copy to keep it.</p>`,
        actions: [{ label: "Save a copy", onClick: () => saveDocument({ saveAs: true }) }, { label: "Keep editing", kind: "primary" }],
      });
    }
  }
  const typographyMeasures = new Map();
  function measureForLayout() {
    const key = `${state.font}:${state.fontSize}`;
    if (!typographyMeasures.has(key)) typographyMeasures.set(key, FDCoreWriting.createMeasureText(state.font, state.fontSize));
    return typographyMeasures.get(key);
  }
  function applyDocumentTypography(el, paragraph, published = false) {
    const spec = elementSpec(paragraph.type);
    const custom = state.doc.elements && state.doc.elements[paragraph.type];
    const typography = FDPagination.paragraphTypography(state.doc, paragraph, layoutOptions());
    el.style.lineHeight = `${typography.lineHeight}pt`;
    if (custom) {
      el.style.fontWeight = spec.style?.includes("Bold") ? "700" : "normal";
      el.style.fontStyle = spec.style?.includes("Italic") ? "italic" : "normal";
      el.style.textDecoration = spec.style?.includes("Underline") ? "underline" : "none";
      el.style.textTransform = spec.style?.includes("AllCaps") ? "uppercase" : "none";
      el.style.color = FDX.parseColor(spec.native?.font?.Color || "") || "";
    }
    if (state.typographyMode === "document" && custom) {
      el.style.fontFamily = `${JSON.stringify(spec.font || state.font)}, "Courier New", monospace`;
      el.style.fontSize = `${spec.fontSize || state.fontSize}pt`;
    } else { el.style.fontFamily = ""; el.style.fontSize = ""; }
    if (custom) {
      el.style.textAlign = paragraph.alignment || spec.align || "left";
      if (!published && !state.flow) {
        el.style.marginLeft = `${spec.left}in`;
        el.style.marginRight = `${state.doc.page.width - spec.right}in`;
        el.style.textIndent = `${spec.first || 0}in`;
        el.style.marginTop = `${paragraph.spaceBefore ?? spec.before ?? 0}pt`;
      } else if (!published) { el.style.marginLeft = ""; el.style.marginRight = ""; el.style.textIndent = ""; }
    } else if (!published) { el.style.marginLeft = ""; el.style.marginRight = ""; el.style.textIndent = ""; }
    el.setAttribute("dir", "auto");
  }
  function currentTypography() {
    const paragraph = activeParagraph() || state.doc.paragraphs[0];
    const custom = paragraph && state.doc.elements?.[paragraph.type];
    return state.typographyMode === "document" && custom
      ? { family: custom.font || state.font, size: custom.fontSize || state.fontSize, document: true }
      : { family: state.font, size: state.fontSize, document: false };
  }
  function syncDocumentFontControls() {
    const current = currentTypography(), select = $("#fontSelect"), size = $("#fontSize");
    if (select) {
      select.querySelectorAll('[data-document-font]').forEach(option => option.remove());
      if (current.document) {
        const option = document.createElement("option"); option.dataset.documentFont = "true";
        option.value = `document:${current.family}`; option.textContent = `Document: ${current.family}`;
        option.disabled = true; select.append(option); select.value = option.value;
      } else select.value = normalizeScriptFont(state.font);
      select.title = current.document ? "Document font. Choosing another font enables the workspace override." : "Workspace font for the editor and PDF.";
    }
    if (size) { size.value = String(current.size); size.title = current.document ? "Document font size. Changing this enables the workspace override." : "Workspace font size."; }
  }
  function useWorkspaceTypography() {
    state.typographyMode = "workspace";
    document.body.classList.add("workspace-typography");
    state.layoutDirty = true;
    decorateEditor(); syncDocumentFontControls();
  }
  function applyInterfaceScale() {
    const native = Boolean(desktop?.setInterfaceScale);
    const scale = native ? 1 : state.uiScale;
    document.documentElement.style.zoom = String(scale);
    document.body.style.setProperty("--interface-scale", String(scale));
    document.body.style.setProperty("--interface-viewport-height", `${window.innerHeight / scale}px`);
    document.body.classList.toggle("scaled-interface", scale !== 1);
    document.body.classList.toggle("scaled-compact", window.innerWidth / scale < 1100 && scale !== 1);
    if (native) desktop.setInterfaceScale(state.uiScale).catch(error => toast("Interface scale unavailable", error.message, "error"));
  }
  function openWritingReliability() {
    const fonts = [...new Set([state.font, ...Object.values(state.doc.elements || {}).map(spec => spec.font).filter(Boolean)])];
    const diagnostics = fonts.map(font => FDCoreWriting.typography(font, state.fontSize));
    openDialog({ eyebrow: "Writing environment", title: "Typography and accessibility", wide: true,
      body: `<label class="field">Typography<select id="typographyMode" class="input"><option value="document" ${state.typographyMode === 'document' ? 'selected' : ''}>Document fonts and geometry</option><option value="workspace" ${state.typographyMode === 'workspace' ? 'selected' : ''}>Workspace font override</option></select></label>
        <label class="field">Interface scale<select id="interfaceScale" class="input">${[1, 1.25, 1.5, 2].map(scale => `<option value="${scale}" ${state.uiScale === scale ? 'selected' : ''}>${scale * 100}%</option>`).join('')}</select></label>
        <div class="safety-facts">${diagnostics.map(item => `<p><strong>${escapeHtml(item.family)}</strong> — ${item.available ? 'Available' : 'Not detected; a fallback font will be used'}</p>`).join('')}</div>
        <div class="dialog-note">Measured font advances feed the shared page engine. Font substitution can change wrapping. Pagination equivalence with another editor is not certified.</div>
        <p>Workspace overrides affect the editor and PDF/print. FDX keeps the document's font requests. Use Elements Settings to change fonts saved in the document.</p>
        <p>Tab and Shift+Tab navigate dialogs. Arrow keys move between ribbon tabs. Escape closes menus and dialogs. System high contrast is supported.</p>`,
      actions: [{ label: "Apply", kind: "primary", onClick: () => {
        state.typographyMode = $("#typographyMode").value;
        state.uiScale = Number($("#interfaceScale").value);
        applyInterfaceScale();
        state.layoutDirty = true; persistPrefs(); renderAll();
      } }, { label: "Cancel" }],
    });
  }
  function redo() {
    if (!state.history || !state.history.redo()) {
      toast("Nothing to redo", "You are at the latest edit.", "info", 1800);
      return;
    }
    renderAll();
    updateHistoryButtons();
    markDirty();
  }
  function validateDocumentAction() {
    persistWorkspace();
    const issues = validateDocument(state.doc);
    if (!issues.length) {
      toast("Document check passed", "No structural issues found in this draft.", "success");
      return;
    }
    const rows = issues
      .map(
        (issue) =>
          `<div class="shortcut-row"><span><strong>${escapeHtml(issue.code)}</strong><br>${escapeHtml(issue.message)}</span><kbd>${escapeHtml(issue.severity)}</kbd></div>`,
      )
      .join("");
    openDialog({
      eyebrow: "Document check",
      title: `${issues.length} note${issues.length === 1 ? "" : "s"}`,
      body: `<div class="shortcut-grid" style="grid-template-columns:1fr">${rows}</div>`,
      actions: [{ label: "Done", kind: "primary" }],
    });
  }
  async function copyOutline() {
    const scenes = scenesWithPages();
    const text = scenes
      .map(
        (scene) =>
          `${String(scene.index).padStart(2, "0")}. ${scene.heading} — ${scene.wordCount} words (p.${scene.displayPage})${scene.omit ? " [omitted]" : ""}`,
      )
      .join("\n");
    await copyText(text, "Outline copied", `${scenes.length} scenes copied to the clipboard.`);
  }
  async function copyReport() {
    await copyText(buildReportText(), "Report copied", "The full script report is on the clipboard.");
  }
  async function copyText(text, title, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(title, message, "success");
    } catch {
      openDialog({
        eyebrow: "Clipboard",
        title,
        body: `<textarea class="outline-copy" readonly>${escapeHtml(text)}</textarea>`,
        actions: [{ label: "Close", kind: "primary" }],
      });
      requestAnimationFrame(() => {
        const textarea = $(".outline-copy", els.dialogBody);
        if (textarea) textarea.select();
      });
    }
  }
  /* ------------------------------------------------------------------ */
  /* scene details, title page, revisions, cast profiles                 */
  /* ------------------------------------------------------------------ */
  function openSceneDetails(sceneId) {
    const scene =
      (sceneId && getScenes(state.doc).find((item) => item.id === sceneId)) ||
      sceneForParagraphId((activeParagraph() || {}).id);
    if (!scene) {
      toast("No scene selected", "Place the caret in a scene or click a card first.", "info", 2200);
      return;
    }
    const meta = scene.paragraph.scene || {};
    const displayPage = scenePageMap().get(scene.id) || scene.startPage;
    openDialog({
      eyebrow: "Index card",
      title: scene.heading || "Untitled scene",
      body: `
        <div class="scene-dialog-grid">
          <div class="scene-dialog-form">
            <label class="field"><span>Scene heading</span><input id="cardHeading" type="text" maxlength="160" value="${escapeHtml(scene.heading)}"></label>
            <label class="field"><span>Synopsis</span><textarea id="cardSynopsis" rows="3" maxlength="600" placeholder="What changes?">${escapeHtml(meta.synopsis || "")}</textarea></label>
            <label class="field"><span>Notes</span><textarea id="cardNotes" rows="3" maxlength="600" placeholder="Production notes, props, continuity…">${escapeHtml(meta.notes || "")}</textarea></label>
            <div class="field-grid">
              <label class="field"><span>Number</span><input id="cardNumber" type="text" maxlength="12" value="${escapeHtml(meta.number || "")}" placeholder="Auto"></label>
              <div class="field"><span>Status</span><button type="button" class="switch ${scene.omit ? "is-on" : ""}" id="cardOmit" role="switch" aria-checked="${scene.omit}"><span></span></button></div>
            </div>
            <div class="field"><span>Card color</span><div class="scene-color-row" id="cardColors">${["", ...PALETTE.slice(0, 6)]
              .map(
                (color, index) =>
                  `<button type="button" class="scene-color${index === 0 ? " scene-color--none" : ""}${(meta.color || "") === color ? " is-active" : ""}" data-color="${escapeHtml(color)}" style="${color ? `--scene-color:${color}` : ""}">${index === 0 ? "None" : ""}</button>`,
              )
              .join("")}</div></div>
          </div>
          <aside class="scene-dialog-preview" style="--scene-color:${scene.color}">
            <span class="eyebrow">Scene ${scene.index} · Page ${displayPage}</span>
            <h3>${escapeHtml(scene.heading)}</h3>
            <p id="cardPreviewSynopsis">${escapeHtml(meta.synopsis || "A scene card synopsis will appear here.")}</p>
            <dl><div><dt>Words</dt><dd>${scene.wordCount}</dd></div><div><dt>Blocks</dt><dd>${scene.paragraphs}</dd></div><div><dt>Revisions</dt><dd>${scene.revisionCount}</dd></div></dl>
          </aside>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save card",
          kind: "primary",
          onClick: () => {
            const heading = $("#cardHeading", els.dialogBody).value.trim() || "UNTITLED SCENE";
            scene.paragraph.html = escapeHtml(heading);
            scene.paragraph.scene = {
              ...(scene.paragraph.scene || {}),
              synopsis: $("#cardSynopsis", els.dialogBody).value,
              notes: $("#cardNotes", els.dialogBody).value,
              number: $("#cardNumber", els.dialogBody).value.trim(),
              omit: $("#cardOmit", els.dialogBody).classList.contains("is-on"),
              color: $("#cardColors .is-active", els.dialogBody)?.dataset.color || "",
            };
            if (state.doc.revision.enabled) markRevision(state.doc, scene.paragraph);
            markDirty();
            state.history.record();
            renderAll();
            toast("Scene card updated", `${heading} is ready.`, "success", 2200);
          },
        },
      ],
    });
    const preview = $("#cardPreviewSynopsis", els.dialogBody);
    const synopsis = $("#cardSynopsis", els.dialogBody);
    synopsis.addEventListener("input", () => {
      preview.textContent = synopsis.value || "A scene card synopsis will appear here.";
    });
    $("#cardOmit", els.dialogBody).addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.classList.toggle("is-on");
      button.setAttribute("aria-checked", String(button.classList.contains("is-on")));
    });
    $$("#cardColors .scene-color", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        $$("#cardColors .scene-color", els.dialogBody).forEach((item) =>
          item.classList.remove("is-active"),
        );
        button.classList.add("is-active");
        $(".scene-dialog-preview", els.dialogBody).style.setProperty(
          "--scene-color",
          button.dataset.color || "var(--brand)",
        );
      });
    });
  }
  function openTitlePage() {
    const draft = { ...state.doc.titlePage };
    openDialog({
      eyebrow: "Front matter",
      title: "Title page",
      body: `
        <div class="title-page-dialog">
          <div class="title-page-form">
            <div class="setting-line"><div><strong>Include title page</strong><span>Adds an unnumbered first page to the PDF and preview.</span></div><button type="button" class="switch ${draft.enabled ? "is-on" : ""}" id="titleEnabled" role="switch" aria-checked="${draft.enabled}"><span></span></button></div>
            <label class="field"><span>Title</span><input id="tpTitle" type="text" maxlength="120" value="${escapeHtml(draft.title || state.doc.title)}"></label>
            <label class="field"><span>Credit</span><input id="tpCredit" type="text" maxlength="80" value="${escapeHtml(draft.credit || "Written by")}"></label>
            <label class="field"><span>Author</span><input id="tpAuthor" type="text" maxlength="120" value="${escapeHtml(draft.author || state.doc.author)}"></label>
            <label class="field"><span>Source</span><input id="tpSource" type="text" maxlength="160" value="${escapeHtml(draft.source || "")}" placeholder="Based on…"></label>
            <label class="field"><span>Draft / date</span><input id="tpDate" type="text" maxlength="80" value="${escapeHtml(draft.draftDate || "")}" placeholder="First Draft · October 2026"></label>
            <label class="field"><span>Contact</span><input id="tpContact" type="text" maxlength="160" value="${escapeHtml(draft.contact || "")}" placeholder="Email or representation"></label>
            <label class="field"><span>Notes</span><textarea id="tpNotes" rows="2" maxlength="200" placeholder="Optional">${escapeHtml(draft.notes || "")}</textarea></label>
          </div>
          <div class="title-page-preview-wrap"><span class="eyebrow">Preview</span><div class="title-page-preview" id="titlePagePreview">${titlePageMarkup(draft, true)}</div></div>
        </div>`,
      actions: [
        { label: "Cancel" },
        {
          label: "Save title page",
          kind: "primary",
          onClick: () => {
            const enabled = $("#titleEnabled", els.dialogBody).classList.contains("is-on");
            const title = $("#tpTitle", els.dialogBody).value.trim() || state.doc.title;
            state.doc.titlePage = {
              ...state.doc.titlePage,
              enabled,
              title,
              credit: $("#tpCredit", els.dialogBody).value.trim(),
              author: $("#tpAuthor", els.dialogBody).value.trim(),
              source: $("#tpSource", els.dialogBody).value.trim(),
              draftDate: $("#tpDate", els.dialogBody).value.trim(),
              contact: $("#tpContact", els.dialogBody).value.trim(),
              notes: $("#tpNotes", els.dialogBody).value.trim(),
            };
            if (title !== state.doc.title) {
              state.doc.title = title;
              els.titleInput.value = title;
            }
            if (state.doc.titlePage.author) {
              state.doc.author = state.doc.titlePage.author;
              els.authorInput.value = state.doc.author;
            }
            markDirty();
            state.history.record();
            renderAll();
            toast("Title page updated", "The front matter is ready for print and FDX.", "success");
          },
        },
      ],
    });
    const refresh = () => {
      const preview = $("#titlePagePreview", els.dialogBody);
      if (!preview) return;
      preview.innerHTML = titlePageMarkup(
        {
          enabled: $("#titleEnabled", els.dialogBody).classList.contains("is-on"),
          title: $("#tpTitle", els.dialogBody).value,
          credit: $("#tpCredit", els.dialogBody).value,
          author: $("#tpAuthor", els.dialogBody).value,
          source: $("#tpSource", els.dialogBody).value,
          draftDate: $("#tpDate", els.dialogBody).value,
          contact: $("#tpContact", els.dialogBody).value,
          notes: $("#tpNotes", els.dialogBody).value,
        },
        true,
      );
    };
    $$("#tpTitle, #tpCredit, #tpAuthor, #tpSource, #tpDate, #tpContact, #tpNotes", els.dialogBody).forEach(
      (input) => input.addEventListener("input", refresh),
    );
    $("#titleEnabled", els.dialogBody).addEventListener("click", (event) => {
      event.currentTarget.classList.toggle("is-on");
      event.currentTarget.setAttribute(
        "aria-checked",
        String(event.currentTarget.classList.contains("is-on")),
      );
      refresh();
    });
  }
  function openRevisionManager() {
    const revision = state.doc.revision;
    const current = revisionEntry(state.doc, revision.current);
    const counts = new Map();
    for (const paragraph of state.doc.paragraphs) {
      if (!paragraph.revision) continue;
      counts.set(paragraph.revision, (counts.get(paragraph.revision) || 0) + 1);
    }
    const rows = revision.history
      .slice()
      .sort((a, b) => b.id - a.id)
      .map(
        (entry) => `
        <div class="revision-row">
          <span class="revision-row__swatch" style="background:${entry.hex}"></span>
          <div><strong>Rev ${entry.id} · ${escapeHtml(entry.name)}</strong><span>${counts.get(entry.id) || 0} marked blocks</span></div>
          ${entry.id === revision.current ? `<span class="revision-row__current">Current</span>` : ""}
        </div>`,
      )
      .join("");
    openDialog({
      eyebrow: "Revision control",
      title: "Revision manager",
      body: `
        <div class="revision-hero" style="--revision-color:${current.hex}">
          <span class="revision-hero__swatch"></span>
          <div><span class="eyebrow">Active set</span><strong>Rev ${revision.current} · ${escapeHtml(current.name)}</strong><p>${revision.enabled ? "Every edit is marked in the current revision color." : "Revision marks are preserved but hidden."}</p></div>
          <button type="button" class="switch ${revision.enabled ? "is-on" : ""}" id="revisionModeSwitch" role="switch" aria-label="Revision mode" aria-checked="${revision.enabled}"><span></span></button>
        </div>
        <div class="revision-list">${rows || `<p class="subtle">No marked revisions yet.</p>`}</div>
        <div class="dialog-note">Page view, PDF export, and FDX each carry the active revision color and paragraph marks.</div>`,
      actions: [
        { label: "Start next revision", kind: "primary", onClick: startNextRevision },
        {
          label: "Clear marks",
          kind: "danger",
          onClick: () =>
            confirmAction(
              "Clear all revision marks?",
              "Paragraphs stay intact; only revision IDs and colors are cleared.",
              "Clear revisions",
              () => {
                state.doc.revision = {
                  enabled: false,
                  current: 1,
                  history: [],
                };
                state.doc.paragraphs.forEach((paragraph) => {
                  paragraph.revision = null;
                });
                markDirty();
                state.history.record();
                renderAll();
                toast("Revisions cleared", "The draft is clean for a new pass.", "success");
              },
            ),
        },
        { label: "Done" },
      ],
    });
    $("#revisionModeSwitch", els.dialogBody).addEventListener("click", (event) => {
      toggleRevisionMode();
      const button = event.currentTarget;
      button.classList.toggle("is-on");
      button.setAttribute("aria-checked", String(button.classList.contains("is-on")));
      /* The hero paragraph describes what the switch means, so it has to follow
       * the toggle: it kept saying "marks are preserved but hidden" while the
       * status bar already read "Rev 1 · On". */
      const caption = els.dialogBody.querySelector(".revision-hero p");
      if (caption) {
        caption.textContent = state.doc.revision.enabled
          ? "Every edit is marked in the current revision color."
          : "Revision marks are preserved but hidden.";
      }
    });
  }
  function startNextRevision() {
    const entry = nextRevision(state.doc);
    state.doc.revision.enabled = true;
    markDirty();
    state.history.record();
    renderAll();
    document.body.classList.add("revision-flash");
    setTimeout(() => document.body.classList.remove("revision-flash"), 900);
    toast(
      `Rev ${entry.id} · ${entry.name}`,
      "Revision mode is on. New edits are now marked in this color.",
      "success",
    );
  }
  function toggleRevisionMode() {
    state.doc.revision.enabled = !state.doc.revision.enabled;
    markDirty();
    state.history.record();
    renderAll();
    toast(
      state.doc.revision.enabled ? "Revision mode on" : "Revision mode off",
      state.doc.revision.enabled
        ? "New edits will be marked in the active revision color."
        : "Existing revision marks stay in the document, but are hidden.",
      "info",
      2400,
    );
  }
  function openCastProfile(character) {
    const cast = state.doc.cast[character.id] || {};
    const voices = getSpeechVoices();
    const voiceOptions = [
      `<option value="">Auto voice</option>`,
      ...voices.map(
        (voice) =>
          `<option value="${escapeHtml(voice.voiceURI)}"${cast.voiceURI === voice.voiceURI ? " selected" : ""}>${escapeHtml(voice.name)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ""}</option>`,
      ),
    ].join("");
    openDialog({
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
            state.doc.cast[character.id] = {
              ...(state.doc.cast[character.id] || {}),
              actor: $("#castActor", els.dialogBody).value.trim(),
              voiceURI: $("#castVoice", els.dialogBody).value,
              notes: $("#castNotes", els.dialogBody).value.trim(),
              color: character.color,
            };
            markDirty();
            state.history.record();
            renderCharacters();
            if (state.read.active) rebuildReadItems();
            toast("Character updated", `${character.name} is ready for the read-through.`, "success");
          },
        },
      ],
    });
  }
  /* ------------------------------------------------------------------ */
  /* find and replace                                                    */
  /* ------------------------------------------------------------------ */
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function buildFindRegex() {
    const query = state.find.query;
    if (!query) return null;
    const flags = state.find.caseSensitive ? "gu" : "giu";
    let pattern = state.find.regex ? query : escapeRegExp(query);
    if (state.find.wholeWord && !state.find.regex) {
      pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
    }
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  function findInParagraph(paragraph, regex) {
    const text = paragraphText(paragraph);
    if (!regex) return [];
    const matches = [];
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (!match[0]) {
        regex.lastIndex += text.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
        continue;
      }
      matches.push({
        paragraphId: paragraph.id,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      if (matches.length > 300) break;
    }
    return matches;
  }
  function setFindBusy(busy) {
    state.find.busy = busy;
    for (const id of ["findNext", "findPrev", "findReplaceOne", "findReplaceAll"]) {
      const control = document.getElementById(id);
      if (control) control.disabled = busy;
    }
    let cancel = $("#cancelBackgroundSearch");
    if (!cancel) {
      cancel = document.createElement("button"); cancel.id = "cancelBackgroundSearch";
      cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "Cancel search";
      els.findCount.after(cancel);
      cancel.addEventListener("click", () => {
        findGeneration++; regexClient.cancel(); setFindBusy(false);
        els.findCount.textContent = "Search cancelled";
      });
    }
    cancel.hidden = !busy;
    els.findResults.setAttribute("aria-busy", String(busy));
  }
  async function runFind() {
    const generation = ++findGeneration;
    const version = state.editVersion;
    state.find.matches = [];
    state.find.truncated = false;
    regexClient.cancel();
    clearFindHighlights();
    if (!state.find.query) {
      setFindBusy(false); renderFindResults(); return;
    }
    const regex = buildFindRegex();
    if (!regex) { setFindBusy(false); renderFindResults({ invalid: true }); return; }
    setFindBusy(true);
    els.findCount.textContent = "Searching…";
    try {
      const result = await regexClient.search(state.doc.paragraphs, { pattern: regex.source, flags: regex.flags });
      if (generation !== findGeneration || version !== state.editVersion) return;
      state.find.matches = result.matches;
      state.find.truncated = result.truncated;
      state.find.version = version;
      state.find.index = clamp(state.find.index, 0, Math.max(0, result.matches.length - 1));
      renderFindResults(); applyFindHighlights();
      return result;
    } catch (error) {
      if (generation !== findGeneration || error.code === "SEARCH_CANCELLED") return;
      els.findCount.textContent = error.code === "SEARCH_TIMEOUT" ? "Search timed out" : "Search unavailable";
      els.findResults.innerHTML = `<div class="find-empty"><span>${escapeHtml(error.message)}</span></div>`;
    } finally { if (generation === findGeneration) setFindBusy(false); }
  }
  function renderFindResults(options = {}) {
    const matches = state.find.matches;
    const invalid = Boolean(options.invalid);
    /* The count label belongs to this function; runFind() cannot set it before
     * calling here without the text being overwritten in the same tick. An
     * invalid pattern therefore used to report "0 results" — indistinguishable
     * from a valid search that matched nothing. */
    els.findCount.textContent = invalid
      ? "Invalid regex"
      : state.find.query
        ? `${state.find.truncated ? "At least " : ""}${matches.length} result${matches.length === 1 ? "" : "s"}${state.find.truncated ? " — narrow the search before replacing all" : ""}`
        : /* Empty, not "Find in screenplay": that string duplicated the input's
           * own placeholder, so before typing the field appeared to contain a
           * stray second copy of its own label. */
          "";
    els.findResults.innerHTML = "";
    if (invalid) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("warning")}<span>That regex is not valid. Check brackets, quantifiers and escapes.</span></div>`;
      return;
    }
    if (!state.find.query) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("search")}<span>Type a word or phrase to search the whole draft.</span></div>`;
      return;
    }
    if (!matches.length) {
      els.findResults.innerHTML = `<div class="find-empty">${icon("check-circle")}<span>No matches. Try a shorter phrase or turn off whole-word.</span></div>`;
      return;
    }
    matches.slice(0, 200).forEach((match, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `find-result${index === state.find.index ? " is-active" : ""}`;
      button.style.setProperty("--i", String(index));
      button.innerHTML = `<span class="find-result__index">${String(index + 1).padStart(2, "0")}</span><span class="find-result__copy">…${escapeHtml(match.before)}<mark>${escapeHtml(match.text)}</mark>${escapeHtml(match.after)}…</span><span class="find-result__type">${escapeHtml(match.type)}</span>`;
      button.addEventListener("click", () => {
        state.find.index = index;
        renderFindResults();
        selectFindMatch(index, true);
      });
      els.findResults.appendChild(button);
    });
  }
  function openFind(mode = "find") {
    invalidateModalClose(els.findDialog);
    hideSmartType();
    state.find.mode = mode;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const selected = selection.toString().trim();
      if (selected && selected.length < 90) {
        state.find.query = selected;
        els.findInput.value = selected;
      }
    }
    els.findDialog.classList.remove("is-closing");
    if (!els.findDialog.open) els.findDialog.showModal();
    state.find.open = true;
    runFind();
    requestAnimationFrame(() => {
      els.findInput.focus();
      if (mode === "replace") els.replaceInput.focus();
      els.findInput.select();
    });
  }
  function closeFind() {
    findGeneration++; regexClient.cancel(); setFindBusy(false);
    if (!els.findDialog.open) return;
    const match = state.find.matches[state.find.index];
    closeModalAnimated(els.findDialog, () => {
      state.find.open = false;
      clearFindHighlights();
      $$(".para.is-find-target", els.editor).forEach((el) => el.classList.remove("is-find-target"));
      if (match && state.doc.paragraphs.some(p => p.id === match.paragraphId)) {
        focusParagraph(match.paragraphId, "start");
        const el = paragraphElement(match.paragraphId), range = el && rangeForOffsets(el, match.start, match.end);
        if (range) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }
    });
  }
  function rangeForOffsets(root, start, end) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === 1 && node.tagName === "BR") return NodeFilter.FILTER_ACCEPT;
        if (node.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });
    let offset = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1 && node.tagName === "BR") {
        if (startNode === null && offset >= start) {
          startNode = node.parentNode;
          startOffset = Array.from(node.parentNode.childNodes).indexOf(node);
        }
        if (startNode !== null && offset + 1 >= end) {
          endNode = node.parentNode;
          endOffset = Array.from(node.parentNode.childNodes).indexOf(node);
          break;
        }
        offset += 1;
      } else {
        const length = node.nodeValue.length;
        if (startNode === null && offset + length >= start) {
          startNode = node;
          startOffset = start - offset;
        }
        if (startNode !== null && offset + length >= end) {
          endNode = node;
          endOffset = end - offset;
          break;
        }
        offset += length;
      }
    }
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.max(0, startOffset));
      range.setEnd(endNode, Math.max(0, endOffset));
      return range;
    } catch {
      return null;
    }
  }
  function rangeForMatch(match) {
    const el = paragraphElement(match.paragraphId);
    if (!el) return null;
    return rangeForOffsets(el, match.start, match.end);
  }
  function clearFindHighlights() {
    if (window.CSS && CSS.highlights) {
      CSS.highlights.delete("fd-find");
      CSS.highlights.delete("fd-find-current");
    }
  }
  function applyFindHighlights() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === "undefined") return;
    if (!state.find.open || !state.find.matches.length) {
      clearFindHighlights();
      return;
    }
    const ranges = state.find.matches.map(rangeForMatch).filter(Boolean);
    if (!ranges.length) return;
    CSS.highlights.set("fd-find", new Highlight(...ranges));
    const current = ranges[state.find.index];
    if (current) CSS.highlights.set("fd-find-current", new Highlight(current));
    else CSS.highlights.delete("fd-find-current");
  }
  function selectFindMatch(index, scroll = true) {
    if (!state.find.matches.length) return;
    state.find.index = clamp(index, 0, state.find.matches.length - 1);
    const match = state.find.matches[state.find.index];
    if (state.view !== "script") setView("script");
    if (state.mode !== "write") setMode("write");
    const el = paragraphElement(match.paragraphId);
    if (!el) return;
    const range = rangeForOffsets(el, match.start, match.end);
    if (!range) return;
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $$(".para.is-find-target", els.editor).forEach((item) => item.classList.remove("is-find-target"));
    el.classList.add("is-find-target");
    if (scroll) scrollParagraphIntoView(el, "center", true);
    applyFindHighlights();
    $$(".find-result", els.findResults).forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === state.find.index);
    });
  }
  function replaceRangeInHtml(html, start, end, replacement) {
    const runs = FDX.htmlToRuns(html);
    const output = [];
    let cursor = 0;
    let replaced = false;
    for (const run of runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;
      if (runEnd <= start || runStart >= end) {
        output.push(run);
        continue;
      }
      if (runStart < start) {
        output.push({ ...run, text: run.text.slice(0, start - runStart) });
      }
      if (!replaced) {
        output.push({ ...run, text: replacement });
        replaced = true;
      }
      if (runEnd > end) {
        output.push({ ...run, text: run.text.slice(end - runStart) });
      }
    }
    if (!replaced) output.push({ text: replacement, style: "" });
    return FDX.runsToHtml(output.filter((run) => run.text));
  }
  function refreshAfterFindEdit(paragraph) {
    if (state.doc.revision.enabled) markRevision(state.doc, paragraph);
    markDirty();
    state.history.record();
    const el = paragraphElement(paragraph.id);
    if (el) {
      el.innerHTML = paragraph.html;
      applyRevisionToElement(el, paragraph);
    }
    decorateEditor();
    scheduleChrome();
    runFind();
  }
  function replaceCurrent() {
    if (state.find.busy || !state.find.matches.length) return;
    if (state.find.version !== state.editVersion) { runFind(); return; }
    const match = state.find.matches[state.find.index];
    const paragraph = state.doc.paragraphs.find((item) => item.id === match.paragraphId);
    if (!paragraph) return;
    const replacement = FDCoreWriting.expandReplacement(els.replaceInput.value, match, paragraphText(paragraph));
    paragraph.html = replaceRangeInHtml(paragraph.html, match.start, match.end, replacement);
    refreshAfterFindEdit(paragraph);
    toast("Replaced", `One match in ${match.type}.`, "success", 1800);
  }
  /* Expand `$&`, `$1`…`$99` and `$$` in a replacement for one match, using the
   * same rules String.prototype.replace applies. Without this, regex replace
   * wrote "$1" into the script literally and silently destroyed the captured
   * names — a destructive bulk edit with a success toast. `$`` and `$'` are
   * supported too, since they are part of the same substitution grammar. */
  function expandReplacement(template, matchArray, index, text) {
    if (!template || template.indexOf("$") === -1) return template;
    const whole = matchArray[0] || "";
    return template.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (token, group) => {
      if (group === "$") return "$";
      if (group === "&") return whole;
      if (group === "`") return text.slice(0, index);
      if (group === "'") return text.slice(index + whole.length);
      if (group.startsWith("<")) {
        return matchArray.groups === undefined ? token : (matchArray.groups[group.slice(1, -1)] ?? "");
      }
      const captureIndex = Number(group);
      /* `matchArray` is a real array here (not an object spread, which would
       * drop `length` and make every numbered reference fall through). */
      if (captureIndex >= 1 && captureIndex < matchArray.length) {
        return matchArray[captureIndex] == null ? "" : matchArray[captureIndex];
      }
      if (group.length === 2 && Number(group[0]) >= 1 && Number(group[0]) < matchArray.length) {
        return (matchArray[Number(group[0])] ?? "") + group[1];
      }
      /* An out-of-range reference is left as typed rather than blanked. */
      return token;
    });
  }
  function replaceAll() {
    if (state.find.busy || !state.find.query || !state.find.matches.length) return;
    if (state.find.version !== state.editVersion) { runFind(); return; }
    if (state.find.truncated) { toast("Too many matches", "Narrow the search so every replacement can be reviewed and applied together.", "warning"); return; }
    const replacement = els.replaceInput.value;
    const byParagraph = new Map();
    for (const match of state.find.matches) {
      if (!byParagraph.has(match.paragraphId)) byParagraph.set(match.paragraphId, []);
      byParagraph.get(match.paragraphId).push(match);
    }
    let count = 0;
    for (const paragraph of state.doc.paragraphs) {
      const text = paragraphText(paragraph);
      const matches = byParagraph.get(paragraph.id) || [];
      if (!matches.length) continue;
      let html = paragraph.html;
      for (const item of matches.slice().reverse()) {
        const value = FDCoreWriting.expandReplacement(replacement, item, text);
        html = replaceRangeInHtml(html, item.start, item.end, value);
        count += 1;
      }
      paragraph.html = html;
      if (state.doc.revision.enabled) markRevision(state.doc, paragraph);
    }
    if (count) {
      markDirty();
      state.history.record();
      renderAll();
      state.find.index = 0;
      runFind();
      toast("Replaced all", `${plural(count, "match", "matches")} updated.`, "success");
    } else {
      runFind();
    }
  }
  /* ------------------------------------------------------------------ */
  /* table read                                                          */
  /* ------------------------------------------------------------------ */
  function getSpeechVoices() {
    if (!("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices().slice().sort((a, b) => {
      const aEn = /^en/i.test(a.lang) ? 0 : 1;
      const bEn = /^en/i.test(b.lang) ? 0 : 1;
      return aEn - bEn || a.name.localeCompare(b.name);
    });
  }
  function populateReadVoices() {
    if (!els.readVoice) return;
    /* The <button><selectedcontent></selectedcontent></button> child is customizable
     * select's display slot: it is what lets a long voice name ellipsis-truncate
     * while keeping the arrow, which the base-select value box cannot do (see the
     * Select normalisation block in app/styles-desktop.css for the measurements).
     * It has to be re-emitted with the options, because this function replaces
     * innerHTML wholesale. */
    const slot = `<button type="button"><selectedcontent></selectedcontent></button>`;
    const voices = getSpeechVoices();
    if (!voices.length) {
      els.readVoice.innerHTML = `${slot}<option value="">System voice</option>`;
      return;
    }
    const current =
      state.read.voiceURI ||
      (state.appInfo && navigator.language) ||
      voices.find((voice) => /^en/i.test(voice.lang))?.voiceURI ||
      voices[0].voiceURI;
    if (!voices.some((voice) => voice.voiceURI === current)) {
      state.read.voiceURI = voices[0].voiceURI;
    }
    els.readVoice.innerHTML = slot + voices
      .map(
        (voice) =>
          `<option value="${escapeHtml(voice.voiceURI)}"${voice.voiceURI === state.read.voiceURI ? " selected" : ""}>${escapeHtml(voice.name)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ""}</option>`,
      )
      .join("");
  }
  function buildReadItems() {
    const scenes = getScenes(state.doc);
    const omitted = new Set();
    for (const scene of scenes) {
      if (!scene.omit) continue;
      for (let index = scene.startIndex; index < scene.endIndex; index += 1) omitted.add(index);
    }
    const items = [];
    let currentName = "";
    state.doc.paragraphs.forEach((paragraph, index) => {
      if (omitted.has(index)) return;
      const text = paragraphText(paragraph).trim();
      if (!text) return;
      if (paragraph.type === "Character") {
        currentName = text.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
        return;
      }
      const speaker =
        paragraph.type === "Dialogue" ? currentName || "Character" : "Narrator";
      items.push({
        paragraphId: paragraph.id,
        type: paragraph.type,
        text,
        speaker,
        speak: true,
      });
    });
    return items;
  }
  function rebuildReadItems() {
    const current = state.read.items[state.read.index];
    state.read.items = buildReadItems();
    if (current) {
      const found = state.read.items.findIndex((item) => item.paragraphId === current.paragraphId);
      if (found >= 0) state.read.index = found;
    }
    updateReadDock();
  }
  function openReadDock(fromHere) {
    if (!("speechSynthesis" in window)) {
      toast("Table read unavailable", "This browser does not expose speech synthesis.", "warning");
      return;
    }
    stopRead();
    state.read.active = true;
    state.read.items = buildReadItems();
    if (!state.read.items.length) {
      toast("Nothing to read", "Add some action or dialogue first.", "info", 2200);
      return;
    }
    const active = activeParagraph();
    if (fromHere && active) {
      const index = state.read.items.findIndex((item) => item.paragraphId === active.id);
      if (index >= 0) state.read.index = index;
    } else {
      state.read.index = 0;
    }
    els.readDock.classList.remove("is-closing");
    els.readDock.classList.add("is-open");
    els.readDock.setAttribute("aria-hidden", "false");
    document.body.classList.add("read-open");
    populateReadVoices();
    updateReadDock();
    speakCurrent();
  }
  function closeReadDock() {
    stopRead();
    state.read.active = false;
    document.body.classList.remove("read-open");
    removeReadHighlight();
    if (els.readDock) {
      els.readDock.classList.remove("is-open");
      els.readDock.classList.add("is-closing");
      setTimeout(() => {
        if (!state.read.active) {
          els.readDock.classList.remove("is-closing");
          els.readDock.setAttribute("aria-hidden", "true");
        }
      }, 220);
    }
  }
  function removeReadHighlight() {
    $$(".para.is-reading", els.editor).forEach((el) => el.classList.remove("is-reading"));
  }
  function highlightRead(paragraphId) {
    removeReadHighlight();
    const el = paragraphElement(paragraphId);
    if (el) {
      el.classList.add("is-reading");
      scrollParagraphIntoView(el, "center", true);
    }
  }
  function updateReadDock() {
    const item = state.read.items[state.read.index];
    const count = state.read.items.length;
    els.readLine.textContent = item ? truncate(item.text, 165) : "Ready when you are.";
    els.readSpeaker.textContent = item ? item.speaker : "Narrator";
    els.readKicker.textContent = state.read.playing
      ? state.read.paused
        ? "TABLE READ · PAUSED"
        : "TABLE READ · PLAYING"
      : "TABLE READ";
    els.readProgress.style.width = `${count ? ((state.read.index + 1) / count) * 100 : 0}%`;
    els.readPulse.classList.toggle("is-speaking", state.read.playing && !state.read.paused);
    els.readPlay.innerHTML = state.read.playing && !state.read.paused ? icon("pause") : icon("play");
    els.readPlay.setAttribute(
      "aria-label",
      state.read.playing && !state.read.paused ? "Pause table read" : "Play table read",
    );
    if (els.readRate) els.readRate.value = String(state.read.rate);
  }
  function truncate(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }
  function voiceForSpeaker(speaker) {
    const voices = getSpeechVoices();
    if (!voices.length) return null;
    const narrator =
      (state.read.voiceURI && voices.find((voice) => voice.voiceURI === state.read.voiceURI)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      voices[0];
    if (speaker === "Narrator") return narrator;
    const character = getCharacters(state.doc).find((item) => item.name === speaker);
    const meta = character && state.doc.cast ? state.doc.cast[character.id] : null;
    if (meta && meta.voiceURI) {
      const found = voices.find((voice) => voice.voiceURI === meta.voiceURI);
      if (found) return found;
    }
    if (!character) return narrator;
    const pool = voices.filter((voice) => voice.voiceURI !== narrator.voiceURI);
    if (!pool.length) return narrator;
    const chars = getCharacters(state.doc);
    const index = Math.max(0, chars.findIndex((item) => item.name === speaker));
    return pool[index % pool.length];
  }
  function speakCurrent() {
    if (!state.read.active) return;
    const speech = window.speechSynthesis;
    if (!speech) return;
    const item = state.read.items[state.read.index];
    if (!item) {
      stopRead();
      return;
    }
    speech.cancel();
    const token = ++state.read.token;
    highlightRead(item.paragraphId);
    const readItem=FDProduction.readPlan(state.doc).items.find(p=>p.paragraphId===item.paragraphId);
    const utterance = new SpeechSynthesisUtterance(readItem?.text || item.text);
    const voice = voiceForSpeaker(item.speaker);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-US";
    }
    utterance.rate = clamp(Number(state.read.rate) || 1, 0.5, 2);
    utterance.pitch = item.speaker === "Narrator" ? 0.92 : 1.04;
    const profile=readItem?.profile;
    if(profile){const selected=window.speechSynthesis.getVoices().find(v=>v.name===profile.voice);if(selected){utterance.voice=selected;utterance.lang=selected.lang;}utterance.rate=clamp(Number(profile.rate)||1,0.5,2);utterance.pitch=clamp(Number(profile.pitch)||1,0,2);}
    utterance.onstart = () => {
      if (token !== state.read.token) return;
      state.read.playing = true;
      state.read.paused = false;
      updateReadDock();
    };
    utterance.onend = () => {
      if (token !== state.read.token) return;
      state.read.playing = false;
      advanceRead(1);
    };
    utterance.onerror = (event) => {
      if (token !== state.read.token) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      state.read.playing = false;
      updateReadDock();
      toast("Table read stopped", event.error || "Speech synthesis could not continue.", "warning", 3200);
    };
    state.read.utterance = utterance;
    setTimeout(() => {
      if (token !== state.read.token) return;
      try {
        speech.speak(utterance);
      } catch (error) {
        state.read.playing = false;
        updateReadDock();
        toast("Table read stopped", error.message || "Speech synthesis could not start.", "warning", 3200);
      }
    }, 28);
    state.read.playing = true;
    state.read.paused = false;
    updateReadDock();
  }
  function advanceRead(direction) {
    if (!state.read.active) return;
    let next = state.read.index + direction;
    while (next >= 0 && next < state.read.items.length) {
      if (state.read.items[next].speak) break;
      next += direction;
    }
    if (next < 0 || next >= state.read.items.length) {
      state.read.playing = false;
      state.read.paused = false;
      state.read.index = direction > 0 ? state.read.items.length - 1 : 0;
      updateReadDock();
      removeReadHighlight();
      return;
    }
    state.read.index = next;
    speakCurrent();
  }
  function pauseOrResume() {
    if (!state.read.active) {
      openReadDock(true);
      return;
    }
    const speech = window.speechSynthesis;
    if (!speech) return;
    if (state.read.playing && !state.read.paused) {
      speech.pause();
      state.read.paused = true;
      updateReadDock();
    } else if (state.read.paused) {
      speech.resume();
      state.read.paused = false;
      state.read.playing = true;
      updateReadDock();
    } else {
      speakCurrent();
    }
  }
  function stopRead() {
    if (!("speechSynthesis" in window)) return;
    state.read.token += 1;
    window.speechSynthesis.cancel();
    state.read.playing = false;
    state.read.paused = false;
    state.read.utterance = null;
    removeReadHighlight();
    updateReadDock();
  }
  /* ------------------------------------------------------------------ */
  /* settings, help, document details, page setup                        */
  /* ------------------------------------------------------------------ */
  function currentPagePreset(page) {
    for (const [key, preset] of Object.entries(PAGE_PRESETS)) {
      if (Math.abs(page.width - preset.width) < 0.05 && Math.abs(page.height - preset.height) < 0.05) {
        return key;
      }
    }
    return "custom";
  }
  function resetPreferencesToDefaults() {
    state.theme = "light";
    state.accentColor = "cobalt";
    state.paperTint = "ivory";
    state.uiDensity = "comfortable";
    state.ambientGlow = true;
    state.reducedMotionPref = false;
    state.lineSpacing = "normal";
    state.smartTypeEnabled = true;
    state.autoUppercase = false;
    state.spellcheck = true;
    state.highlightActiveLine = true;
    state.typewriterScroll = false;
    state.typewriterMode = "off";
    state.autosaveDelay = 650;
    state.zoom = 1;
    state.mode = "write";
    state.font = SCRIPT_FONT;    state.fontSize = 12;
    state.showGuides = true;
    state.showInvisibles = false;
    state.autosave = true;
    state.startCenterOnLaunch = true;
    state.read.rate = 1;
    state.showOutlineInScript = true;
    state.showStructureLines = false;
    state.hideScriptNotes = false;
    state.navigatorVisible = true;
    state.textColor = "#171614";
    state.highlightColor = "#ffe9a3";
    state.beatConnectionColor = "#0f6cbd";
    state.profile = { name: "Local Writer", role: "Writer" };
    state.lastBackupAt = 0;
    state.trackedBaseline = null;
    state.doc.settings = {
      ...state.doc.settings,
      sceneNumbers: true,
      sceneNumberSide: "both",
      pageNumbers: true,
      showMore: true,
      smartQuotes: true,
    };
    state.layoutDirty = true;
    applyTheme(state.theme, false);
    applyStudioAppearance();
    setMode(state.mode);
    renderAll();
    syncPrefsUI();
    persistPrefs();
    toast("Preferences reset", "Azkript settings are back to their defaults.", "info", 2400);
  }
  function openSettings() {
    const info = state.appInfo;
    const presetKey = currentPagePreset(state.doc.page);
    const fonts = SCRIPT_FONT_CHOICES.map((choice) => choice.value);    const zoomChoices = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];
    const currentZoom = zoomChoices.includes(Number(state.zoom)) ? Number(state.zoom) : 1;
    openDialog({
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
            <label class="field"><span>Interface theme</span><select id="settingsTheme"><option value="light"${state.theme === "light" ? " selected" : ""}>Light</option><option value="dark"${state.theme === "dark" ? " selected" : ""}>Dark</option><option value="midnight"${state.theme === "midnight" ? " selected" : ""}>Midnight Mode</option><option value="system"${state.theme === "system" ? " selected" : ""}>Follow system</option></select></label>
            <label class="field"><span>Paper surface tint</span><select id="settingsPaperTint">${Object.entries(PAPER_TINTS).map(([key, item]) => `<option value="${key}"${state.paperTint === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
            <label class="field"><span>Interface density</span><select id="settingsDensity"><option value="comfortable"${state.uiDensity === "comfortable" ? " selected" : ""}>Comfortable</option><option value="compact"${state.uiDensity === "compact" ? " selected" : ""}>Compact</option><option value="spacious"${state.uiDensity === "spacious" ? " selected" : ""}>Spacious</option></select></label>
            <label class="field"><span>Default view mode</span><select id="settingsMode"><option value="write"${state.mode === "write" ? " selected" : ""}>Normal / Write view (continuous)</option><option value="page"${state.mode === "page" ? " selected" : ""}>Page preview (paginated)</option><option value="speed"${state.mode === "speed" ? " selected" : ""}>Speed view (action collapsed)</option></select></label>
            <label class="field"><span>Default zoom level</span><select id="settingsZoom">${zoomChoices.map((z) => `<option value="${z}"${currentZoom === z ? " selected" : ""}>${Math.round(z * 100)}%</option>`).join("")}</select></label>
            <label class="field"><span>Accent color</span><select id="settingsAccent">${Object.entries(ACCENT_THEMES).map(([key, item]) => `<option value="${key}"${state.accentColor === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
          </div>
          <div class="settings-swatches" id="settingsAccentSwatches" role="group" aria-label="Accent color swatches">
            ${Object.entries(ACCENT_THEMES)
              .map(
                ([key, item]) =>
                  `<button type="button" class="accent-swatch${state.accentColor === key ? " is-active" : ""}" data-accent-choice="${key}" style="--swatch-color:${item.swatch}" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}"><span></span>${escapeHtml(item.label.split(" ").pop())}</button>`,
              )
              .join("")}
          </div>
          <div class="setting-line"><div><strong>Ambient background glow</strong><span>Show subtle color aurora behind the workspace shell.</span></div><button type="button" class="switch ${state.ambientGlow ? "is-on" : ""}" data-setting="ambientGlow" role="switch" aria-checked="${state.ambientGlow}"><span></span></button></div>
          <div class="setting-line"><div><strong>Reduced motion</strong><span>Minimize page-turn, view, and button ripple animations.</span></div><button type="button" class="switch ${state.reducedMotionPref ? "is-on" : ""}" data-setting="reducedMotion" role="switch" aria-checked="${state.reducedMotionPref}"><span></span></button></div>
          <div class="setting-line"><div><strong>Show Start Center on launch</strong><span>Open the recent files and templates screen at startup.</span></div><button type="button" class="switch ${state.startCenterOnLaunch ? "is-on" : ""}" data-setting="startCenter" role="switch" aria-checked="${state.startCenterOnLaunch}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="editor">
          <h3 class="settings-section__title">Editor &amp; Typography</h3>
          <div class="field-grid">
            <label class="field"><span>Script font</span><select id="settingsFont">${fonts.map((f) => `<option value="${escapeHtml(f)}"${normalizeScriptFont(state.font) === f ? " selected" : ""}>${escapeHtml(scriptFontLabel(f))}</option>`).join("")}</select></label>            <label class="field"><span>Font size (pt)</span><input id="settingsFontSize" type="number" min="8" max="24" value="${state.fontSize}"></label>
          </div>
          <label class="field"><span>Line spacing</span><select id="settingsLineSpacing">${Object.entries(LINE_SPACING_OPTIONS).map(([key, item]) => `<option value="${key}"${state.lineSpacing === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
          <div class="setting-line"><div><strong>SmartType autocomplete</strong><span>Suggest characters, locations, times of day, and transitions as you type.</span></div><button type="button" class="switch ${state.smartTypeEnabled ? "is-on" : ""}" data-setting="smartType" role="switch" aria-checked="${state.smartTypeEnabled}"><span></span></button></div>
          <div class="setting-line"><div><strong>Smart quotes &amp; dashes</strong><span>Convert double hyphens to em-dashes, triple dots to ellipses, and store smart quote preference in FDX.</span></div><button type="button" class="switch ${state.doc.settings.smartQuotes ? "is-on" : ""}" data-setting="smartQuotes" role="switch" aria-checked="${state.doc.settings.smartQuotes}"><span></span></button></div>
          <div class="setting-line"><div><strong>Auto-uppercase headings &amp; cues</strong><span>Normalize scene headings, character names, shots, and transitions to uppercase on Enter.</span></div><button type="button" class="switch ${state.autoUppercase ? "is-on" : ""}" data-setting="autoUppercase" role="switch" aria-checked="${state.autoUppercase}"><span></span></button></div>
          <div class="setting-line"><div><strong>Spellcheck</strong><span>Underline misspelled words in the screenplay editor.</span></div><button type="button" class="switch ${state.spellcheck ? "is-on" : ""}" data-setting="spellcheck" role="switch" aria-checked="${state.spellcheck}"><span></span></button></div>
          <div class="setting-line"><div><strong>Highlight active paragraph</strong><span>Tint and accent-mark the currently focused screenplay block.</span></div><button type="button" class="switch ${state.highlightActiveLine ? "is-on" : ""}" data-setting="highlightActive" role="switch" aria-checked="${state.highlightActiveLine}"><span></span></button></div>
          <div class="setting-line"><div><strong>Typewriter scroll</strong><span>Keep the active line vertically centered while writing in continuous mode.</span></div><button type="button" class="switch ${state.typewriterScroll ? "is-on" : ""}" data-setting="typewriterScroll" role="switch" aria-checked="${state.typewriterScroll}"><span></span></button></div>
          <div class="setting-line"><div><strong>Ruler guides</strong><span>Show the 0.5-inch margin grid on the page.</span></div><button type="button" class="switch ${state.showGuides ? "is-on" : ""}" data-setting="guides" role="switch" aria-checked="${state.showGuides}"><span></span></button></div>
          <div class="setting-line"><div><strong>Invisibles</strong><span>Show a paragraph mark in empty elements.</span></div><button type="button" class="switch ${state.showInvisibles ? "is-on" : ""}" data-setting="invisibles" role="switch" aria-checked="${state.showInvisibles}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="page">
          <h3 class="settings-section__title">Page Layout &amp; Script Format</h3>
          <div class="field-grid">
            <label class="field"><span>Page size preset</span><select id="settingsPagePreset">${Object.entries(PAGE_PRESETS).map(([key, item]) => `<option value="${key}"${presetKey === key ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}<option value="custom"${presetKey === "custom" ? " selected" : ""}>Custom (${state.doc.page.width} × ${state.doc.page.height} in)</option></select></label>
            <label class="field"><span>Target length (pages)</span><input id="settingsTarget" type="number" min="1" max="999" value="${state.doc.settings.targetPages}"></label>
          </div>
          <label class="field"><span>Scene number placement</span><select id="settingsSceneNumberSide"><option value="both"${(state.doc.settings.sceneNumberSide || "both") === "both" ? " selected" : ""}>Both margins (Left &amp; Right)</option><option value="left"${state.doc.settings.sceneNumberSide === "left" ? " selected" : ""}>Left margin only</option><option value="right"${state.doc.settings.sceneNumberSide === "right" ? " selected" : ""}>Right margin only</option></select></label>
          <div class="setting-line"><div><strong>Scene numbers</strong><span>Show automatic scene numbers in the editor and page view.</span></div><button type="button" class="switch ${state.doc.settings.sceneNumbers ? "is-on" : ""}" data-setting="sceneNumbers" role="switch" aria-checked="${state.doc.settings.sceneNumbers}"><span></span></button></div>
          <div class="setting-line"><div><strong>Page numbers in header</strong><span>Show numbered folios in the top-right header of script pages.</span></div><button type="button" class="switch ${state.doc.settings.pageNumbers !== false ? "is-on" : ""}" data-setting="pageNumbers" role="switch" aria-checked="${state.doc.settings.pageNumbers !== false}"><span></span></button></div>
          <div class="setting-line"><div><strong>(MORE) / (CONT'D) markers</strong><span>Automatically mark dialogue split across page breaks.</span></div><button type="button" class="switch ${state.doc.settings.showMore !== false ? "is-on" : ""}" data-setting="showMore" role="switch" aria-checked="${state.doc.settings.showMore !== false}"><span></span></button></div>
          <div class="setting-line"><div><strong>Title page</strong><span>Include the title page in page view and PDF exports.</span></div><button type="button" class="switch ${state.doc.titlePage.enabled ? "is-on" : ""}" data-setting="titlePage" role="switch" aria-checked="${state.doc.titlePage.enabled}"><span></span></button></div>
        </section>
        <section class="settings-section" data-settings-section="tools">
          <h3 class="settings-section__title">Tools, Audio &amp; Storage</h3>
          <div class="setting-line"><div><strong>Autosave recovery</strong><span>Keep a crash-safe copy while the desktop app is open.</span></div><button type="button" class="switch ${state.autosave ? "is-on" : ""}" data-setting="autosave" role="switch" aria-checked="${state.autosave}"><span></span></button></div>
          <div class="field-grid" style="margin-top:10px">
            <label class="field"><span>Autosave delay</span><select id="settingsAutosaveInterval"><option value="400"${state.autosaveDelay === 400 ? " selected" : ""}>Fast (0.4s)</option><option value="650"${state.autosaveDelay === 650 ? " selected" : ""}>Standard (0.65s)</option><option value="1500"${state.autosaveDelay === 1500 ? " selected" : ""}>Relaxed (1.5s)</option><option value="3000"${state.autosaveDelay === 3000 ? " selected" : ""}>Every 3 seconds</option><option value="5000"${state.autosaveDelay === 5000 ? " selected" : ""}>Every 5 seconds</option></select></label>
            <label class="field"><span>Table read speed</span><select id="settingsReadRate"><option value="0.8"${Number(state.read.rate) === 0.8 ? " selected" : ""}>0.8× (Measured)</option><option value="1"${Number(state.read.rate) === 1 ? " selected" : ""}>1.0× (Natural)</option><option value="1.2"${Number(state.read.rate) === 1.2 ? " selected" : ""}>1.2× (Brisk)</option><option value="1.5"${Number(state.read.rate) === 1.5 ? " selected" : ""}>1.5× (Fast)</option></select></label>
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
            confirmAction(
              "Clear local data?",
              "This removes the browser copy only. Export FDX first if you need a portable backup.",
              "Clear data",
              () => {
                try {
                  /* Clear every spelling this document may be stored under,
                   * including pre-rename keys: leaving one behind resurrects
                   * the deleted draft on the next load. */
                  localStorage.removeItem(DOC_KEY);
                  localStorage.removeItem(LEGACY_DOC_KEY);
                  for (const key of RENAMED_DOC_KEYS) localStorage.removeItem(key);
                } catch {}
                loadDocument(blankDocument(), { clearRecovery: true, persist: false });
                toast("Local data cleared", "A fresh document is open.", "warning");
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
          return state.autosave;
        case "guides":
          return state.showGuides;
        case "invisibles":
          return state.showInvisibles;
        case "sceneNumbers":
          return state.doc.settings.sceneNumbers;
        case "pageNumbers":
          return state.doc.settings.pageNumbers !== false;
        case "showMore":
          return state.doc.settings.showMore !== false;
        case "titlePage":
          return state.doc.titlePage.enabled;
        case "startCenter":
          return state.startCenterOnLaunch;
        case "ambientGlow":
          return state.ambientGlow;
        case "reducedMotion":
          return state.reducedMotionPref;
        case "smartType":
          return state.smartTypeEnabled;
        case "smartQuotes":
          return state.doc.settings.smartQuotes !== false;
        case "autoUppercase":
          return state.autoUppercase;
        case "spellcheck":
          return state.spellcheck;
        case "highlightActive":
          return state.highlightActiveLine;
        case "typewriterScroll":
          return state.typewriterScroll;
        default:
          return false;
      }
    };
    $$(".switch[data-setting]", els.dialogBody).forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.setting;
        if (key === "autosave") state.autosave = !state.autosave;
        if (key === "guides") {
          state.showGuides = !state.showGuides;
          els.paper.classList.toggle("has-guides", state.showGuides);
        }
        if (key === "invisibles") {
          state.showInvisibles = !state.showInvisibles;
          els.paper.classList.toggle("has-invisibles", state.showInvisibles);
        }
        if (key === "sceneNumbers") {
          state.doc.settings.sceneNumbers = !state.doc.settings.sceneNumbers;
          markDirty();
          renderAll();
        }
        if (key === "pageNumbers") {
          state.doc.settings.pageNumbers = !state.doc.settings.pageNumbers;
          markDirty();
          renderAll();
        }
        if (key === "showMore") {
          state.doc.settings.showMore = !state.doc.settings.showMore;
          state.layoutDirty = true;
          markDirty();
          renderAll();
        }
        if (key === "titlePage") {
          state.doc.titlePage.enabled = !state.doc.titlePage.enabled;
          state.layoutDirty = true;
          markDirty();
          renderAll();
        }
        if (key === "startCenter") {
          state.startCenterOnLaunch = !state.startCenterOnLaunch;
        }
        if (key === "ambientGlow") {
          state.ambientGlow = !state.ambientGlow;
          applyStudioAppearance();
        }
        if (key === "reducedMotion") {
          state.reducedMotionPref = !state.reducedMotionPref;
          applyStudioAppearance();
        }
        if (key === "smartType") {
          state.smartTypeEnabled = !state.smartTypeEnabled;
          if (!state.smartTypeEnabled) hideSmartType();
        }
        if (key === "smartQuotes") {
          state.doc.settings.smartQuotes = !state.doc.settings.smartQuotes;
          markDirty();
        }
        if (key === "autoUppercase") {
          state.autoUppercase = !state.autoUppercase;
        }
        if (key === "spellcheck") {
          state.spellcheck = !state.spellcheck;
          applyStudioAppearance();
        }
        if (key === "highlightActive") {
          state.highlightActiveLine = !state.highlightActiveLine;
          applyStudioAppearance();
        }
        if (key === "typewriterScroll") {
          state.typewriterScroll = !state.typewriterScroll;
        }
        const on = Boolean(getSwitchValue(key));
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-checked", String(on));
        syncPrefsUI();
        updateSaveState();
        persistPrefs();
      });
    });
    const themeSelect = $("#settingsTheme", els.dialogBody);
    if (themeSelect) themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
    const accentSelect = $("#settingsAccent", els.dialogBody);
    const setAccent = (choice) => {
      if (!ACCENT_THEMES[choice]) return;
      state.accentColor = choice;
      if (accentSelect) accentSelect.value = choice;
      $$(".accent-swatch", els.dialogBody).forEach((swatch) => {
        swatch.classList.toggle("is-active", swatch.dataset.accentChoice === choice);
      });
      applyStudioAppearance();
      persistPrefs();
    };
    if (accentSelect) accentSelect.addEventListener("change", () => setAccent(accentSelect.value));
    $$(".accent-swatch", els.dialogBody).forEach((swatch) => {
      swatch.addEventListener("click", () => setAccent(swatch.dataset.accentChoice));
    });
    const paperTintSelect = $("#settingsPaperTint", els.dialogBody);
    if (paperTintSelect) {
      paperTintSelect.addEventListener("change", () => {
        state.paperTint = PAPER_TINTS[paperTintSelect.value] ? paperTintSelect.value : "ivory";
        applyStudioAppearance();
        persistPrefs();
      });
    }
    const densitySelect = $("#settingsDensity", els.dialogBody);
    if (densitySelect) {
      densitySelect.addEventListener("change", () => {
        state.uiDensity = densitySelect.value;
        applyStudioAppearance();
        fitPaper();
        persistPrefs();
      });
    }
    const modeSelect = $("#settingsMode", els.dialogBody);
    if (modeSelect) {
      modeSelect.addEventListener("change", () => {
        setMode(modeSelect.value);
      });
    }
    const zoomSelect = $("#settingsZoom", els.dialogBody);
    if (zoomSelect) {
      zoomSelect.addEventListener("change", () => {
        state.zoom = clamp(Number(zoomSelect.value) || 1, 0.6, 1.6);
        applyZoom();
        persistPrefs();
      });
    }
    const fontSelect = $("#settingsFont", els.dialogBody);
    if (fontSelect) {
      fontSelect.addEventListener("change", () => {
        state.font = normalizeScriptFont(fontSelect.value);        applyPageMetrics();
        useWorkspaceTypography();
        syncPrefsUI();
        persistPrefs();
        if (state.mode === "page") renderPagePreview();
      });
    }
    const fontSizeInput = $("#settingsFontSize", els.dialogBody);
    if (fontSizeInput) {
      fontSizeInput.addEventListener("change", () => {
        state.fontSize = clamp(Number(fontSizeInput.value) || 12, 8, 24);
        useWorkspaceTypography();
        fontSizeInput.value = String(state.fontSize);
        state.layoutDirty = true;
        applyPageMetrics();
        syncPrefsUI();
        persistPrefs();
        if (state.mode === "page") renderPagePreview();
      });
    }
    const lineSpacingSelect = $("#settingsLineSpacing", els.dialogBody);
    if (lineSpacingSelect) {
      lineSpacingSelect.addEventListener("change", () => {
        state.lineSpacing = LINE_SPACING_OPTIONS[lineSpacingSelect.value] ? lineSpacingSelect.value : "normal";
        state.layoutDirty = true;
        applyPageMetrics();
        renderStatus();
        persistPrefs();
        if (state.mode === "page") renderPagePreview();
      });
    }
    const pagePresetSelect = $("#settingsPagePreset", els.dialogBody);
    if (pagePresetSelect) {
      pagePresetSelect.addEventListener("change", () => {
        const preset = PAGE_PRESETS[pagePresetSelect.value];
        if (!preset) return;
        state.doc.page = { ...state.doc.page, width: preset.width, height: preset.height };
        state.layoutDirty = true;
        markDirty();
        renderAll();
        fitPaper();
      });
    }
    const sceneSideSelect = $("#settingsSceneNumberSide", els.dialogBody);
    if (sceneSideSelect) {
      sceneSideSelect.addEventListener("change", () => {
        state.doc.settings.sceneNumberSide = ["both", "left", "right"].includes(sceneSideSelect.value)
          ? sceneSideSelect.value
          : "both";
        markDirty();
        renderAll();
      });
    }
    const target = $("#settingsTarget", els.dialogBody);
    if (target) {
      target.addEventListener("change", () => {
        state.doc.settings.targetPages = clamp(Number(target.value) || 120, 1, 999);
        markDirty();
        renderAll();
        persistPrefs();
      });
    }
    const autosaveIntervalSelect = $("#settingsAutosaveInterval", els.dialogBody);
    if (autosaveIntervalSelect) {
      autosaveIntervalSelect.addEventListener("change", () => {
        state.autosaveDelay = clamp(Number(autosaveIntervalSelect.value) || 650, 200, 10000);
        persistPrefs();
      });
    }
    const readRateSelect = $("#settingsReadRate", els.dialogBody);
    if (readRateSelect) {
      readRateSelect.addEventListener("change", () => {
        state.read.rate = Number(readRateSelect.value) || 1;
        syncPrefsUI();
        persistPrefs();
      });
    }
    const reveal = $("#revealData", els.dialogBody);
    if (reveal) {
      reveal.addEventListener("click", () => {
        if (state.appInfo && state.appInfo.userData) desktop.showInFolder(state.appInfo.userData);
      });
    }
  }
  async function loadSample() {
    if (!(await confirmDiscard("Loading the sample will replace the current edits."))) return;
    loadDocument(sampleDocument(), { clearRecovery: true });
    toast("Sample loaded", "The Last Signal is back on the page.", "success");
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
    openDialog({
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
    openDialog({
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
    const stats = getStats(state.doc);
    const pages = pageCount();
    openDialog({
      eyebrow: "Document",
      title: state.doc.title || "Untitled Screenplay",
      body: `
        <div class="stat-grid" style="padding:0;grid-template-columns:1fr 1fr;margin-bottom:14px">
          <div class="stat-card"><strong>${pages}</strong><span>Pages</span></div>
          <div class="stat-card"><strong>${stats.words.toLocaleString()}</strong><span>Words</span></div>
          <div class="stat-card"><strong>${stats.scenes}</strong><span>Scenes</span></div>
          <div class="stat-card"><strong>${stats.characters}</strong><span>Speaking roles</span></div>
        </div>
        <p class="dialog-note">${state.filePath ? `File: ${escapeHtml(state.filePath)}` : isDesktop ? "This draft has not been saved to a file yet." : "Browser mode · autosaved locally"}<br>FDX v6 · ${escapeHtml(scriptFontLabel(state.font))} ${escapeHtml(String(state.fontSize))} pt · ${escapeHtml(String(state.doc.page.width))} × ${escapeHtml(String(state.doc.page.height))} in · ${state.doc.settings.targetPages} page target</p>`,
      actions: [
        { label: "Export PDF", kind: "primary", onClick: exportPDF },
        { label: "Export FDX", onClick: exportFDX },
        { label: "Title page", onClick: openTitlePage },
        { label: "Page setup", onClick: openPageSetup },
        { label: "Close" },
      ],
    });
  }
  function openPageSetup() {
    const page = state.doc.page;
    const presetKey = currentPagePreset(page);
    openDialog({
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
        <div class="setting-line"><div><strong>Scene numbers</strong><span>Print automatic numbers beside scene headings.</span></div><button type="button" class="switch ${state.doc.settings.sceneNumbers ? "is-on" : ""}" id="setupSceneNumbers" role="switch" aria-checked="${state.doc.settings.sceneNumbers}"><span></span></button></div>
        <label class="field" style="margin-top:8px"><span>Scene number placement</span><select id="setupSceneSide"><option value="both"${(state.doc.settings.sceneNumberSide || "both") === "both" ? " selected" : ""}>Both margins (Left &amp; Right)</option><option value="left"${state.doc.settings.sceneNumberSide === "left" ? " selected" : ""}>Left margin only</option><option value="right"${state.doc.settings.sceneNumberSide === "right" ? " selected" : ""}>Right margin only</option></select></label>
        <div class="setting-line"><div><strong>Page numbers in header</strong><span>Show numbered folios in the top-right header of script pages.</span></div><button type="button" class="switch ${state.doc.settings.pageNumbers !== false ? "is-on" : ""}" id="setupPageNumbers" role="switch" aria-checked="${state.doc.settings.pageNumbers !== false}"><span></span></button></div>
        <div class="setting-line"><div><strong>(MORE) / (CONT'D)</strong><span>Continue split dialogue with standard page markers.</span></div><button type="button" class="switch ${state.doc.settings.showMore ? "is-on" : ""}" id="setupMore" role="switch" aria-checked="${state.doc.settings.showMore}"><span></span></button></div>
        <label class="field"><span>Target length (pages)</span><input id="setupTarget" type="number" min="1" max="999" value="${state.doc.settings.targetPages}"></label>
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
            state.doc.page = { ...page, width, height, top, bottom };
            state.doc.settings.sceneNumbers = $("#setupSceneNumbers", els.dialogBody).classList.contains("is-on");
            state.doc.settings.sceneNumberSide = $("#setupSceneSide", els.dialogBody).value || "both";
            state.doc.settings.pageNumbers = $("#setupPageNumbers", els.dialogBody).classList.contains("is-on");
            state.doc.settings.showMore = $("#setupMore", els.dialogBody).classList.contains("is-on");
            state.doc.settings.targetPages = clamp(Number($("#setupTarget", els.dialogBody).value) || 120, 1, 999);
            state.layoutDirty = true;
            markDirty();
            state.history.record();
            renderAll();
            syncPrefsUI();
            fitPaper();
            if (state.mode === "page") renderPagePreview();
            toast("Page updated", `${width} × ${height} in · ${top} in top / ${bottom} in bottom.`, "success");
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
  /* ------------------------------------------------------------------ */
  /* tooltip portal                                                      */
  /* ------------------------------------------------------------------ */
  /* Tooltips are delegated from a single fixed-position layer rather than
   * drawn with ::after on each trigger. A pseudo-element is confined to its
   * trigger's overflow context, so every tooltip inside the ribbon deck, the
   * navigator or the inspector was clipped by that container's `overflow:
   * hidden` — the ribbon cut the text in half. A portal cannot be clipped.
   *
   * Placement prefers below the trigger and flips above when there is no room,
   * then clamps horizontally so a tooltip near a window edge stays on screen. */
  const TOOLTIP_OFFSET = 8;
  const TOOLTIP_EDGE = 8;
  function ensureTooltipLayer() {
    let layer = document.getElementById("tooltipLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "tooltipLayer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    return layer;
  }
  function hideTooltip() {
    clearTimeout(state.tooltipTimer);
    state.tooltipTimer = null;
    if (state.tooltipEl) {
      state.tooltipEl.classList.remove("is-visible");
    }
    state.tooltipTrigger = null;
  }
  function placeTooltip(trigger, text) {
    const layer = ensureTooltipLayer();
    let tip = state.tooltipEl;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "app-tooltip";
      tip.setAttribute("role", "tooltip");
      layer.appendChild(tip);
      state.tooltipEl = tip;
    }
    tip.textContent = text;
    tip.classList.remove("is-visible");
    /* Measure after content is set but before positioning, so a long label can
     * wrap (up to max-width) and still be placed correctly. */
    const rect = trigger.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const side = spaceBelow < th + TOOLTIP_OFFSET + TOOLTIP_EDGE && rect.top > th + TOOLTIP_OFFSET
      ? "above"
      : "below";
    tip.dataset.side = side;
    let top = side === "above" ? rect.top - th - TOOLTIP_OFFSET : rect.bottom + TOOLTIP_OFFSET;
    top = Math.max(TOOLTIP_EDGE, Math.min(top, window.innerHeight - th - TOOLTIP_EDGE));
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(TOOLTIP_EDGE, Math.min(left, window.innerWidth - tw - TOOLTIP_EDGE));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    state.tooltipTrigger = trigger;
    /* Force a reflow so the transition runs from the hidden state. */
    void tip.offsetWidth;
    tip.classList.add("is-visible");
  }
  function initTooltips() {
    /* A tooltip must never outlive its trigger's visibility. */
    const hideIfStale = () => {
      if (state.tooltipTrigger && !state.tooltipTrigger.isConnected) hideTooltip();
    };
    document.addEventListener("pointerover", (event) => {
      const trigger = event.target.closest ? event.target.closest("[data-tooltip]") : null;
      if (!trigger) return;
      const text = trigger.getAttribute("data-tooltip");
      if (!text || trigger === state.tooltipTrigger) return;
      clearTimeout(state.tooltipTimer);
      /* Small delay so sweeping across a toolbar does not flash tooltips. */
      state.tooltipTimer = setTimeout(() => {
        hideIfStale();
        if (!trigger.isConnected) return;
        placeTooltip(trigger, text);
      }, 320);
    });
    document.addEventListener("pointerout", (event) => {
      const trigger = state.tooltipTrigger;
      if (!trigger) return;
      if (trigger.contains(event.target) && !trigger.contains(event.relatedTarget)) {
        hideTooltip();
      }
    });
    /* Any interaction or navigation dismisses the tooltip immediately. */
    document.addEventListener("pointerdown", hideTooltip, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTooltip();
    }, true);
    document.addEventListener("focusin", (event) => {
      const trigger = event.target.closest ? event.target.closest("[data-tooltip]") : null;
      if (!trigger) hideTooltip();
    });
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("blur", hideTooltip);
    window.addEventListener("resize", hideTooltip);
  }
  /* ------------------------------------------------------------------ */
  /* start center                                                        */
  /* ------------------------------------------------------------------ */
  function showStartCenter() {
    if (!isDesktop) {
      toast("Start Center", "The desktop build adds recent files, recovery, and native dialogs.", "info", 3200);
      return;
    }
    if (state.startCenterOpen) {
      els.startCenter.focus();
      return;
    }
    state.suppressStartCenter = false;
    /* Open synchronously. This used to be an async function that awaited
     * refreshStartCenter() before calling showModal(), so for the first frames
     * of the session the panel did not exist yet and the very first click on
     * the close button hit the workspace behind it. Nothing in the panel needs
     * the refreshed copy before it is visible. */
    els.startCenter.classList.remove("is-closing");
    els.startCenter.showModal();
    state.startCenterOpen = true;
    els.startCenter.classList.add("is-open");
    requestAnimationFrame(() => {
      els.startCenter.classList.add("is-ready");
    });
    refreshStartCenter().catch(() => {});
  }
  function hideStartCenter() {
    if (!els.startCenter.open) {
      /* Already closed, but a stale flag or class could still be set; clear it. */
      els.startCenter.classList.remove("is-open", "is-ready", "is-closing");
      state.startCenterOpen = false;
      return;
    }
    /* Cancel any close already in flight so repeated clicks stay idempotent,
     * then run one clean close. Clearing the latch first matters: a close whose
     * animation was interrupted used to leave `is-closing` on the element, and
     * every later attempt returned early, stranding the user on a page they
     * could not leave. */
    clearTimeout(state.startCenterCloseTimer);
    els.startCenter.classList.remove("is-closing");
    closeModalAnimated(els.startCenter, () => {
      els.startCenter.classList.remove("is-open", "is-ready");
      state.startCenterOpen = false;
    });
    scheduleStartCenterRecovery();
  }
  /* Last-resort recovery for the panel. If the dialog is still open shortly
   * after a close attempt but its panel is invisible (opacity ~0), the close
   * animation was interrupted and the result is an invisible modal that blocks
   * the whole window. Force it shut instead. Runs on every close path, and also
   * on show/state changes, so no single missed animation can lock the app. */
  function scheduleStartCenterRecovery() {
    clearTimeout(state.startCenterCloseTimer);
    state.startCenterCloseTimer = setTimeout(() => {
      if (!els.startCenter.open) return;
      if (els.startCenter.classList.contains("is-closing")) {
        /* Still animating out: give it one more beat before forcing. */
        scheduleStartCenterRecovery();
        return;
      }
      const panel = els.startCenter.querySelector(".start-center");
      const opacity = panel ? Number(getComputedStyle(panel).opacity) : 0;
      if (!panel || opacity < 0.05) {
        try {
          els.startCenter.close();
        } catch (_) {}
        els.startCenter.classList.remove("is-open", "is-ready", "is-closing");
        state.startCenterOpen = false;
      }
    }, 450);
  }
  async function refreshStartCenter() {
    const stats = getStats(state.doc);
    const pages = pageCount();
    const startDraftName = $("#startDraftName");
    if (startDraftName) startDraftName.textContent = state.doc.title || "Untitled";
    const startPages = $("#startDraftPages");
    if (startPages) startPages.textContent = String(pages);
    const startWords = $("#startDraftWords");
    if (startWords) startWords.textContent = stats.words.toLocaleString();
    els.startOnLaunch.checked = state.startCenterOnLaunch;
    if (state.recovery) {
      els.recoveryBanner.hidden = false;
      const age = state.recovery.ageMs
        ? state.recovery.ageMs < 60000
          ? "less than a minute ago"
          : `${Math.round(state.recovery.ageMs / 60000)} min ago`
        : "recently";
      els.recoveryCopy.textContent = `${state.recovery.title || "Untitled draft"} · recovered ${age}`;
    } else {
      els.recoveryBanner.hidden = true;
    }
    const startVersion = $("#startVersion");
    if (startVersion) {
      startVersion.textContent = state.appInfo
        ? `Azkript ${state.appInfo.version}`
        : "Azkript";
    }
    if (!isDesktop) {
      els.recentList.innerHTML = `<div class="recent-empty">${icon("folder")}<span>Open an FDX file to begin. Browser mode does not keep a recent-file list.</span></div>`;
      return;
    }
    state.recent = await desktop.recent().catch(() => []);
    if (!state.recent.length) {
      els.recentList.innerHTML = `<div class="recent-empty">${icon("file")}<span>No recent screenplays yet. Open an FDX or start from a template.</span></div>`;
      return;
    }
    els.recentList.innerHTML = state.recent
      .map(
        (item, index) => `
        <button class="recent-item" type="button" data-recent-index="${index}" style="--i:${index}">
          <span class="recent-item__icon">${icon("file")}</span>
          <span class="recent-item__copy"><strong>${escapeHtml(item.title || item.name)}</strong><span>${escapeHtml(item.path)}</span></span>
          <span class="recent-item__date">${escapeHtml(formatDate(item.openedAt))}</span>
          <svg><use href="#i-chevron-right"></use></svg>
        </button>`,
      )
      .join("");
    $$(".recent-item", els.recentList).forEach((button) => {
      button.addEventListener("click", () => openRecent(Number(button.dataset.recentIndex)));
    });
  }
  async function openRecent(index) {
    const item = state.recent[index];
    if (!item) return;
    if (!(await confirmDiscard("Opening a recent screenplay will replace the current edits."))) return;
    try {
      const file = await desktop.readFile(item.path);
      hideStartCenter();
      await handleFilePayload(file);
    } catch (error) {
      toast("Could not open recent file", error.message || item.path, "error");
    }
  }
  async function restoreRecovery() {
    const recovery = state.recovery || (await desktop.readRecovery().catch(() => null));
    if (!recovery || !recovery.document) {
      toast("Recovery unavailable", "The recovery copy could not be read.", "warning");
      return;
    }
    state.suppressStartCenter = true;
    loadDocument(recovery.document, { path: recovery.filePath || null, identity: recovery.identity || null,
      name: recovery.filePath ? recovery.filePath.split(/[\\/]/).pop() : null, dirty: true });
    state.recovery = null;
    state.recoveryWrittenAt = Date.now();
    renderAll();
    updateHistoryButtons();
    hideStartCenter();
    setView("script");
    setMode("write");
    toast("Draft recovered", "The unsaved copy is open. Save it to a file when you are ready.", "success");
  }
  async function discardRecovery() {
    state.recovery = null;
    if (els.recoveryBanner) {
      els.recoveryBanner.classList.add("is-closing");
      setTimeout(() => {
        els.recoveryBanner.hidden = true;
        els.recoveryBanner.classList.remove("is-closing");
      }, 180);
    }
    await desktop.clearRecovery().catch(() => {});
    toast("Recovery discarded", "The unsaved recovery copy was removed.", "info", 2200);
  }
  /* ------------------------------------------------------------------ */
  /* keyboard                                                            */
  /* ------------------------------------------------------------------ */
  function isTypingTarget(target) {
    return (
      target &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    );
  }
  /* The screenplay surface is also contentEditable, but it is the document
   * itself: app-level shortcuts must keep working there. Only real form fields
   * (inputs, textareas, selects, and rich-text fields other than #editor) own
   * their editing shortcuts. */
  function isFormFieldTarget(target) {
    if (!target) return false;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
    if (!target.isContentEditable) return false;
    if (els.editor && (target === els.editor || els.editor.contains(target))) return false;
    return true;
  }
  function onGlobalKeyDown(event) {
    if (event.isComposing || state.composing || event.keyCode === 229) return;
    const meta = event.ctrlKey || event.metaKey;
    if (els.startCenter.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        hideStartCenter();
      }
      return;
    }
    if (els.findDialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFind();
      }
      return;
    }
    if (els.commandDialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandDialog();
      }
      return;
    }
    if (els.dialog.open) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
      return;
    }
    /* A focused form field owns its own editing shortcuts: undo, redo, find and
     * the like must act on the field, not on the screenplay. Save and the
     * command palette stay global because they have no field-local meaning. */
    if (
      isFormFieldTarget(event.target) &&
      !(meta && ["s", "k"].includes(event.key.toLowerCase()))
    ) {
      return;
    }
    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDocument({ saveAs: true });
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDocument();
      return;
    }
    if (meta && event.key.toLowerCase() === "o") {
      event.preventDefault();
      openFilePicker();
      return;
    }
    // Require the exact chord: without !shiftKey this also captured
    // Ctrl+Shift+N and shadowed the ScriptNote shortcut bound further down.
    if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      newDocument();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportPDF();
      return;
    }
    /* Ctrl+P prints. This must require that Alt is NOT held: without the
     * !altKey check it also swallowed Ctrl+Alt+P (Page View) and printed
     * instead, opening a native print dialog that blocked the renderer. */
    if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      printDocument();
      return;
    }
    if (meta && event.key.toLowerCase() === "h") {
      event.preventDefault();
      openFind("replace");
      return;
    }
    if (meta && event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFocus();
      return;
    }
    if (meta && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFind("find");
      return;
    }
    if (meta && !event.shiftKey && event.key.toLowerCase() === "g") {
      event.preventDefault();
      openGoToDialog();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      openReadDock(true);
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      toggleRevisionMode();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      startNextRevision();
      return;
    }
    if (meta && event.altKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      setView("script");
      setMode("page");
      return;
    }
    if (meta && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveScene(event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (!meta && event.altKey && !event.shiftKey && /^[0-9ESOL]$/.test(event.key.toUpperCase())) {
      /* The guard used to be /^[0-7]$/, which silently killed six of the fourteen       * element shortcuts: Act break (8), End of Act (9), General (E), Summary       * (S), Outline 1 (O) and Outline 2 (L). Those letters were advertised in the       * element combo and the reports, so the advert was a lie. The key set is       * derived from ELEMENTS rather than hard-coded so it cannot drift again. */
      const entry = Object.entries(ELEMENTS).find(        ([, spec]) => String(spec.shortcut).toUpperCase() === event.key.toUpperCase(),      );
      if (entry) {
        event.preventDefault();
        changeElementType(entry[0]);
        return;
      }
    }
    if (meta && event.key === "Enter") {
      event.preventDefault();
      insertScene();
      return;
    }
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      openSceneDetails();
      return;
    }
    if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      toggleDualDialogue();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openScriptNote();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      formatSelection("strikeThrough");
      return;
    }
    if (event.key === "F7") {
      event.preventDefault();
      if (event.shiftKey) openThesaurus();
      else openSpellcheckDialog();
      return;
    }
    if (meta && event.key === "1") {
      event.preventDefault();
      setView("script");
      return;
    }
    if (meta && event.key === "2") {
      event.preventDefault();
      setView("navigator");
      return;
    }
    if (meta && event.key === "3") {
      event.preventDefault();
      setView("characters");
      return;
    }
    if (meta && event.key === "4") {
      event.preventDefault();
      setView("reports");
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      openHelp();
      return;
    }
    if (event.key === "Escape" && document.body.classList.contains("focus-mode")) {
      event.preventDefault();
      toggleFocus();
      return;
    }
    if (isTypingTarget(event.target) && meta && ["b", "i", "u"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      formatSelection(
        event.key.toLowerCase() === "b"
          ? "bold"
          : event.key.toLowerCase() === "i"
            ? "italic"
            : "underline",
      );
      return;
    }
    if (event.key === "?" && !isTypingTarget(event.target)) {
      event.preventDefault();
      openHelp();
    }
  }
  /* ------------------------------------------------------------------ */
  /* event wiring                                                        */
  /* ------------------------------------------------------------------ */
  function on(id, eventName, handler, options) {
    const element = document.getElementById(id);
    if (element) element.addEventListener(eventName, handler, options);
  }
  function bindEvents() {
    bindRibbonEvents();
    initTooltips();
    els.editor.addEventListener("input", onEditorInput);
    els.editor.addEventListener("beforeinput", onEditorBeforeInput);
    els.editor.addEventListener("compositionstart", () => {
      state.history.finishBurst();
      state.history.selectionCurrent = FDCoreWriting.captureSelection(els.editor);
      state.composing = true; hideSmartType();
    });
    els.editor.addEventListener("compositionend", event => {
      state.composing = false;
      onEditorInput({ target: event.target, isComposing: false });
    });
    els.editor.addEventListener("focusin", onEditorFocusIn);
    els.editor.addEventListener("keydown", onEditorKeyDown);
    els.editor.addEventListener("paste", onPaste);
    els.editor.addEventListener("click", (event) => {
      const altBadge = event.target.closest ? event.target.closest(".alt-badge") : null;
      if (altBadge) {
        event.preventDefault();
        event.stopPropagation();
        const paraEl = altBadge.closest(".para");
        if (paraEl && paraEl.dataset.id) {
          cycleParagraphAlt(paraEl.dataset.id);
        }
      }
    });
    els.editor.addEventListener("focusout", (event) => {
      const el = event.target && event.target.closest ? event.target.closest(".para") : null;
      if (el && !state.composing && maybeAutoUppercase(el)) {
        markDirty();
        state.history.schedule();
        scheduleChrome();
      }
      setTimeout(() => {
        if (!els.smartType || !state.smart.visible) return;
        if (document.activeElement && document.activeElement.closest(".smart-type")) return;
        hideSmartType();
      }, 120);
    });
    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("selectionchange", () => {
      const el = activeParagraphElement();
      if (el && el.dataset.id !== state.selectedId) setActiveParagraph(el.dataset.id);
      syncFormatButtons();
    });
    $$(".format-btn").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => formatSelection(button.dataset.format));
    });
    // Wrapped so the click event is not passed as newDocument's `kind` argument;
    // an event object is truthy and silently produced the feature template.
    on("newButton", "click", () => newDocument());
    on("openButton", "click", openFilePicker);
    on("saveButton", "click", () => saveDocument());
    on("exportButton", "click", exportFDX);
    on("undoButton", "click", undo);
    on("redoButton", "click", redo);
    on("themeToggle", "click", toggleTheme);
    on("focusToggle", "click", toggleFocus);
    on("settingsButton", "click", openSettings);
    on("helpButton", "click", openHelp);
    on("statusHelp", "click", openHelp);
    on("commandButton", "click", openCommandPalette);
    on("elementSettingsButton", "click", openElementSettings);
    on("caseButton", "click", cycleCase);
    on("dualDialogueButton", "click", toggleDualDialogue);
    on("scriptNoteButton", "click", openScriptNote);
    on("thesaurusButton", "click", openThesaurus);
    on("outlineToggleButton", "click", () => toggleOutlineLayer());
    on("rulerToggleButton", "click", () => toggleRulerLayer());
    on("splitViewButton", "click", () => toggleSplitView());
    on("splitOrientationBtn", "click", () =>
      toggleSplitView(true, state.splitView.orientation === "vertical" ? "horizontal" : "vertical"),
    );
    on("splitSwapBtn", "click", swapSplitPanes);
    on("splitCloseBtn", "click", () => toggleSplitView(false));
    $$(".split-pane__tab", els.splitPane).forEach((tab) => {
      tab.addEventListener("click", () => {
        state.splitView.mode = tab.dataset.splitMode;
        renderSplitPane();
      });
    });
    on("documentPill", "click", openDocumentDetails);
    on("pageSetupButton", "click", openPageSetup);
    on("titlePageButton", "click", openTitlePage);
    on("titlePageInspectorButton", "click", openTitlePage);
    on("exportPdfButton", "click", exportPDF);
    on("inspectorToggle", "click", () => toggleInspector());
    on("inspectorClose", "click", () => toggleInspector(false));
    on("addSceneButton", "click", insertScene);
    on("refreshReport", "click", () => {
      renderReports();
      toast("Report refreshed", "Scene and dialogue analytics are up to date.", "success", 2200);
    });
    on("copyReport", "click", copyReport);
    on("validateButton", "click", validateDocumentAction);
    on("copyOutlineButton", "click", copyOutline);
    on("tableReadButton", "click", () => openReadDock(true));
    on("zoomIn", "click", () => setZoom(0.1));
    on("zoomOut", "click", () => setZoom(-0.1));
    on("brandButton", "click", showStartCenter);
    on("railToggle", "click", toggleRail);
    on("findButton", "click", () => openFind("find"));
    on("readToggle", "click", () => (state.read.active ? closeReadDock() : openReadDock(false)));
    on("readRailButton", "click", () => (state.read.active ? closeReadDock() : openReadDock(false)));
    on("revisionButton", "click", openRevisionManager);
    on("revisionInspectorButton", "click", openRevisionManager);
    on("sceneDetailsButton", "click", openSceneDetails);
    on("pagePrev", "click", () => goToPage(state.pageIndex - 1));
    on("pageNext", "click", () => goToPage(state.pageIndex + 1));
    on("cardHelpButton", "click", () => {
      openDialog({
        eyebrow: "Index cards",
        title: "A board that behaves like a script",
        body: `
          <div class="shortcut-grid" style="grid-template-columns:1fr">
            <div class="shortcut-row"><span>Drag any card</span><span><kbd>drop</kbd></span></div>
            <div class="shortcut-row"><span>Edit synopsis, color, notes</span><span>${icon("pencil")}</span></div>
            <div class="shortcut-row"><span>Omit a scene from the page view</span><span>${icon("eye-off")}</span></div>
            <div class="shortcut-row"><span>Jump back into the screenplay</span><span>click card</span></div>
          </div>
          <div class="dialog-note">Omitted scenes stay in the editor and are skipped by pagination, PDF, print, and FDX page geometry.</div>`,
        actions: [{ label: "Got it", kind: "primary" }],
      });
    });
    $$("#viewSegmented .segmented__item").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });
    $$(".rail__item[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    $$(".inspector-tab").forEach((button) => {
      button.addEventListener("click", () => setInspectorTab(button.dataset.tab));
    });
    els.sceneSearch.addEventListener("input", () => {
      state.sceneQuery = els.sceneSearch.value;
      renderScenes();
    });
    els.navigatorSearch.addEventListener("input", () => {
      state.navigatorQuery = els.navigatorSearch.value;
      renderNavigator();
    });
    els.paperScroll.addEventListener(
      "scroll",
      () => {
        /* A user-initiated scroll cancels any navigation lock still pending, so the
         * highlight follows the pointer immediately rather than waiting out the settle
         * window. Distinguished by whether we have already arrived at the target: once
         * the smooth scroll is at (or within 2px of) its destination it is over, and any
         * further scroll from there is the user's. */
        if (state.navigationInFlight && state.navigationTarget != null &&
            Math.abs(els.paperScroll.scrollTop - state.navigationTarget) > 2) {
          // still travelling to the target: keep the lock
        } else {
          state.navigationInFlight = false;
          state.navigationTarget = null;
          state.navigatedSceneId = null;
        }
        updateActiveSceneFromScroll();
      },
      { passive: true },
    );
    els.pagePreview.addEventListener("scroll", updatePageFromScroll, { passive: true });
    els.fileInput.addEventListener("change", onFileChosen);
    on("titleInput", "input", () => {
      const previous = state.doc.title;
      state.doc.title = els.titleInput.value || "Untitled Screenplay";
      if (state.doc.titlePage.title === previous || !state.doc.titlePage.title) {
        state.doc.titlePage.title = state.doc.title;
      }
      els.docTitle.textContent = state.doc.title;
      els.scriptTitle.textContent = state.doc.title;
      els.paperTitle.textContent = state.doc.title.toUpperCase();
      document.title = `${state.doc.title} — Azkript`;
      markDirty();
      renderMeta();
      state.history.schedule();
      updateWindowStateSoon();
      if (state.mode === "page") renderPagePreview();
    });
    on("authorInput", "input", () => {
      state.doc.author = els.authorInput.value;
      if (!state.doc.titlePage.author) state.doc.titlePage.author = state.doc.author;
      markDirty();
      state.history.schedule();
    });
    on("targetPagesInput", "change", () => {
      state.doc.settings.targetPages = clamp(Number(els.targetPagesInput.value) || 120, 1, 999);
      markDirty();
      state.history.record();
      renderAll();
    });
    ["pageWidth", "pageHeight", "pageTop", "pageBottom"].forEach((id) => {
      const input = document.getElementById(id);
      input.addEventListener("change", () => {
        const page = state.doc.page;
        state.doc.page = {
          ...page,
          width: clamp(Number(els.pageWidth.value) || page.width, 5, 14),
          height: clamp(Number(els.pageHeight.value) || page.height, 7, 20),
          top: clamp(Number(els.pageTop.value) || page.top, 0.5, 2.5),
          bottom: clamp(Number(els.pageBottom.value) || page.bottom, 0.5, 2.5),
        };
        markDirty();
        state.history.record();
        renderAll();
        fitPaper();
        if (state.mode === "page") renderPagePreview();
      });
    });
    $$(".theme-swatch").forEach((button) => {
      button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
    });
    on("invisiblesToggle", "click", () => {
      state.showInvisibles = !state.showInvisibles;
      els.paper.classList.toggle("has-invisibles", state.showInvisibles);
      $("#invisiblesToggle").classList.toggle("is-on", state.showInvisibles);
      $("#invisiblesToggle").setAttribute("aria-checked", String(state.showInvisibles));
      persistPrefs();
    });
    on("guidesToggle", "click", () => {
      state.showGuides = !state.showGuides;
      els.paper.classList.toggle("has-guides", state.showGuides);
      $("#guidesToggle").classList.toggle("is-on", state.showGuides);
      $("#guidesToggle").setAttribute("aria-checked", String(state.showGuides));
      persistPrefs();
    });
    on("sceneNumbersToggle", "click", () => {
      state.doc.settings.sceneNumbers = !state.doc.settings.sceneNumbers;
      els.sceneNumbersToggle.classList.toggle("is-on", state.doc.settings.sceneNumbers);
      els.sceneNumbersToggle.setAttribute("aria-checked", String(state.doc.settings.sceneNumbers));
      markDirty();
      renderAll();
    });
    on("fontSelect", "change", () => {
      state.font = normalizeScriptFont($("#fontSelect").value);      applyPageMetrics();
      useWorkspaceTypography();
      persistPrefs();
      if (state.mode === "page") renderPagePreview();
    });
    on("fontSize", "change", () => {
      state.fontSize = clamp(Number($("#fontSize").value) || 12, 8, 24);
      useWorkspaceTypography();
      applyPageMetrics();
      state.layoutDirty = true;
      persistPrefs();
      if (state.mode === "page") renderPagePreview();
    });
    on("sceneNumberInput", "input", () => updateActiveScene({ number: els.sceneNumberInput.value.trim() }));
    on("sceneTitleInput", "input", () => {
      const input = $("#sceneTitleInput");
      if (input) updateActiveScene({ title: input.value });
    });
    on("sceneSynopsis", "input", () => updateActiveScene({ synopsis: els.sceneSynopsis.value }));
    on("sceneNotes", "input", () => updateActiveScene({ notes: els.sceneNotes.value }));
    on("sceneOmitToggle", "click", () => {
      const on = !els.sceneOmitToggle.classList.contains("is-on");
      els.sceneOmitToggle.classList.toggle("is-on", on);
      els.sceneOmitToggle.setAttribute("aria-checked", String(on));
      updateActiveScene({ omit: on });
    });
    on("sceneColorRow", "click", (event) => {
      const button = event.target.closest(".scene-color");
      if (!button) return;
      $$(".scene-color", els.sceneColorRow).forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      updateActiveScene({ color: button.dataset.color });
      els.sceneInspectorDot.style.background = button.dataset.color || "var(--brand)";
    });
    on("revisionMini", "click", (event) => {
      if (event.target.closest("[data-revision-toggle]")) toggleRevisionMode();
    });
    /* Ribbon actions & Azkript extended workspace controls */
    $$("[data-ribbon-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleRibbonAction(btn.dataset.ribbonAction));
    });
    $$(".navigator-tab").forEach((tab) => {
      tab.addEventListener("click", () => setNavigatorTab(tab.dataset.navTab));
    });
    $$("#sceneViewColumnsToggle [data-sv-col]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = btn.dataset.svCol;
        state.sceneViewCols[col] = !state.sceneViewCols[col];
        btn.classList.toggle("is-active", state.sceneViewCols[col]);
        renderSceneView();
      });
    });
    on("sceneViewAddBtn", "click", insertScene);
    $$("#cardModeSegmented [data-card-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.cardMode = btn.dataset.cardMode;
        renderNavigator();
      });
    });
    on("cardsAcrossSelect", "change", () => {
      const sel = $("#cardsAcrossSelect");
      if (sel) {
        /* "Auto" is value 0 and means "use the responsive auto-fill layout"
         * (renderNavigator removes the inline grid-template-columns for it).
         * `Number(v) || 3` mapped 0 to 3, so Auto behaved exactly like the
         * fixed-3 choice and the responsive layout was unreachable. */
        const value = Number(sel.value);
        state.cardsAcross = Number.isFinite(value) && value >= 1 ? clamp(value, 1, 9) : 0;
        renderNavigator();
      }
    });
    on("sendCardsToScriptBtn", "click", sendCardsToScript);
    on("addBeatBtn", "click", () => addBeat("beat"));
    on("beatBoardStage", "dblclick", (event) => {
      if (event.target.closest('.beat-card, button, input, select, textarea')) return;
      const canvas = $('#beatBoardCanvas'), rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / canvas.offsetWidth || 1, scaleY = rect.height / canvas.offsetHeight || 1;
      let x = Math.max(16, (event.clientX - rect.left) / scaleX), y = Math.max(16, (event.clientY - rect.top) / scaleY);
      if (state.beatSnap) { x = Math.round(x / 24) * 24; y = Math.round(y / 24) * 24; }
      addBeat('beat', x, y);
    });
    on("addStructureBeatBtn", "click", () => addBeat("structure"));
    on("beatAlignSelect", "change", (event) => {
      const val = event.target.value;
      if (val) {
        alignBeats(val);
        event.target.value = "";
      }
    });
    on("beatSnapToggle", "click", toggleBeatSnap);
    on("beatSendToScriptBtn", "click", () => sendBeatToScript(null));
    on("charHighlightBtn", "click", openHighlightCharactersDialog);
    on("charRenameBtn", "click", openRenameCharacterDialog);
    on("charNonSpeakingBtn", "click", openNonSpeakingDialog);
    on("charAssignVoicesBtn", "click", openAssignVoicesDialog);
    $$("#reportTypeTabs [data-report-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.reportType = btn.dataset.reportType;
        renderReports();
      });
    });
    on("namesDbQuickBtn", "click", openNamesDatabaseDialog);
    on("writingStatsQuickBtn", "click", openWritingStatsDialog);
    on("askFdQuickBtn", "click", openAskFdDialog);
    on("sprintQuickButton", "click", () => toggleSprintWidget());
    on("sprintCloseBtn", "click", () => toggleSprintWidget(false));
    on("sprintToggleBtn", "click", startOrPauseSprint);
    on("sprintResetBtn", "click", resetSprint);
    on("sprintDurationSelect", "change", resetSprint);
    on("commandInput", "input", () => {
      state.commandIndex = 0;
      renderCommandList($("#commandInput").value);
    });
    on("commandInput", "keydown", onCommandKeyDown);
    els.commandDialog.addEventListener("click", (event) => {
      if (event.target === els.commandDialog) closeCommandDialog();
    });
    els.commandDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeCommandDialog();
    });
    els.dialog.addEventListener("click", (event) => {
      if (event.target === els.dialog) closeDialog();
    });
    els.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    const dialogCloseBtn = els.dialog.querySelector(".dialog-head button");
    if (dialogCloseBtn) {
      dialogCloseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        closeDialog();
      });
    }
    bindFindEvents();
    bindReadEvents();
    bindStartCenterEvents();
    on("startCenterClose", "click", hideStartCenter);
    on("startContinue", "click", hideStartCenter);
    on("startOpen", "click", async () => {
      hideStartCenter();
      await openFilePicker();
    });
    on("startOnLaunch", "change", () => {
      state.startCenterOnLaunch = els.startOnLaunch.checked;
      persistPrefs();
    });
    on("recentClear", "click", async () => {
      if (!isDesktop) return;
      await desktop.clearRecent().catch(() => {});
      state.recent = [];
      refreshStartCenter();
    });
    on("recoveryRestore", "click", restoreRecovery);
    on("recoveryDiscard", "click", discardRecovery);
    on("startTitlePage", "click", () => {
      hideStartCenter();
      openTitlePage();
    });
    on("startTableRead", "click", () => {
      hideStartCenter();
      openReadDock(false);
    });
    on("startRevision", "click", () => {
      hideStartCenter();
      openRevisionManager();
    });
    $$(".template-card").forEach((button) => {
      button.addEventListener("click", async () => {
        hideStartCenter();
        await newDocument(button.dataset.template, true);
      });
    });
    on("readPlay", "click", pauseOrResume);
    on("readPrev", "click", () => {
      stopRead();
      advanceRead(-1);
    });
    on("readNext", "click", () => {
      stopRead();
      advanceRead(1);
    });
    on("readStop", "click", stopRead);
    on("readClose", "click", closeReadDock);
    on("readVoice", "change", () => {
      state.read.voiceURI = els.readVoice.value;
      persistPrefs();
      if (state.read.active) {
        stopRead();
        speakCurrent();
      }
    });
    on("readRate", "change", () => {
      state.read.rate = Number(els.readRate.value) || 1;
      persistPrefs();
      if (state.read.active && state.read.playing) {
        stopRead();
        speakCurrent();
      }
    });
    on("findClose", "click", closeFind);
    on("findInput", "input", () => {
      state.find.query = els.findInput.value;
      state.find.index = 0;
      runFind();
    });
    on("replaceInput", "input", () => {
      state.find.replacement = els.replaceInput.value;
    });
    on("findInput", "keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          selectFindMatch(state.find.index - 1);
        } else {
          selectFindMatch(state.find.index + 1);
        }
      }
    });
    on("findNext", "click", () => selectFindMatch(state.find.index + 1));
    on("findPrev", "click", () => selectFindMatch(state.find.index - 1));
    on("findReplaceOne", "click", replaceCurrent);
    on("findReplaceAll", "click", replaceAll);
    $$(".find-option").forEach((button) => {
      button.addEventListener("click", () => {
        const option = button.dataset.findOption;
        if (option === "case") state.find.caseSensitive = !state.find.caseSensitive;
        if (option === "word") state.find.wholeWord = !state.find.wholeWord;
        if (option === "regex") state.find.regex = !state.find.regex;
        button.classList.toggle("is-active", state.find[option === "case" ? "caseSensitive" : option === "word" ? "wholeWord" : "regex"]);
        state.find.index = 0;
        runFind();
      });
    });
    els.findDialog.addEventListener("click", (event) => {
      if (event.target === els.findDialog) closeFind();
    });
    els.findDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFind();
    });
    els.findDialog.addEventListener("close", () => {
      state.find.open = false;
      clearFindHighlights();
    });
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        populateReadVoices();
        if (state.read.active) rebuildReadItems();
      });
    }
    window.addEventListener("resize", () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        applyInterfaceScale();
        fitPaper();
        if (state.mode === "page") renderPagePreview();
        const activeRail = $(".rail__item[data-view].is-active");
        if (activeRail && els.railIndicator) {
          els.railIndicator.style.transform = `translateX(${activeRail.offsetLeft}px)`;
          els.railIndicator.style.width = `${activeRail.offsetWidth}px`;
        }
      }, 120);
    });
    const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
    systemQuery.addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system", false);
    });
    motionQuery.addEventListener("change", () => {
      if (prefersReducedMotion()) themeTransition?.skipTransition();
    });
    els.startCenter.addEventListener("click", (event) => {
      if (event.target === els.startCenter) hideStartCenter();
    });
    els.startCenter.addEventListener("cancel", (event) => {
      event.preventDefault();
      hideStartCenter();
    });
    els.startCenter.addEventListener("close", () => {
      state.startCenterOpen = false;
      els.startCenter.classList.remove("is-open", "is-ready");
    });
    window.addEventListener("dragover", (event) => {
      if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      document.body.classList.add("is-file-drag");
    });
    window.addEventListener("dragleave", (event) => {
      if (event.relatedTarget) return;
      document.body.classList.remove("is-file-drag");
    });
    window.addEventListener("drop", async (event) => {
      if (!event.dataTransfer || !event.dataTransfer.files.length) return;
      event.preventDefault();
      document.body.classList.remove("is-file-drag");
      const file = event.dataTransfer.files[0];
      if (!/\.(fdx|fdxt|xml)$/i.test(file.name)) {
        toast("Unsupported file", "Drop an FDX or FDXT screenplay.", "warning");
        return;
      }
      if (!(await confirmDiscard("Opening this file will replace the current edits."))) return;
      try {
        if (isDesktop) {
          const filePath = desktop.pathForFile(file);
          if (filePath) {
            const payload = await desktop.readFile(filePath);
            hideStartCenter();
            await handleFilePayload(payload);
            return;
          }
        }
        const text = await file.text();
        hideStartCenter();
        await handleFilePayload({ contents: text, name: file.name });
      } catch (error) {
        toast("Open failed", error.message || "Could not read the dropped file.", "error");
      }
    });
    window.addEventListener("beforeunload", () => {
      if (state.dirty) persistWorkspace();
      else if (isDesktop) desktop.clearRecovery().catch(() => {});
      syncDesktopState(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && state.dirty) persistWorkspace();
    });
    document.addEventListener("pointerdown", (event) => {
      if (prefersReducedMotion()) return;
      const target = event.target.closest(".template-card, .recent-item");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      ripple.style.setProperty("--ripple-size", `${Math.max(rect.width, rect.height) * 1.5}px`);
      target.appendChild(ripple);
      setTimeout(() => ripple.remove(), 620);
    });
  }
  function bindFindEvents() {
    /* The find controls are bound above; this hook exists so the desktop
       command path can share the same initialization without duplication. */
  }
  function bindReadEvents() {
    /* See bindEvents; kept as a named group for readability. */
  }
  function bindStartCenterEvents() {
    /* See bindEvents; kept as a named group for readability. */
  }
  function updateWindowStateSoon() {
    syncDesktopState();
  }
  /* ------------------------------------------------------------------ */
  /* start                                                               */
  /* ------------------------------------------------------------------ */
  loadInitial().catch((error) => {
    console.error(error);
    toast("Startup problem", error.message || "The editor could not finish loading.", "error", 8000);
  });})();
