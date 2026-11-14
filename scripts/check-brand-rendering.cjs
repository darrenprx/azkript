/* Check that the shared SVGs, sprite and generated Windows assets cannot drift. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sizes = [16,20,24,32,40,48,64,128,256];
const inputs = ['app/brand/azkript-mark.svg','app/brand/azkript-mark-small.svg','app/brand/palettes.json','scripts/lib/brand-mark.cjs','scripts/make-icon.py','scripts/render-icon.cjs'];
const outputs = ['desktop/assets/icon.png','desktop/assets/icon-512.png','desktop/assets/icon.ico'];
function audit(base = root) {
  const mark = require(path.join(base, 'scripts/lib/brand-mark.cjs'));
  mark.validateGeometry(mark.MASTER); mark.validateGeometry(mark.SMALL);
  const manifest = JSON.parse(fs.readFileSync(path.join(base,'desktop/assets/icon-manifest.json'),'utf8'));
  assert.equal(manifest.format,'azkript-brand-assets'); assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.smallOpticalMaxPx,mark.SMALL_OPTICAL_MAX_PX);
  assert.equal(manifest.rasterization,'native-size-svg'); assert.deepEqual(manifest.icoSizes,sizes);
  for (const [field, files] of [['inputs',inputs],['outputs',outputs]]) {
    assert.deepEqual(Object.keys(manifest[field]).sort(), [...files].sort());
    for (const file of files) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file))).digest('hex');
      assert.equal(sha,manifest[field][file],`${file}: stale brand asset; run brand:build, brand:sync and brand:icons`);
    }
  }
  const palette = JSON.parse(fs.readFileSync(path.join(base,'app/brand/palettes.json'),'utf8'));
  for (const [file, expected] of [['app/brand/azkript-mark.svg',mark.masterSvg(palette.themes[palette.selected])],['app/brand/azkript-mark-small.svg',mark.smallSvg(palette.themes[palette.selected])]]) {
    assert.equal(fs.readFileSync(path.join(base,file),'utf8'),expected,`${file}: not generated from the current geometry and palette`);
  }
  const ico = fs.readFileSync(path.join(base,'desktop/assets/icon.ico'));
  assert.equal(ico.readUInt16LE(0),0); assert.equal(ico.readUInt16LE(2),1); assert.equal(ico.readUInt16LE(4),sizes.length);
  sizes.forEach((size,i) => {
    const entry=6+i*16, width=ico[entry]||256, height=ico[entry+1]||256;
    assert.equal(width,size); assert.equal(height,size);
    const length=ico.readUInt32LE(entry+8), offset=ico.readUInt32LE(entry+12);
    assert.ok(length>0 && offset>=6+sizes.length*16 && offset+length<=ico.length);
    if(size<=64) {
      assert.equal(ico.readUInt32LE(offset),40); assert.equal(ico.readInt32LE(offset+4),size); assert.equal(ico.readInt32LE(offset+8),size*2);
      for(const [x,y] of [[0,0],[size-1,0],[0,size-1],[size-1,size-1]]) assert.equal(ico[offset+40+((size-1-y)*size+x)*4+3],0,'ICO corners must remain transparent');
    } else {
      assert.equal(ico.subarray(offset,offset+8).toString('hex'),'89504e470d0a1a0a');
      assert.equal(ico.readUInt32BE(offset+16),size); assert.equal(ico.readUInt32BE(offset+20),size);
    }
  });
  return {passed:true,frames:sizes.length,smallOpticalMaxPx:mark.SMALL_OPTICAL_MAX_PX};
}
if(require.main===module) {try {const result=audit();console.log(`PASS: original rounded ribbon, native-size rasters and all ${result.frames} ICO frames match their source hashes.`);}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={audit};
