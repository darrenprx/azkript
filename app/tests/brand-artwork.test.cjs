'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
for(const [name,file] of [['master','azkript-mark.svg'],['small','azkript-mark-small.svg']]) {
  const svg=()=>fs.readFileSync(path.join(root,'app/brand',file),'utf8');
  test(`${name}: the original ribbon contains no font outlines, text or embedded bitmap`,()=>{
    assert.doesNotMatch(svg(),/<(?:text|image)\b|S_OUTLINE|az-badge|az-page/);
    assert.match(svg(),/Font-free original geometry/);
  });
  test(`${name}: front, return and tail planes are present`,()=>{
    for(const id of ['ribbon-front-plane','ribbon-back-plane','ribbon-tail-plane'])assert.match(svg(),new RegExp('id="'+id+'"'));
  });
  test(`${name}: the small highlight streak is absent`,()=>{
    const body=svg().split('</defs>')[1];
    const strokes=[...body.matchAll(/<path\b[^>]*\bstroke="[^"]+"[^>]*>/g)].map(m=>m[0]);
    assert.ok(strokes.every(tag=>tag.includes('id="ribbon-contact-shadow"')),'Only the fold contact shadow may use a stroked path');
    assert.doesNotMatch(svg(),/ribbon-face-clip|#FFE9B0|edge-highlight/);
  });
  test(`${name}: all gradient, clip and filter references resolve`,()=>{
    const ids=new Set([...svg().matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
    for(const m of svg().matchAll(/url\(#([^\)]+)\)/g))assert.ok(ids.has(m[1]),'Missing SVG definition '+m[1]);
  });
}
test('the contact shadow is confined to the return plane and omitted at small sizes',()=>{
  const master=fs.readFileSync(path.join(root,'app/brand/azkript-mark.svg'),'utf8');
  const small=fs.readFileSync(path.join(root,'app/brand/azkript-mark-small.svg'),'utf8');
  assert.match(master,/<path id="ribbon-contact-shadow"[^>]*clip-path="url\(#ribbon-back-clip\)"/);
  assert.doesNotMatch(small,/<filter|ribbon-contact-shadow/);
});
