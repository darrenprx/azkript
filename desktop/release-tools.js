'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function version(value) {
  const match = String(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) throw new Error('Use a stable major.minor.patch release version.');
  return match.slice(1).map(Number);
}
function compareVersions(a,b) { const left=version(a),right=version(b);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0; }
function validateManifest(manifest) {
  if(manifest?.format!=='azkript-release'||manifest.schemaVersion!==1)throw new Error('Unsupported release manifest.');
  version(manifest.version);
  if(!Array.isArray(manifest.artifacts)||!manifest.artifacts.length)throw new Error('Release artifacts are missing.');
  const seen=new Set();
  for(const artifact of manifest.artifacts){
    if(typeof artifact.file!=='string'||path.basename(artifact.file)!==artifact.file||/[\\/:]/.test(artifact.file)||!/^Azkript[-\w.]+\.exe$/.test(artifact.file))throw new Error('Invalid release artifact path.');
    if(seen.has(artifact.file)||!/^[a-f0-9]{64}$/.test(artifact.sha256)||!Number.isSafeInteger(artifact.size)||artifact.size<=0)throw new Error('Invalid release artifact metadata.');
    seen.add(artifact.file);
  }
  return manifest;
}
async function signature(filename) {
  // The path is passed via the environment rather than interpolated into PowerShell code.
  const env={...process.env,AZKRIPT_SIGNATURE_FILE:filename};
  // Windows PowerShell must rebuild its own module path when a developer
  // launched the app from PowerShell 7, whose module binaries use another CLR.
  for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $s = Get-AuthenticodeSignature -LiteralPath $env:AZKRIPT_SIGNATURE_FILE; $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:AZKRIPT_SIGNATURE_FILE); @{status=[string]$s.Status; thumbprint=[string]$s.SignerCertificate.Thumbprint; productName=[string]$v.ProductName; productVersion=("{0}.{1}.{2}" -f $v.ProductMajorPart,$v.ProductMinorPart,$v.ProductBuildPart)} | ConvertTo-Json -Compress'],
    {env,windowsHide:true,timeout:30000,maxBuffer:32768});
  return JSON.parse(stdout.trim());
}
async function stageRelease({manifestPath,currentVersion,directory,trustedThumbprint,rollback=false,verifySignature=signature}) {
  if(!/^[a-f0-9]{40,64}$/i.test(trustedThumbprint||''))throw new Error('A trusted signing identity must be configured before staging updates.');
  const stat=await fs.stat(manifestPath);if(stat.size>1024*1024)throw new Error('Release manifest is too large.');
  const manifest=validateManifest(JSON.parse(await fs.readFile(manifestPath,'utf8')));
  const order=compareVersions(manifest.version,currentVersion);
  if(rollback ? order>=0 : order<=0)throw new Error(rollback?'Rollback must use an earlier release.':'Update must use a newer release.');
  const artifact=manifest.artifacts.find(a=>a.file===`Azkript-Setup-${manifest.version}.exe`);
  if(!artifact)throw new Error('The versioned setup artifact is missing.');
  const source=path.join(path.dirname(manifestPath),artifact.file),sourceStat=await fs.stat(source);
  if(!sourceStat.isFile()||sourceStat.size!==artifact.size||artifact.size>512*1024*1024)throw new Error('Installer failed its hash/size check.');
  const bytes=await fs.readFile(source);
  if(bytes.length!==artifact.size||sha256(bytes)!==artifact.sha256)throw new Error('Installer failed its hash/size check.');
  // Copy first, then verify the exact staged bytes. Never execute a mutable source path.
  await fs.mkdir(directory,{recursive:true});const folder=await fs.mkdtemp(path.join(directory,`${manifest.version}-`));
  const target=path.join(folder,artifact.file);
  try{
    await fs.writeFile(target,bytes,{flag:'wx'});
    const signed=await verifySignature(target);
    if(signed.status!=='Valid'||signed.thumbprint?.toLowerCase()!==trustedThumbprint.toLowerCase())throw new Error('Installer does not have a valid signature from the trusted publisher.');
    if(signed.productName!=='Azkript'||signed.productVersion!==manifest.version)throw new Error('Installer product/version metadata does not match the release manifest.');
    if(sha256(await fs.readFile(target))!==artifact.sha256)throw new Error('Staged installer changed during verification.');
    await fs.writeFile(path.join(folder,'receipt.json'),JSON.stringify({version:manifest.version,fromVersion:currentVersion,rollback,sha256:artifact.sha256,signer:signed.thumbprint,productName:signed.productName,productVersion:signed.productVersion},null,2));
    return {version:manifest.version,path:target,sha256:artifact.sha256};
  }catch(error){await fs.rm(folder,{recursive:true,force:true});throw error;}
}
module.exports={version,compareVersions,validateManifest,stageRelease,signature,sha256};
