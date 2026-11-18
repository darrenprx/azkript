"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { BackupStore, FileChangeWatcher, readFileVersion, checkExpectedIdentity, sha256 } = require("../document-safety");

async function sandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "azkript-safety-unit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const doc = (html, extra = {}) => ({ id: "doc-1", title: "Test", paragraphs: [{ id: "p-1", type: "Action", html }], ...extra });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("file identities distinguish same-length external edits while ignoring timestamp-only changes", async t => {
  const root = await sandbox(t), file = path.join(root, "draft.fdx");
  const absent = await readFileVersion(file);
  assert.equal(absent.identity, null);
  assert.equal(absent.missing, true);
  await fs.writeFile(file, "first");
  const initial = await readFileVersion(file, { includeContents: true });
  assert.equal(initial.identity, sha256(Buffer.from("first")));
  assert.equal(initial.contents, "first");
  await fs.utimes(file, new Date(), new Date(Date.now() + 2000));
  assert.equal(await checkExpectedIdentity(file, initial.identity), null);
  await fs.writeFile(file, "other");
  const conflict = await checkExpectedIdentity(file, initial.identity);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.currentIdentity, sha256(Buffer.from("other")));
  assert.equal(await fs.readFile(file, "utf8"), "other", "checking a conflict must not modify the file");
  await fs.rm(file);
  assert.equal((await checkExpectedIdentity(file, initial.identity)).missing, true);
  assert.equal(await checkExpectedIdentity(file, null), null);
  await assert.rejects(checkExpectedIdentity(file, "not-a-hash"), /invalid/);
});

test("snapshots are content-deduplicated, named, restorable, and ordered", async t => {
  const store = new BackupStore(path.join(await sandbox(t), "history"));
  const first = await store.create({ documentId: "doc-1", title: "First", document: doc("one", { updatedAt: "before" }) });
  const duplicate = await store.create({ documentId: "doc-1", document: doc("one", { updatedAt: "after", savedAt: "later" }) });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.deduplicated, true);
  const milestone = await store.create({ documentId: "doc-1", label: "Draft A", document: doc("one") });
  const second = await store.create({ documentId: "doc-1", document: doc("two") });
  const list = await store.list({ documentId: "doc-1" });
  assert.deepEqual(list.map(r => r.id), [second.id, milestone.id, first.id]);
  assert.ok(list.every(r => !r.data && !r.document), "listing returns metadata without loading draft contents");
  const restored = await store.read(first.id);
  assert.equal(restored.document.paragraphs[0].html, "one");
  assert.equal((await store.read(milestone.id)).label, "Draft A");
});

test("prior-file backups retain Unicode and UTF-16 text with exact byte hashes", async t => {
  const root = await sandbox(t), file = path.join(root, "unicode.fdx");
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<?xml?><FinalDraft>中文 😀</FinalDraft>", "utf16le")]);
  await fs.writeFile(file, bytes);
  const store = new BackupStore(path.join(root, "history"));
  const saved = await store.createFile(file, { documentId: "unicode", title: "Unicode" });
  assert.equal(saved.identity, sha256(bytes));
  assert.match((await store.read(saved.id)).contents, /中文 😀/);
  assert.equal((await store.list({ filePath: file })).length, 1);
  assert.equal(await store.createFile(path.join(root, "missing.fdx")), null);
});

test("retention bounds concurrent snapshots per document without deleting another document", async t => {
  const root = await sandbox(t), store = new BackupStore(path.join(root, "history"), { maxEntries: 3 });
  const kept = await store.create({ documentId: "other", document: doc("other") });
  const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => store.create({ documentId: "doc-1", document: doc(`draft ${i}`) })));
  const list = await store.list({ documentId: "doc-1" });
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(r => r.id), writes.slice(-3).reverse().map(r => r.id));
  await assert.rejects(store.read(writes[0].id), /ENOENT/);
  assert.equal((await store.read(kept.id)).document.paragraphs[0].html, "other");
  const bucket = writes[0].documentKey;
  assert.equal((await fs.readdir(path.join(root, "history", bucket))).length, 6, "pruned versions remove metadata and contents");
});

