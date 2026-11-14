'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),mark=require('../../scripts/lib/brand-mark.cjs');
test('all Windows frames match the original SVGs and preserve transparent corners',()=>{
  const result=require('../../scripts/check-brand-rendering.cjs').audit(root);
  assert.equal(result.frames,9);assert.equal(result.smallOpticalMaxPx,32);
});
test('16 through 32 pixel slots use the wider optical drawing in both renderers',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/make-icon.py'),'utf8');
  const value=Number(source.match(/^SMALL_OPTICAL_MAX_PX = (\d+)$/m)?.[1]);
  assert.equal(value,mark.SMALL_OPTICAL_MAX_PX);
  assert.ok(mark.SMALL.scale>mark.MASTER.scale);
});
test('native-size rasterization is used before ICO encoding',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'desktop/assets/icon-manifest.json'),'utf8'));
  assert.equal(manifest.rasterization,'native-size-svg');
});
