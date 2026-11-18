/* Durable local history and optimistic file-conflict protection.
 * No Electron dependencies: all tests use explicit temporary directories.
 */
"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_BYTES = 64 * 1024 * 1024;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const canonicalPath = value => {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

function decodeDocumentBytes(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    if (buffer.length % 2) throw new Error("The UTF-16 file has an incomplete character.");
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const bytes = Buffer.from(buffer.subarray(2));
    if (bytes.length % 2) throw new Error("The UTF-16 file has an incomplete character.");
    bytes.swap16();
    return bytes.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

async function readFileVersion(filePath, { includeContents = false, includeBuffer = false, maxBytes = MAX_BYTES } = {}) {
  const resolved = path.resolve(filePath);
  let handle;
  try {
    handle = await fsp.open(resolved, "r");
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("That path is not a file.");
    if (before.size > maxBytes) throw new Error(`This file is larger than the ${maxBytes / (1024 * 1024)} MB limit.`);
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      const error = new Error("The file changed while it was being read. Try again.");
      error.code = "FILE_CHANGED_DURING_READ";
      throw error;
    }
    return { path: resolved, name: path.basename(resolved), identity: sha256(buffer), size: buffer.length,
      mtimeMs: after.mtimeMs, statKey: statKey(after), missing: false,
      ...(includeContents ? { contents: decodeDocumentBytes(buffer) } : {}),
      ...(includeContents || includeBuffer ? { buffer } : {}) };
  } catch (error) {
    if (error.code === "ENOENT") return { path: resolved, name: path.basename(resolved), identity: null, size: 0, mtimeMs: null, missing: true };
    throw error;
  } finally { if (handle) await handle.close(); }
}

function statKey(stat) {
  return stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : undefined;
}

async function checkExpectedIdentity(filePath, expectedIdentity) {
  if (expectedIdentity === undefined) return null;
  if (expectedIdentity !== null && !/^[a-f0-9]{64}$/i.test(expectedIdentity)) throw new Error("The expected file identity is invalid.");
  const current = await readFileVersion(filePath);
  return current.identity === expectedIdentity ? null : { conflict: true, path: current.path, name: current.name,
    currentIdentity: current.identity, identity: current.identity, missing: current.missing, mtimeMs: current.mtimeMs, size: current.size };
}