test("backup IDs reject path traversal and integrity checks reject modified contents", async t => {
  const root = await sandbox(t), store = new BackupStore(path.join(root, "history"));
  await assert.rejects(store.read("../../somewhere"), /invalid/);
  const saved = await store.create({ documentId: "doc-1", document: doc("original") });
  const uuid = saved.id.slice(saved.documentKey.length + 1);
  const file = path.join(root, "history", saved.documentKey, `${uuid}.json`);
  const record = JSON.parse(await fs.readFile(file, "utf8"));
  record.data.paragraphs[0].html = "tampered";
  await fs.writeFile(file, JSON.stringify(record));
  await assert.rejects(store.read(saved.id), /integrity/);
});

test("a failed backup does not poison the queue or overwrite existing history", async t => {
  const root = await sandbox(t), blockedRoot = path.join(root, "history");
  await fs.writeFile(blockedRoot, "not a directory");
  const store = new BackupStore(blockedRoot);
  await assert.rejects(store.create({ documentId: "doc-1", document: doc("blocked") }));
  await fs.rm(blockedRoot);
  const good = await store.create({ documentId: "doc-1", document: doc("saved") });
  assert.equal((await store.read(good.id)).document.paragraphs[0].html, "saved");
});

test("damaged snapshot metadata does not block new history or consume retention slots", async t => {
  const root = await sandbox(t), store = new BackupStore(root, { maxEntries: 2 });
  const make = (html, label) => store.create({ documentId: "doc-1", document: doc(html), label });
  const damaged = await make("damaged");
  const older = await make("older");
  const meta = path.join(root, damaged.documentKey, `${damaged.id.slice(damaged.documentKey.length + 1)}.meta.json`);
  const record = JSON.parse(await fs.readFile(meta, "utf8"));
  await fs.writeFile(meta, JSON.stringify({ ...record, createdAt: null }));
  const milestone = await make("issued", "Milestone: issued draft");
  const latest = await make("latest");
  assert.deepEqual((await store.list()).map(item => item.id), [latest.id, milestone.id, older.id]);
});

test("watcher detects external replacement/deletion and stops cleanly", async t => {
  const root = await sandbox(t), file = path.join(root, "draft.fdx");
  await fs.writeFile(file, "before");
  const events = [], watcher = new FileChangeWatcher(event => events.push(event), { debounceMs: 15, pollMs: 30 });
  t.after(() => watcher.stop());
  const initial = await readFileVersion(file);
  assert.equal((await watcher.start(file, initial.identity)).changed, false);
  await fs.writeFile(path.join(root, "replacement.tmp"), "after");
  await fs.rename(path.join(root, "replacement.tmp"), file);
  for (let i = 0; i < 50 && !events.length; i++) await sleep(20);
  assert.equal(events.at(-1).identity, sha256(Buffer.from("after")));
  const eventCount = events.length;
  await fs.rm(file);
  for (let i = 0; i < 50 && events.length === eventCount; i++) await sleep(20);
  assert.equal(events.at(-1).missing, true);
  watcher.stop();
  const stoppedCount = events.length;
  await fs.writeFile(file, "recreated");
  await sleep(80);
  assert.equal(events.length, stoppedCount);
});

test("watcher surfaces an initial mismatch and acknowledges app-owned saves", async t => {
  const root = await sandbox(t), file = path.join(root, "draft.fdx");
  await fs.writeFile(file, "changed");
  const events = [], watcher = new FileChangeWatcher(event => events.push(event), { debounceMs: 30, pollMs: 100 });
  t.after(() => watcher.stop());
  const snapshot = await watcher.start(file, sha256(Buffer.from("original")));
  assert.equal(snapshot.changed, true);
  assert.equal(events.length, 1);
  await fs.writeFile(file, "own save");
  watcher.accept(file, sha256(Buffer.from("own save")));
  await sleep(160);
  assert.equal(events.length, 1, "app-owned content identity must not become an external-change alert");
});
