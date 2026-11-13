/* Deterministic release inventory: same input bytes produce the same receipt. */
'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {validateManifest}=require('../desktop/release-tools');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const files=[`Azkript-${pkg.version}-portable.exe`,`Azkript-Setup-${pkg.version}.exe`];
const sourceFiles=[];
for(const file of require('./lib/release-files.cjs').runtimeFiles(root))sourceFiles.push({file,sha256:sha(fs.readFileSync(path.join(root,file)))});
const manifest={format:'azkript-release',schemaVersion:1,version:pkg.version,
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  sourceTreeSHA256:sha(JSON.stringify(sourceFiles)),
  payloads:{appArchiveSHA256:sha(fs.readFileSync(path.join(root,'dist/win-unpacked/resources/app.asar'))),executableSHA256:sha(fs.readFileSync(path.join(root,'dist/win-unpacked/Azkript.exe')))},
  sourceFiles,
  dependencies:{electron:pkg.devDependencies.electron,electronBuilder:pkg.devDependencies['electron-builder'],packageLockSHA256:sha(fs.readFileSync(path.join(root,'package-lock.json')))},
  artifacts:files.map(file=>{const bytes=fs.readFileSync(path.join(root,'dist',file));return{file,size:bytes.length,sha256:sha(bytes)};})};
validateManifest(manifest);
fs.writeFileSync(path.join(root,'dist','release.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist','SHA256SUMS.txt'),manifest.artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
console.log(`Release ${pkg.version}: generated deterministic manifest and hashes (sourceDirty=${manifest.sourceDirty}).`);
