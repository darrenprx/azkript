'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process');
const scriptPath=path.join(__dirname,'synthesize-audio.ps1').replace(/([\\/])app\.asar([\\/])/i,'$1app.asar.unpacked$2');
function validateItems(items){
  if(!Array.isArray(items)||!items.length||items.length>20000)throw new Error('Choose between 1 and 20,000 spoken paragraphs.');
  let total=0;
  return items.map(item=>{
    if(typeof item.text!=='string'||item.text.length>100000)throw new Error('Invalid spoken text.');
    total+=item.text.length;if(total>2e6)throw new Error('Audio export text exceeds 2 million characters.');
    const profile=item.profile||{},rate=Number(profile.rate??1),pitch=Number(profile.pitch??1);
    if(!Number.isFinite(rate)||rate<0.5||rate>2||!Number.isFinite(pitch)||pitch<0||pitch>2||typeof(profile.voice??'')!=='string')throw new Error('Voice rate must be 0.5–2 and pitch 0–2.');
    return {text:item.text,voice:profile.voice||'',rate,pitch};
  });
}
async function synthesize(items,{run=execFile}={}){
  const safe=validateItems(items),folder=await fs.mkdtemp(path.join(os.tmpdir(),'azkript-audio-'));
  const input=path.join(folder,'speech.json'),output=path.join(folder,'speech.wav');
  try{
    await fs.writeFile(input,JSON.stringify(safe),'utf8');
    await new Promise((resolve,reject)=>run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,'-InputPath',input,'-OutputPath',output],{windowsHide:true,timeout:600000,maxBuffer:1024*1024},(err,stdout,stderr)=>err?reject(new Error('Windows audio export failed: '+String(stderr||err.message).slice(0,1500))):resolve()));
    const stat=await fs.stat(output);if(stat.size>250e6)throw new Error('Audio file exceeds 250 MB. Export fewer scenes.');
    const wav=await fs.readFile(output);if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.length<44)throw new Error('Speech engine returned an invalid WAV file.');return wav;
  }finally{await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={validateItems,synthesize};