async function writeAtomic(file, contents, beforeCommit) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let staged = false;
  try {
    const handle = await fsp.open(temp, "wx", 0o600);
    staged = true;
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      // Check again after staging the bytes and before each rename attempt.
      const conflict = await beforeCommit?.();
      if (conflict) return conflict;
      try {
        await fsp.rename(temp, file);
        staged = false;
        return;
      }
      catch (error) {
        if (attempt >= 2 || !["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  } finally {
    if (staged) await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

function snapshotBytes(document) {
  if (!document || typeof document !== "object" || !Array.isArray(document.paragraphs)) throw new Error("A screenplay document is required.");
  const stable = { ...document };
  delete stable.updatedAt;
  delete stable.savedAt;
  return Buffer.from(JSON.stringify(stable), "utf8");
}

class BackupStore {
  constructor(root, { maxEntries = 50, maxBytes = 256 * 1024 * 1024 } = {}) {
    this.root = path.resolve(root);
    this.maxEntries = Math.max(1, Math.min(100, maxEntries));
    this.maxBytes = Math.max(MAX_BYTES, maxBytes);
    this.queue = Promise.resolve();
    this.lastStamp = 0;
  }
  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  bucket(payload) {
    if (payload.documentId) return sha256(`id:${String(payload.documentId).slice(0, 200)}`);
    if (payload.filePath) return sha256(`path:${canonicalPath(payload.filePath)}`);
    throw new Error("A document ID or file path is required for a backup.");
  }
  async entriesIn(bucket) {
    const folder = path.join(this.root, bucket);
    const names = await fsp.readdir(folder).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    const records = [];
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.meta\.json$/i.test(name)) continue;
      try {
        const record = JSON.parse(await fsp.readFile(path.join(folder, name), "utf8"));
        if (record.id !== `${bucket}-${name.slice(0, -10)}` || record.version !== 1 ||
          typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
          !Number.isSafeInteger(record.size) || record.size < 0 ||
          (record.label != null && typeof record.label !== "string")) continue;
        records.push(record);
      } catch { /* A damaged history entry never hides the other versions. */ }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  metadata(record) {
    const { data, ...metadata } = record;
    return metadata;
  }
  async create(payload) {
    return this.enqueue(async () => {
      const bucket = this.bucket(payload);
      const document = payload.document;
      const buffer = document ? snapshotBytes(document) : payload.buffer;
      if (!Buffer.isBuffer(buffer)) throw new Error("Backup contents are required.");
      if (buffer.length > MAX_BYTES) throw new Error("The backup is larger than the 64 MB safety limit.");
      const kind = document ? "document" : "file";
      const identity = sha256(buffer);
      const existing = await this.entriesIn(bucket);
      const latest = existing.find(entry => entry.kind === kind);
      const label = String(payload.label || "").trim().slice(0, 120);
      if (!label && latest && latest.identity === identity) return { ...this.metadata(latest), deduplicated: true };
      const uuid = crypto.randomUUID();
      const stamp = Math.max(Date.now(), this.lastStamp + 1);
      this.lastStamp = stamp;
      const record = { version: 1, id: `${bucket}-${uuid}`, documentKey: bucket, documentId: String(payload.documentId || ""),
        filePath: payload.filePath ? path.resolve(payload.filePath) : null, title: String(payload.title || "Untitled Screenplay").slice(0, 500),
        label, kind, createdAt: new Date(stamp).toISOString(), identity, size: buffer.length,
        encoding: document ? "json" : "base64", data: document ? JSON.parse(buffer.toString("utf8")) : buffer.toString("base64") };
      const folder = path.join(this.root, bucket);
      await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
      const filename = path.join(folder, `${uuid}.json`);
      await writeAtomic(filename, JSON.stringify(record));
      try { await writeAtomic(path.join(folder, `${uuid}.meta.json`), JSON.stringify(this.metadata(record))); }
      catch (error) {
        await fsp.rm(filename, { force: true }).catch(() => {});
        throw error;
      }
      let used = label.startsWith("Milestone: ") ? 0 : record.size;
      let retained = label.startsWith("Milestone: ") ? 0 : 1;
      for (const old of existing) {
        // Named draft milestones are explicit user records, not rotating backups.
        if (old.label?.startsWith('Milestone: ')) continue;
        if (retained >= this.maxEntries || used + old.size > this.maxBytes) {
          const oldUuid = old.id.slice(bucket.length + 1);
          try {
            await fsp.rm(path.join(folder, `${oldUuid}.meta.json`), { force: true });
            await fsp.rm(path.join(folder, `${oldUuid}.json`), { force: true });
          } catch (error) { console.warn("Could not prune an older backup:", error.message); }
        } else {
          used += old.size;
          retained++;
        }
      }
      return this.metadata(record);
    });
  }
  async createFile(filePath, payload = {}) {
    const version = await readFileVersion(filePath, { includeBuffer: true });
    if (version.missing) return null;
    return this.create({ ...payload, filePath: version.path, buffer: version.buffer });
  }
  async list(query = {}) {
    await this.queue;
    const names = await fsp.readdir(this.root).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    const records = [];
    const hasFilter = Boolean(query.documentId || query.filePath);
    const wantedPath = query.filePath ? canonicalPath(query.filePath) : null;
    for (const bucket of names) {
      if (!/^[a-f0-9]{64}$/.test(bucket)) continue;
      for (const record of await this.entriesIn(bucket)) {
        if (query.recoveryArchive && record.label !== "Previous crash recovery") continue;
        if (!hasFilter || (query.documentId && record.documentId === query.documentId) ||
          (wantedPath && record.filePath && canonicalPath(record.filePath) === wantedPath)) records.push(this.metadata(record));
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  }
  async read(id) {
    await this.queue;
    const match = String(id || "").match(/^([a-f0-9]{64})-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
    if (!match) throw new Error("The backup ID is invalid.");
    const filename = path.join(this.root, match[1], `${match[2]}.json`);
    const stat = await fsp.stat(filename);
    if (!stat.isFile() || stat.size > MAX_BYTES * 1.5) throw new Error("The backup file is invalid or too large.");
    const record = JSON.parse(await fsp.readFile(filename, "utf8"));
    if (record.id !== id || record.version !== 1) throw new Error("The backup metadata is invalid.");
    const buffer = record.kind === "document" ? Buffer.from(JSON.stringify(record.data), "utf8") : Buffer.from(record.data, "base64");
    if (sha256(buffer) !== record.identity) throw new Error("The backup contents failed their integrity check.");
    return { ...this.metadata(record), ...(record.kind === "document" ? { document: record.data } : { contents: decodeDocumentBytes(buffer) }) };
  }
}

class FileChangeWatcher {
  constructor(onChange, { debounceMs = 120, pollMs = 2000 } = {}) {
    this.onChange = onChange; this.debounceMs = debounceMs; this.pollMs = pollMs; this.generation = 0;
  }
  stop() {
    this.generation++;
    this.watcher?.close(); this.watcher = null;
    clearTimeout(this.timer); clearInterval(this.poller);
    this.timer = this.poller = null; this.filePath = null;
  }
  async start(filePath, identity) {
    this.stop();
    this.filePath = path.resolve(filePath);
    const generation = this.generation;
    const current = await readFileVersion(this.filePath);
    if (this.generation !== generation) return { canceled: true };
    this.identity = current.identity;
    this.statKey = current.statKey;
    const changed = identity !== undefined && identity !== current.identity;
    let probing = false;
    const probe = async force => {
      if (this.generation !== generation || probing) return;
      probing = true;
      try {
        if (!force) {
          const stat = await fsp.stat(this.filePath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
          if (statKey(stat) === this.statKey) return;
        }
        const next = await readFileVersion(this.filePath);
        if (this.generation !== generation) return;
        this.statKey = next.statKey;
        if (next.identity !== this.identity) {
          this.identity = next.identity;
          this.onChange(next);
        }
      } catch (error) {
        if (this.generation === generation) this.onChange({ path: this.filePath, error: error.message, code: error.code || "READ_FAILED" });
      } finally { probing = false; }
    };
    try {
      const watcher = fs.watch(path.dirname(this.filePath), { persistent: false }, (_event, name) => {
        if (this.generation !== generation) return;
        if (name && String(name).toLowerCase() !== path.basename(this.filePath).toLowerCase()) return;
        clearTimeout(this.timer); this.timer = setTimeout(() => probe(true), this.debounceMs); this.timer.unref?.();
      });
      this.watcher = watcher;
      watcher.on("error", () => { watcher.close(); if (this.watcher === watcher) this.watcher = null; });
    } catch { /* Polling still detects missing/recreated or temporarily inaccessible directories. */ }
    this.poller = setInterval(() => probe(false), this.pollMs); this.poller.unref?.();
    if (changed) this.onChange(current);
    return { ...current, changed };
  }
  accept(filePath, identity) {
    if (this.filePath && canonicalPath(filePath) === canonicalPath(this.filePath)) { this.identity = identity; this.statKey = null; }
  }
}

module.exports = { MAX_BYTES, sha256, canonicalPath, decodeDocumentBytes, readFileVersion, checkExpectedIdentity, writeAtomic, BackupStore, FileChangeWatcher };
