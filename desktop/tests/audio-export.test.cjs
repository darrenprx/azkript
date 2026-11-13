'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {validateItems,synthesize}=require('../audio-export');
test('31: audio export validates profiles, passes text only through JSON and checks WAV bytes',async()=>{
  assert.throws(()=>validateItems([]),/spoken/);assert.throws(()=>validateItems([{text:'x',profile:{rate:Infinity}}]),/rate/);
  let input,folder;
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
  const result=await synthesize([{text:'$(secret) <tag> "quote"',profile:{voice:'Voice',rate:1,pitch:1}}],{run:async(executable,args,options,done)=>{
    try{assert.equal(executable,'powershell.exe');assert.equal(options.windowsHide,true);const inputPath=args[args.indexOf('-InputPath')+1],output=args[args.indexOf('-OutputPath')+1];folder=require('node:path').dirname(inputPath);input=JSON.parse(await fs.readFile(inputPath,'utf8'));assert.equal(args.includes('$(secret)'),false);await fs.writeFile(output,wav);done(null);}catch(e){done(e);}
  }});assert.equal(result.toString('ascii',0,4),'RIFF');assert.equal(input[0].text,'$(secret) <tag> "quote"');await assert.rejects(fs.stat(folder));
});
