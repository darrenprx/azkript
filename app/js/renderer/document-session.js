"use strict";

// A generation identifies an open draft. Its version also changes on edits.
window.AzkriptRenderer.createDocumentSession = function (model) {
  let activeDocument = model.sampleDocument();
  let generation = 0;
  let editVersion = 0;

  const session = {
    get doc() { return activeDocument; },
    get generation() { return generation; },
    get editVersion() { return editVersion; },
    dirty: false,
    saving: false,
    filePath: null,
    fileName: null,
    fileIdentity: null,
    externalChange: null,
    hasSafetyCopy: false,
    savedSnapshot: null,
    lastSaved: null,
    history: null,
    saveFailed: false,
    saveFailureNotified: false,
    recoveryFailed: false,
    recoveryWrittenAt: null,
    recoveryVersion: null,

    replaceContent(next) {
      activeDocument = model.normalizeDocument(next);
      editVersion++;
    },

    noteEdit() {
      editVersion++;
      session.dirty = true;
    },

    open(next, metadata = {}) {
      session.replaceContent(next);
      generation++;
      session.filePath = metadata.path || null;
      session.fileName = metadata.name || null;
      session.fileIdentity = metadata.identity || null;
      session.lastSaved = metadata.lastSaved || null;
      session.dirty = Boolean(metadata.dirty);
      session.savedSnapshot = Object.hasOwn(metadata, "savedSnapshot")
        ? metadata.savedSnapshot : model.cloneDocument(activeDocument);
      session.externalChange = null;
      session.hasSafetyCopy = false;
      session.resetRecoveryStatus();
    },

    resetRecoveryStatus() {
      session.saveFailed = false;
      session.saveFailureNotified = false;
      session.recoveryFailed = false;
      session.recoveryWrittenAt = null;
      session.recoveryVersion = null;
    },

    recordSaved(snapshot, version) {
      session.savedSnapshot = snapshot;
      session.lastSaved = Date.now();
      if (version === editVersion) session.dirty = false;
      session.saveFailed = false;
      session.saveFailureNotified = false;
    },
  };
  return session;
};
