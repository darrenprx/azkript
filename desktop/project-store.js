'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { project } = require('../app/js/workspace-tools');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const MANIFEST = 'project.azkproj';
class ProjectStore {
  constructor() { this.root = null; this.queue = Promise.resolve(); }
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
    const action = async () => {
    const previous = this.root; this.root = await fs.realpath(folder);
    try {
      const filename = await this.resolve(MANIFEST);
      if (create) {
        const manifest = project({ format:'azkript-project',version:1,title:path.basename(this.root),scripts:[],bible:{} });
        await fs.writeFile(filename, JSON.stringify(manifest,null,2), {flag:'wx'});
      }
      return await this.read();
    } catch(error) { this.root = previous; throw error; }
    };
    const result = this.queue.then(action); this.queue = result.catch(()=>{}); return result;
  }
  async read() {
    const filename = await this.resolve(MANIFEST), stat = await fs.stat(filename);
    if (stat.size > 1024 * 1024) throw new Error('Project manifest is too large.');
    const bytes = await fs.readFile(filename);
    return { root:this.root, manifest:project(JSON.parse(bytes)), identity:hash(bytes) };
  }
  save(payload) {
    const root = this.root;
    const action = async () => {
      if (this.root !== root) throw new Error('The active project changed.');
      const before = await this.read();
      if (!payload.expectedIdentity || payload.expectedIdentity !== before.identity) throw new Error('The project changed outside Azkript. Reopen it before saving.');
      const manifest = project(payload.manifest);
      let createdScript;
      if (payload.script) {
        const contents = String(payload.script.contents || '');
        if (Buffer.byteLength(contents) > 64 * 1024 * 1024 || !contents.includes('<FinalDraft')) throw new Error('A valid FDX script is required.');
        const relative = `script-${crypto.randomUUID()}.fdx`;
        createdScript = await this.resolve(relative);
        await fs.writeFile(createdScript, contents, {flag:'wx'});
        manifest.scripts.push({path:relative,title:String(payload.script.title || 'Untitled screenplay').slice(0,200)});
      }
      const filename = await this.resolve(MANIFEST), temp = filename + '.' + crypto.randomUUID() + '.tmp';
      try {
        await fs.writeFile(temp,JSON.stringify(manifest,null,2),{flag:'wx'});
        if (hash(await fs.readFile(filename)) !== before.identity) throw new Error('Project changed while saving. Reopen before retrying.');
        await fs.rename(temp,filename);
      } catch(error) { await fs.rm(temp,{force:true}); if(createdScript)await fs.rm(createdScript,{force:true}); throw error; }
      return this.read();
    };
    const result = this.queue.then(action); this.queue = result.catch(()=>{}); return result;
  }
  async script(relative) {
    await this.queue;
    const current = await this.read();
    if (!current.manifest.scripts.some(script=>script.path===relative)) throw new Error('Script is not listed in this project.');
    return this.resolve(relative);
  }
}
module.exports = { ProjectStore };
