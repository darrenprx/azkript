'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),mark=require('../../scripts/lib/brand-mark.cjs');
const palette=JSON.parse(fs.readFileSync(path.join(root,'app/brand/palettes.json'),'utf8'));
for(const [name,g] of [['master',mark.MASTER],['small',mark.SMALL]]) {
  test(`${name}: the ribbon return joins the left edge without a pointed cusp`,()=>assert.doesNotThrow(()=>mark.validateGeometry(g)));
  test(`${name}: a downward return that reverses into the edge is rejected`,()=>{
    const bad=structuredClone(g);bad.return.end[1]=bad.return.control2[1]+1;
    assert.throws(()=>mark.validateGeometry(bad),/without a cusp/);
  });
  test(`${name}: moving the return off the shared left edge is rejected`,()=>{
    const bad=structuredClone(g);bad.return.end[0]+=.5;
    assert.throws(()=>mark.validateGeometry(bad),/without a cusp/);
  });
}
test('the generated SVGs are current for the selected palette',()=>{
  execFileSync(process.execPath,['scripts/build-brand.cjs','--check'],{cwd:root,stdio:'pipe'});
});
test('every supported color theme renders both optical sizes',()=>{
  for(const theme of Object.values(palette.themes)) {
    assert.doesNotThrow(()=>mark.validateTheme(theme));
    assert.match(mark.masterSvg(theme),/ribbon-front-plane/);assert.match(mark.smallSvg(theme),/scale\(3\)/);
  }
});
test('missing palette colors cannot silently generate an invisible plane',()=>{
  const bad=structuredClone(palette.themes[palette.selected]);bad.face.pop();
  assert.throws(()=>mark.masterSvg(bad),/hex colors/);
});
