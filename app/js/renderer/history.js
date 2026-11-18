"use strict";

window.AzkriptRenderer.createHistory = function ({ initialDocument, currentDocument, captureSelection, onChange }) {
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
    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
      this.burstActive = false;
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
        this.current = History.snapshot(currentDocument());
        this.selectionCurrent = captureSelection() || this.selectionCurrent;
        onChange();
      }, 450);
    }
    finishBurst() {
      if (!this.burstActive) return;
      clearTimeout(this.timer); this.timer = null; this.burstActive = false;
      this.current = History.snapshot(currentDocument());
      this.selectionCurrent = captureSelection() || this.selectionCurrent;
    }
    record() {
      clearTimeout(this.timer);
      this.timer = null;
      this.burstActive = false;
      const next = History.snapshot(currentDocument());
      if (next === this.current) return;
      this.past.push(this.current);
      this.selectionPast.push(this.selectionCurrent);
      if (this.past.length > 100) { this.past.shift(); this.selectionPast.shift(); }
      this.current = next;
      this.selectionCurrent = captureSelection();
      this.future = [];
      this.selectionFuture = [];
      onChange();
    }
    undo() {
      if (this.burstActive) {
        clearTimeout(this.timer);
        this.timer = null;
        this.burstActive = false;
        this.current = History.snapshot(currentDocument());
      } else {
        this.record();
      }
      if (!this.past.length) return false;
      this.future.push(this.current);
      this.selectionFuture.push(captureSelection() || this.selectionCurrent);
      this.current = this.past.pop();
      this.selectionCurrent = this.selectionPast.pop();
      return this.entry();
    }
    entry() {
      return { document: { ...JSON.parse(this.current), sourceFDX: this.sourceFDX }, selection: this.selectionCurrent };
    }
    redo() {
      if (!this.future.length) return false;
      this.past.push(this.current);
      this.selectionPast.push(this.selectionCurrent);
      this.current = this.future.pop();
      this.selectionCurrent = this.selectionFuture.pop();
      this.burstActive = false;
      return this.entry();
    }
  }
  return new History(initialDocument);
};
