"use strict";

window.AzkriptRenderer.createState = function () {
  return {
    // User preferences shared by editing and presentation.
    preferences: {
      typographyMode: "document",
      uiScale: 1,
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
      zoom: 1,
      lastBackupAt: 0,
      readRate: 1,
      readVoiceURI: "",
      autosave: true,
      showGuides: true,
      showInvisibles: false,
      showOutline: true,
      showRuler: true,
      showOutlineInScript: true,
      showStructureLines: false,
      hideScriptNotes: false,
      navigatorVisible: true,
      textColor: "#171614",
      highlightColor: "#ffe9a3",
      typewriterMode: "off",
      beatConnectionColor: "#0f6cbd",
      profile: { name: "Local Writer", role: "Writer" },
      font: "Courier New",
      fontSize: 12,
      startCenterOnLaunch: true,
    },
    // Selection, input composition and editor overlays.
    editorState: {
      selectedId: null,
      pendingSelection: null,
      composing: false,
      showAlts: true,
      tagsMode: false,
      trackChanges: false,
      trackedBaseline: null,
      smart: { visible: false, items: [], index: 0, elementId: null, mode: "" },
    },
    // The active view and controls tied to its workspace.
    workspaceState: {
      view: "script",
      mode: "write",
      inspectorTab: "format",
      fit: 1,
      flow: false,
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
      splitView: { enabled: false, orientation: "vertical", swapped: false, mode: "cards" },
      navTab: "scenes",
      cardMode: "summary",
      cardsAcross: 0,
      sceneViewCols: { title: true, summary: true, action: true },
      beatSnap: true,
      reportType: "statistics",
      selectedBeatId: null,
      beatConnectMode: false,
      beatConnectSource: null,
      outlineZoom: 1,
      sceneQuery: "",
      navigatorQuery: "",
      sceneTimer: null,
      scrollTick: false,
      dragScene: null,
      lastRevisionFlash: 0,
    },
    // Native shell, Start Center and pending crash recovery.
    desktopState: {
      windowTimer: null,
      startCenterOpen: false,
      startCenterCloseTimer: null,
      suppressStartCenter: false,
      recovery: null,
      appInfo: null,
      recent: [],
    },
    // Command palette, tooltips and writing sprint.
    interfaceState: {
      sprint: { open: false, running: false, durationMin: 25, remainingSec: 1500, startWords: 0, timer: null },
      commandIndex: 0,
      commands: [],
      tooltipEl: null,
      tooltipTrigger: null,
      tooltipTimer: null,
    },
    // The active ribbon tab and popover.
    ribbonState: {
      ribbonTab: "home",
      ribbonSyncTimer: null,
      openMenu: null,
    },
  };
};
