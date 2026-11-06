/* Local version history and readable document comparisons. No network access. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.FDWritingTools = factory(root.FDModel);
})(typeof self !== "undefined" ? self : this, function (model) {
  "use strict";
  function compareDocuments(before, after, limit = 200) {
    before = model.normalizeDocument(before);
    after = model.normalizeDocument(after);
    const old = before.paragraphs || [], next = after.paragraphs || [];
    const key = p => model.toUuid(p.id);
    const previous = new Map(old.map((p, index) => [key(p), { p, index }]));
    const current = new Map(next.map((p, index) => [key(p), { p, index }]));
    // A deletion shifts later indexes without moving every later paragraph.
    // Stable relative order is the longest increasing sequence of old indexes.
    const common = [...current.keys()].filter(id => previous.has(id));
    const tails = [], tailPositions = [], predecessors = [];
    common.forEach((id, position) => {
      const value = previous.get(id).index;
      let low = 0, high = tails.length;
      while (low < high) { const middle = (low + high) >> 1; if (tails[middle] < value) low = middle + 1; else high = middle; }
      predecessors[position] = low ? tailPositions[low - 1] : -1;
      tails[low] = value; tailPositions[low] = position;
    });
    const stable = new Set();
    for (let position = tailPositions[tails.length - 1]; position !== undefined && position >= 0; position = predecessors[position]) stable.add(common[position]);
    const rows = [];
    const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
    const push = row => { counts[row.kind]++; if (rows.length < limit) rows.push(row); };
    for (const [id, entry] of current) {
      const prior = previous.get(id);
      const text = model.paragraphText(entry.p);
      if (!prior) push({ id, kind: "added", type: entry.p.type, before: "", after: text });
      else if (prior.p.html !== entry.p.html || prior.p.type !== entry.p.type ||
        JSON.stringify(prior.p.scene) !== JSON.stringify(entry.p.scene) ||
        JSON.stringify(prior.p.note) !== JSON.stringify(entry.p.note) ||
        ["tags", "alignment", "spacing", "spaceBefore", "leading", "pageBreakBefore", "revision", "dualGroup", "dualSide"]
          .some(field => JSON.stringify(prior.p[field]) !== JSON.stringify(entry.p[field]))) {
        push({ id, kind: "changed", type: entry.p.type, before: model.paragraphText(prior.p), after: text });
      } else if (!stable.has(id)) push({ id, kind: "moved", type: entry.p.type, before: text, after: text });
    }
    for (const [id, entry] of previous) if (!current.has(id)) {
      push({ id, kind: "removed", type: entry.p.type, before: model.paragraphText(entry.p), after: "" });
    }
    const metadataChanged = ["title", "author", "titlePage", "elements", "headerFooter", "revision", "page", "settings", "cast", "beats", "lockedPages", "watermark", "characterHighlights", "nativeMetadata"]
      .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    return { counts, rows, metadataChanged, truncated: Object.values(counts).reduce((a, b) => a + b, 0) > rows.length };
  }
  function backupKey(doc) { return String(doc.documentId || doc.id || model.toUuid(doc.title || "untitled")); }
  class BrowserBackups {
    constructor({ retention = 50 } = {}) { this.retention = retention; this.database = null; this.queue = Promise.resolve(); }
    open() {
      if (!this.database) this.database = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(new Error("Version history storage is unavailable.")); return; }
        const request = indexedDB.open("azkript.history.v1", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("snapshots", { keyPath: "id" });
          store.createIndex("documentId", "documentId");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { this.database = null; reject(request.error); };
        request.onblocked = () => reject(new Error("Another window is blocking version history storage."));
      });
      return this.database;
    }
    async list(documentId) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("snapshots").objectStore("snapshots").index("documentId").getAll(String(documentId));
        request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt)
          .map(({ document, fingerprint, ...entry }) => entry));
        request.onerror = () => reject(request.error);
      });
    }
    async read(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("snapshots").objectStore("snapshots").get(String(id));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }
    create(doc, { label = "Automatic snapshot", filePath = null } = {}) {
      // Capture before queuing: a later edit must not silently change this version.
      const snapshot = model.cloneDocument(doc);
      const operation = () => this.write(snapshot, { label, filePath });
      const pending = this.queue.then(operation);
      this.queue = pending.catch(() => {});
      return pending;
    }
    async write(doc, { label, filePath }) {
      const db = await this.open();
      const documentId = backupKey(doc);
      const serialized = JSON.stringify(doc, (key, value) => ["updatedAt", "savedAt"].includes(key) ? undefined : value);
      const fingerprint = model.hash32(serialized) + ":" + serialized.length;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("snapshots", "readwrite");
        const store = transaction.objectStore("snapshots");
        const request = store.index("documentId").getAll(documentId);
        let result;
        request.onsuccess = () => {
          const entries = request.result.sort((a, b) => b.createdAt - a.createdAt);
          if (entries[0]?.fingerprint === fingerprint && entries[0].label === label) { result = entries[0]; return; }
          result = { id: model.uid("backup"), documentId, title: doc.title, filePath, label,
            createdAt: Date.now(), fingerprint, document: doc };
          store.put(result);
          for (const entry of entries.slice(Math.max(0, this.retention - 1))) store.delete(entry.id);
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Version history was not saved."));
      });
    }
  }
  return { compareDocuments, BrowserBackups, backupKey };
});
