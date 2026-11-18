/* Compose the renderer controllers after their classic scripts have loaded. */
(() => {
  "use strict";
  const factories = window.AzkriptRenderer;
  const slices = factories.createState();
  const documentSession = factories.createDocumentSession(FDModel);
  const shared = factories.createShared({ documentSession, preferences: slices.preferences });
  const featurePanels = { initialize: initializeFeaturePanels };
  const context = { ...slices, documentSession, shared, featurePanels, createHistory: factories.createHistory };
  const names = [
    "fileActions", "desktopActions", "workspaceLayout", "editorActions", "writingTools",
    "ribbonActions", "formatActions", "productionActions", "planningViews", "pageActions",
    "modalActions", "findActions", "speechActions", "settingsActions", "inputEvents",
  ];
  // Controllers may call each other after boot. Populate every public API before any event is bound.
  for (const name of names) context[name] = {};
  for (const name of names) Object.assign(context[name], factories[name](context));
  delete window.AzkriptRenderer;

  function initializeFeaturePanels() {
    const { fileActions, editorActions, workspaceLayout, ribbonActions, modalActions, pageActions, speechActions } = context;
    const { openDialog, closeDialog, toast } = modalActions;
    const draft = {
      get doc() { return documentSession.doc; },
      get editVersion() { return documentSession.editVersion; },
      get generation() { return documentSession.generation; },
    };
    const common = {
      draft,
      openDialog,
      closeDialog,
      toast,
      focusParagraph: editorActions.focusParagraph,
      applyDocumentEdit: fileActions.applyDocumentEdit,
    };
    const navigation = { setView: workspaceLayout.setView, setMode: workspaceLayout.setMode };
    featurePanels.workspaceUI = FDWorkspaceUI({
      ...common, ...navigation,
      els: shared.els, desktop: shared.desktop, browserBackups: shared.browserBackups,
      preferences: slices.preferences, workspaceState: slices.workspaceState, ribbonState: slices.ribbonState,
      editorState: slices.editorState, desktopState: slices.desktopState,
      switchRibbonTab: ribbonActions.switchRibbonTab,
      toggleRibbonCollapsed: ribbonActions.toggleRibbonCollapsed,
      toggleSplitView: editorActions.toggleSplitView,
      renderAll: workspaceLayout.renderAll,
      fitPaper: workspaceLayout.fitPaper,
      saveVersionSnapshot: fileActions.saveVersionSnapshot,
      openVersionHistory: fileActions.openVersionHistory,
      handleOpenDocument: fileActions.handleOpenDocument,
    });
    featurePanels.productionUI = FDProductionUI({
      ...common, desktop: shared.desktop, editorState: slices.editorState,
      layoutOptions: pageActions.layoutOptions,
      exportPDF: pageActions.exportPDF, runPreflight: pageActions.runPreflight,
      confirmDiscard: fileActions.confirmDiscard,
      loadDocument: fileActions.loadDocument, markDirty: fileActions.markDirty,
      openTableRead: () => speechActions.openReadDock(true),
    });
    featurePanels.storyUI = FDStoryUI({ ...common, ...navigation, layoutOptions: pageActions.layoutOptions });
  }

  context.fileActions.loadInitial().catch(error => {
    console.error(error);
    context.modalActions.toast("Startup problem", error.message || "The editor could not finish loading.", "error", 8000);
  });
})();
