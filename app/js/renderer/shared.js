"use strict";

/* Renderer factory registration, DOM bindings and model helpers. */
window.AzkriptRenderer = Object.create(null);
window.AzkriptRenderer.createShared = function ({ documentSession, preferences }) {

  const {
    ELEMENTS: DEFAULT_ELEMENTS,
    PALETTE,
    uid,
    escapeHtml,
    stripHtml,
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
  const ELEMENTS = new Proxy(DEFAULT_ELEMENTS, {
    get: (target, key) => documentSession.doc?.elements?.[key] || target[key],
    has: (target, key) => Boolean(documentSession.doc?.elements?.[key] || key in target),
    ownKeys: target => [...new Set([...Object.keys(target), ...Object.keys(documentSession.doc?.elements || {})])],
    getOwnPropertyDescriptor: (target, key) => ({ configurable: true, enumerable: true, value: documentSession.doc?.elements?.[key] || target[key] }),
  });
  const elementSpec = type => modelElementSpec(type, documentSession.doc);
  const nextType = type => modelNextType(type, documentSession.doc);
  const tabType = (type, shift) => modelTabType(type, shift, documentSession.doc);
  const browserBackups = new FDWritingTools.BrowserBackups();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  function on(id, eventName, handler, options) {
    document.getElementById(id)?.addEventListener(eventName, handler, options);
  }
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = () => motionQuery.matches || preferences.reducedMotionPref;
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
  return { $, $$, on, ACCENT_THEMES, ELEMENTS, LINE_SPACING_OPTIONS, PAGE_PRESETS, PALETTE, PAPER_TINTS, SCRIPT_FONT, SCRIPT_FONT_CHOICES, blankDocument, browserBackups, clamp, cloneDocument, desktop, elementSpec, els, escapeHtml, escapeSelector, formatDate, formatTime, getCharacters, getLocations, getScenes, getStats, icon, isDesktop, makeParagraph, markRevision, motionQuery, nextRevision, nextType, normalizeDocument, normalizeScriptFont, paragraphText, plural, prefersReducedMotion, revisionEntry, sampleDocument, scriptFontLabel, scriptFontStack, slug, stripHtml, tabType, templateDocument, uid, validateDocument };
};
