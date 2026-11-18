'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { project } = require('../app/js/workspace-tools');
const { MAX_BYTES, canonicalPath, readFileVersion, sha256, writeAtomic } = require('./document-safety');
const MANIFEST = 'project.azkproj';
const MANIFEST_LIMIT = 1024 * 1024;

class ProjectStore {
  constructor() { this.root = null; this.queue = Promise.resolve(); }
  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  async resolve(relative) {
    if (!this.root) throw new Error('Open a project folder first.');
    const target = path.resolve(this.root, relative);
    const inside = value => { const rel = path.relative(this.root, value); return rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
    if (!inside(target)) throw new Error('Path is outside the project folder.');
    // Refuse symlinks/junctions on every existing component, including files.
    let cursor = this.root;
    for (const piece of path.relative(this.root, target).split(path.sep)) {
      cursor = path.join(cursor, piece);
      const stat = await fs.lstat(cursor).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat?.isSymbolicLink()) throw new Error('Project paths cannot contain links or junctions.');
    }
    return target;
  }
  open(folder, create = false) {
    return this.enqueue(async () => {
      const previous = this.root;
      this.root = await fs.realpath(folder);
      try {
        const filename = await this.resolve(MANIFEST);
        if (create) {
          const manifest = project({ format: 'azkript-project', version: 1, title: path.basename(this.root), scripts: [], bible: {} });
          const contents = JSON.stringify(manifest, null, 2);
          const handle = await fs.open(filename, 'wx');
          try {
            try { await handle.writeFile(contents); await handle.sync(); }
            finally { await handle.close(); }
          } catch (error) {
            await fs.rm(filename, { force: true }).catch(() => {});
            throw error;
          }
          return { root: this.root, manifest, identity: sha256(contents) };
        }
        return await this.readManifest(filename);
      } catch (error) {
        this.root = previous;
        throw error;
      }
    });
  }
  async readManifest(filename) {
    const version = await readFileVersion(filename, { includeContents: true, maxBytes: MANIFEST_LIMIT });
    if (version.missing) throw new Error('This folder has no Azkript project manifest.');
    return { root: this.root, manifest: project(JSON.parse(version.contents)), identity: version.identity };
  }
  read() {
    return this.enqueue(async () => this.readManifest(await this.resolve(MANIFEST)));
  }
  save(payload) {
    const root = payload.expectedRoot ?? this.root;
    return this.enqueue(async () => {
      if (!this.root || !root || canonicalPath(this.root) !== canonicalPath(root)) throw new Error('The active project changed.');
      const filename = await this.resolve(MANIFEST);
      const before = await this.readManifest(filename);
      if (!payload.expectedIdentity || payload.expectedIdentity !== before.identity) throw new Error('The project changed outside Azkript. Reopen it before saving.');
      const manifest = project(payload.manifest);
      let scriptPath, scriptContents;
      if (payload.script) {
        scriptContents = String(payload.script.contents || '');
        if (Buffer.byteLength(scriptContents) > MAX_BYTES || !scriptContents.includes('<FinalDraft')) throw new Error('A valid FDX script is required.');
        const relative = `script-${crypto.randomUUID()}.fdx`;
        scriptPath = await this.resolve(relative);
        manifest.scripts.push({ path: relative, title: String(payload.script.title || 'Untitled screenplay').slice(0, 200) });
      }
      const contents = JSON.stringify(manifest, null, 2);
      if (Buffer.byteLength(contents) > MANIFEST_LIMIT) throw new Error('Project manifest is larger than the 1 MB limit.');
      if (scriptPath) await writeAtomic(scriptPath, scriptContents);
      try {
        await writeAtomic(filename, contents, async () => {
          const current = await readFileVersion(await this.resolve(MANIFEST), { maxBytes: MANIFEST_LIMIT });
          if (current.identity !== before.identity) throw new Error('Project changed while saving. Reopen before retrying.');
        });
      } catch (error) {
        if (scriptPath) await fs.rm(scriptPath, { force: true }).catch(() => {});
        throw error;
      }
      return { root: this.root, manifest, identity: sha256(contents) };
    });
  }
  script(relative, expectedRoot) {
    return this.enqueue(async () => {
      if (expectedRoot && (!this.root || canonicalPath(this.root) !== canonicalPath(expectedRoot))) throw new Error('The active project changed.');
      const current = await this.readManifest(await this.resolve(MANIFEST));
      if (!current.manifest.scripts.some(script => script.path === relative)) throw new Error('Script is not listed in this project.');
      return this.resolve(relative);
    });
  }
}
module.exports = { ProjectStore };
