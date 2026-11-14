/* Validate the original ribbon's color ramps, independently of its SVG geometry. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),mark=require('./lib/brand-mark.cjs');
const palette=JSON.parse(fs.readFileSync(path.join(root,'app/brand/palettes.json'),'utf8'));
const luma=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const results=[];
try {
  assert.ok(palette.themes[palette.selected],'Selected ribbon theme is missing');
  for(const [id,theme] of Object.entries(palette.themes)) {
    mark.validateTheme(theme);
    for(const field of ['face','smallFace','tail']) {
      const light=theme[field].map(luma);
      assert.ok(light.every((value,i)=>i===0||value<=light[i-1]+.001),`${id}: ${field} must deepen toward the return`);
    }
    results.push({id,passed:true});
  }
  if(process.argv.includes('--json'))console.log(JSON.stringify({passed:true,themes:results},null,2));
  else console.log(`PASS: ${results.length} complete ribbon themes with coherent face, return and tail ramps.`);
}catch(error){console.error(error.message);process.exitCode=1;}
