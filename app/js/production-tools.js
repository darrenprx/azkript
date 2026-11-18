/* Production data and exchange functions. Pure, local and shared with tests. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./model.js'),require('./pagination.js'),require('./fdx.js'),require('./writing-tools.js'));
  else root.FDProduction=factory(root.FDModel,root.FDPagination,root.FDX,root.FDWritingTools);
})(typeof self!=='undefined'?self:this,function(M,P,X,W){
  'use strict';
  const key=p=>M.toUuid(typeof p==='string'?p:p.id), clone=d=>M.cloneDocument(d), text=p=>M.paragraphText(p);
  function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));return value;}
  function content(html){
    const result=[];
    for(const run of X.htmlToRuns(html)){
      const attrs={...run.attrs};delete attrs.TagNumber;delete attrs.RevisionID;
      const item={text:run.text,style:run.style,attrs:stable(attrs)},last=result.at(-1);
      if(last&&last.style===item.style&&JSON.stringify(last.attrs)===JSON.stringify(item.attrs))last.text+=item.text;else result.push(item);
    }return result;
  }
  function paragraphSignature(p){return {id:key(p),type:p.type,content:content(p.html),scene:p.scene?{...p.scene,color:p.scene.color||''}:undefined,revision:p.revision,tags:(p.tags||[]).map(t=>({...t,id:key(t.id)})),dualGroup:p.dualGroup,dualSide:p.dualSide,alignment:p.alignment,spacing:p.spacing,spaceBefore:p.spaceBefore,leading:p.leading,pageBreakBefore:!!p.pageBreakBefore};}
  function elementSignatures(doc){return Object.fromEntries(Object.entries({...M.ELEMENTS,...doc.elements}).map(([type,s])=>[type,{align:s.align,left:Number(s.left),right:Number(s.right),first:Number(s.first)||0,before:Number(s.before)||0,style:s.style||'',font:s.font||s.native?.font?.Font||'Courier Final Draft',fontSize:Number(s.fontSize)||12,spacing:Number(s.spacing)||1,leading:s.leading||'Regular',startsNewPage:!!s.startsNewPage}]));}
  function lock(doc,options){
    const next=clone(doc); next.production.sceneNumbers=Object.fromEntries(M.getScenes(next).map(s=>[key(s.id),s.number]));
    next.production.lock=P.captureLock(next,options); next.production.issuedAt=new Date().toISOString();
    delete next.production.revisionBaseline;
    next.production.baseline={...clone(next),story:{},production:{sceneNumbers:{...next.production.sceneNumbers}},sourceFDX:null}; return next;
  }
  function numberScenes(doc){
    const next=clone(doc), assigned={...next.production.sceneNumbers};
    for(const scene of M.getScenes(next)){
      assigned[key(scene.id)] ||= scene.number;
    }
    next.production.sceneNumbers=assigned;return next;
  }
  const label=p=>String(p.label??p.number);
  function revisionBaseline(doc){
    if(!doc.production?.lock)throw new Error('Lock the issued draft before recording a revision baseline.');
    const next=clone(doc),snapshot=clone(doc);snapshot.sourceFDX=null;snapshot.story={};snapshot.production={lock:next.production.lock,sceneNumbers:next.production.sceneNumbers};
    next.production.revisionBaseline={document:snapshot,createdAt:new Date().toISOString()};return next;
  }
  function revisions(doc,options){
    const baseline=doc.production?.revisionBaseline?.document||doc.production?.baseline;if(!baseline)throw new Error('Issue a locked baseline before creating revision packets.');
    const issued={...baseline,production:{lock:doc.production.lock,sceneNumbers:baseline.production?.sceneNumbers}};
    const before=P.layout(issued,options),after=P.layout(doc,options),old=new Map(before.pages.filter(p=>p.kind==='script').map(p=>[label(p),p]));
    // Compare visible payloads, excluding bookkeeping fields and timestamps.
    const signature=(p,d)=>JSON.stringify(stable({omitted:!!p.omitted,title:d.title,headerFooter:d.headerFooter,settings:d.settings,watermark:d.watermark,revision:d.revision,elements:elementSignatures(d),parts:P.pageParagraphs(p).map(b=>({id:key(b.paragraph),type:b.type,content:content(b.html??b.paragraph.html),revision:b.paragraph.revision,number:b.sceneNumber,font:b.font,geometry:b.geometry,lineCount:b.lineCount,before:b.before,alignment:b.paragraph.alignment,spacing:b.paragraph.spacing}))}));
    const changed=after.pages.filter(p=>p.kind==='script'&&(!old.has(label(p))||signature(p,doc)!==signature(old.get(label(p)),issued)));
    const missing=[...old.keys()].filter(k=>!after.pages.some(p=>p.kind==='script'&&label(p)===k));
    const comparable=d=>{const scenes=new Map(M.getScenes(d).map(s=>[key(s.id),s]));return new Map(d.paragraphs.map(p=>{const value=paragraphSignature(p),s=scenes.get(key(p));if(s)value.scene={...value.scene,color:s.color,number:s.number};return [key(p),JSON.stringify(stable(value))];}));};
    const previous=comparable(baseline),current=comparable(doc);
    const counts={added:0,removed:0,changed:0,moved:0};for(const[id,value]of current)if(!previous.has(id))counts.added++;else if(value!==previous.get(id))counts.changed++;for(const id of previous.keys())if(!current.has(id))counts.removed++;
    const notices=missing.map(k=>({...old.get(k),blocks:[],lineCount:0,label:k,omitted:true,withdrawn:true}));
    const order=s=>{const[,base,suffix]=s.match(/^(\d+)([A-Z]*)$/)||[];let n=0;for(const c of suffix||'')n=n*26+c.charCodeAt(0)-64;return [Number(base)||0,n];};
    const packet=[...changed,...notices].sort((a,b)=>{const x=order(label(a)),y=order(label(b));return x[0]-y[0]||x[1]-y[1];});
    const rows=packet.map(p=>({page:label(p),omitted:!!p.omitted,scenes:[...new Set(P.pageParagraphs(p).map(b=>M.getSceneForParagraph(doc,b.paragraph.id)?.number).filter(Boolean))]}));
    return {pages:packet,rows,removedPages:missing,counts,summary:`Revision packet: ${doc.title}\nIssued: ${doc.production.revisionBaseline?.createdAt||doc.production.issuedAt}\nChanged pages: ${rows.map(r=>r.page+(r.omitted?' (OMITTED)':'')).join(', ')||'none'}\nWithdrawn insertion pages: ${missing.join(', ')||'none'}\n${rows.map(r=>`Page ${r.page}: scenes ${r.scenes.join(', ')||'none'}`).join('\n')}\nParagraph changes: ${JSON.stringify(counts)}`};
  }
  const categories=['cast','props','costumes','locations','vehicles','effects'];
  function tag(doc,paragraphId,category,name){
    if(!categories.includes(category)||!String(name).trim())throw new Error('Choose a breakdown category and label.');
    const next=clone(doc),p=next.paragraphs.find(p=>key(p)===key(paragraphId));if(!p)throw new Error('The referenced paragraph no longer exists.');
    const normalized={cast:'cast',props:'props',costumes:'wardrobe',locations:'locations',vehicles:'vehicles',effects:'sfx'}[category];
    p.tags||=[];if(!p.tags.some(t=>t.category===normalized&&t.label===name.trim()))p.tags.push({id:M.uid('tag'),category:normalized,label:name.trim()});return next;
  }
  function breakdown(doc,options){
    const layout=P.layout(doc,options),rows=[];
    for(const p of doc.paragraphs) for(const tag of p.tags||[]){
      const scene=M.getSceneForParagraph(doc,p.id);if(scene?.omit)continue;
      rows.push({category:tag.category,label:tag.label||String(tag),scene:scene?.number||'',heading:scene?.heading||'',pages:layout.pages.filter(page=>P.pageParagraphs(page).some(b=>key(b.paragraph)===key(p))).map(label).join(', '),paragraphId:key(p)});
    }return rows;
  }
  function csv(rows){if(!rows.length)return '';const columns=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';return '\uFEFF'+[columns,...rows.map(r=>columns.map(c=>r[c]))].map(r=>r.map(cell).join(',')).join('\r\n');}
  function handoff(doc,kind,filter='',options){
    const wanted=filter.trim().toUpperCase(),layout=P.layout(doc,options),lines=[`${doc.title} — ${kind}`],ids=new Set();
    const pageFor=p=>layout.pages.filter(pg=>P.pageParagraphs(pg).some(b=>key(b.paragraph)===key(p))).map(label).join(',');
    for(const scene of M.getScenes(doc)){
      if(scene.omit)continue;const ps=doc.paragraphs.slice(scene.startIndex,scene.endIndex);
      const has=ps.some(p=>p.type==='Character'&&text(p).replace(/\s*\([^)]*\)\s*$/,'').trim().toUpperCase()===wanted);
      if(kind==='character sides'&&!has)continue;
      if(kind==='location scenes'&&!scene.location.toUpperCase().includes(wanted))continue;
      lines.push(`\nSCENE ${scene.number} · ${scene.heading} · pages ${pageFor(ps[0])}`);
      let speaker='';
      for(const p of ps){if(p.type==='Character')speaker=text(p);
        const include=kind!=='dialogue only'&&kind!=='shots'||(kind==='dialogue only'&&['Character','Dialogue','Parenthetical'].includes(p.type))||(kind==='shots'&&p.type==='Shot');
        if(include){ids.add(key(p));lines.push(`${p.type==='Shot'?'SHOT: ':''}${text(p)}${kind==='shots'?` [page ${pageFor(p)}]`:''}`);}
      }
    }return {text:lines.join('\n'),paragraphIds:[...ids]};
  }
  function preflight(doc,layout,environment={}){
    const issues=[],add=(code,message,page,severity='error')=>issues.push({code,message,page,severity});
    const g=doc.page;if(![g.width,g.height,g.top,g.bottom,g.left,g.right].every(v=>Number.isFinite(Number(v)))||g.width<=g.left+g.right||g.height<=g.top+g.bottom||g.width<3||g.height<3)add('page-size','Page size and margins do not leave a printable area.');
    const omitted=new Set();
    for(const scene of M.getScenes(doc))if(scene.omit){for(let i=scene.startIndex;i<scene.endIndex;i++)omitted.add(i);}
    const visible=new Map();
    for(const page of layout.pages)for(const block of P.pageParagraphs(page)){
      const id=block.paragraph.id;
      if(!visible.has(id))visible.set(id,[]);
      visible.get(id).push(P.plainText(block.html??block.paragraph.html));
    }
    for(const [index,p] of doc.paragraphs.entries()){
      const expected=P.plainText(p.html).replace(/\s/g,'');
      if(omitted.has(index)||!expected)continue;
      const parts=visible.get(p.id);
      if(!parts)add('missing-text',`Missing paragraph: ${text(p).slice(0,80)}`);
      if((parts||[]).join('').replace(/\s/g,'')!==expected)add('text-coverage',`Text coverage differs: ${text(p).slice(0,60)}`);
    }
    for(const pg of layout.pages.filter(p=>p.kind==='script')){
      if(pg.lineCount>layout.contentHeight+0.1)add('overflow','Text exceeds the printable page height.',label(pg));
      for(const b of P.pageParagraphs(pg)){const spec=M.elementSpec(b.type,doc);if(Number(spec.right)>g.width||Number(spec.right)<=Number(spec.left))add('horizontal-overflow',`Invalid ${b.type} element width.`,label(pg));}
    }
    for(const font of environment.missingFonts||[])add('font',`Unavailable font: ${font}`,undefined,'warning');
    for(const r of doc.revision.history||[])if(!/^#[0-9a-f]{6}$/i.test(r.hex||''))add('revision-color',`Invalid revision color: ${r.name}`);
    for(const item of environment.domIssues||[])add('rendered-overflow',item);
    return {ok:!issues.some(i=>i.severity==='error'),issues,pageCount:layout.pages.length,pageSize:{width:g.width,height:g.height}};
  }
  function exportText(doc,format='fountain'){
    if(format==='structured')return '# Azkript structured screenplay v1\n'+doc.paragraphs.map(p=>p.type+'\t'+JSON.stringify(text(p))).join('\n');
    const issued = Object.keys(doc.production?.sceneNumbers || {}).length > 0;
    const numbers = new Map(M.getScenes(doc)
      .filter(scene => issued || scene.paragraph.scene?.number)
      .map(scene => [scene.id, scene.number]));
    const rendered=doc.paragraphs.map(p=>{
      const s=text(p),safe=s.replace(/([\\*_\[\]])/g,'\\$1');
      if(p.type==='Scene Heading')return '.'+safe+(numbers.has(p.id)?` #${numbers.get(p.id)}#`:'');
      if(p.type==='Character')return '@'+safe+(p.dualSide===1?' ^':'');
      if(p.type==='Parenthetical')return /^\(.*\)$/.test(safe)?safe:`(${safe})`;
      if(p.type==='Transition')return '>'+safe;
      if(p.type==='Lyrics')return '~'+safe;
      if(p.type==='Dialogue')return safe || '  ';
      if(p.type==='Action' && p.alignment==='center')return `>${safe}<`;
      return '!'+safe;
    });
    return `Title: ${doc.title.replace(/\n/g,' ')}\nAuthor: ${doc.author.replace(/\n/g,' ')}\n\n`+rendered.map((line,i)=>((i&&['Dialogue','Parenthetical'].includes(doc.paragraphs[i].type)&&['Character','Dialogue','Parenthetical'].includes(doc.paragraphs[i-1].type))?'\n':i?'\n\n':'')+line).join('');
  }
  function importText(source,format='fountain'){
    if(source.length>5e6)throw new Error('Text imports are limited to 5 MB.');
    const doc=M.blankDocument(),warnings=[];doc.paragraphs=[];doc.titlePage.enabled=false;
    const add=(type,s)=>{if(!Object.hasOwn(M.ELEMENTS,type)){if(['__proto__','constructor','prototype'].includes(type)||type.length>100)throw new Error('Invalid element type.');doc.elements[type]={...M.ELEMENTS.Action,label:type};}const p=M.makeParagraph(type,s);p.html=p.html.replace(/\n/g,'<br>');doc.paragraphs.push(p);};
    if(format==='structured'){
      const lines=source.replace(/\r/g,'').split('\n');if(lines.shift()!=='# Azkript structured screenplay v1')throw new Error('Missing structured screenplay header.');
      for(const line of lines){if(!line)continue;const at=line.indexOf('\t');if(at<1)throw new Error('Invalid structured paragraph.');const value=JSON.parse(line.slice(at+1));if(typeof value!=='string')throw new Error('Paragraph text must be a string.');add(line.slice(0,at),value);}
    }else{
      let dialogue=false,previousCue=null,inComment=false;const lines=source.replace(/\r\n?/g,'\n').split('\n');let i=0;
      while(i<lines.length&&/^(Title|Author|Credit|Source|Draft date|Contact):/i.test(lines[i])){const at=lines[i].indexOf(':');const field=lines[i].slice(0,at).toLowerCase();if(field==='title'||field==='author')doc[field]=lines[i].slice(at+1).trim();i++;}
      for(;i<lines.length;i++){
        let s=lines[i].trim();
        if(!s){
          if(dialogue && lines[i] === '  '){
            add('Dialogue','');
            const cue=doc.paragraphs[previousCue];
            if(cue?.dualSide===1)Object.assign(doc.paragraphs.at(-1),{dualGroup:cue.dualGroup,dualSide:1});
          }else dialogue=false;
          continue;
        }
        if(s.startsWith('/*'))inComment=true;if(inComment){if(s.includes('*/'))inComment=false;warnings.push('Boneyard text omitted.');continue;}
        if(/^(#|=|\[\[)/.test(s)){warnings.push('Outline or note line omitted: '+s.slice(0,80));dialogue=false;previousCue=null;continue;}
        const unescape=v=>v.replace(/\\([\\*_\[\]])/g,'$1');let type;
        const separated=!lines[i-1]?.trim()&&!lines[i+1]?.trim();
        const centered=s.startsWith('>')&&s.endsWith('<');
        if(s[0]==='!'){type='Action';s=s.slice(1);dialogue=false;}
        else if(/^\.(?!\.)/.test(s)||/^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E)\s*\./i.test(s)){type='Scene Heading';if(s[0]==='.')s=s.slice(1);dialogue=false;}
        else if(centered){type='Action';s=s.slice(1,-1).trim();dialogue=false;}
        else if(s[0]==='>' || (separated && /^[A-Z0-9 ]+ TO:$/.test(lines[i]))){type='Transition';if(s[0]==='>')s=s.slice(1).trim();dialogue=false;}
        else if(s[0]==='~'){type='Lyrics';s=s.slice(1);dialogue=false;}
        else if(s[0]==='@'||(/^[A-Z][A-Z0-9 .'’\-]{0,60}(?:\s*\([^)]*\))?(?:\s*\^)?$/.test(s)&&lines[i+1]?.trim()&&!lines[i-1]?.trim())){type='Character';if(s[0]==='@')s=s.slice(1);dialogue=true;}
        else if(dialogue&&/^\(.*\)$/.test(s))type='Parenthetical';
        else type=dialogue?'Dialogue':'Action';
        const dual=type==='Character'&&s.endsWith('^');
        if(dual)s=s.slice(0,-1).trimEnd();
        const number=type==='Scene Heading'?s.match(/\s+#([^#]+)#$/):null;if(number)s=s.slice(0,number.index);
        add(type,unescape(s));const p=doc.paragraphs.at(-1);if(number)p.scene.number=number[1];
        if(centered)p.alignment='center';
        if(type==='Character'){
          const cue=doc.paragraphs[previousCue];
          if(dual && cue && !cue.dualGroup && doc.paragraphs.length > previousCue + 2){
            const group=M.uid('dual');
            for(let n=previousCue;n<doc.paragraphs.length-1;n++)Object.assign(doc.paragraphs[n],{dualGroup:group,dualSide:0});
            Object.assign(p,{dualGroup:group,dualSide:1});
          }else if(dual)warnings.push('A dual dialogue cue had no preceding unpaired speech.');
          previousCue=doc.paragraphs.length-1;
        }else if(dialogue && doc.paragraphs[previousCue]?.dualSide===1){
          Object.assign(p,{dualGroup:doc.paragraphs[previousCue].dualGroup,dualSide:1});
        }else if(!dialogue)previousCue=null;
      }
      if(inComment)warnings.push('Unclosed boneyard comment.');warnings.push('Fountain emphasis is imported as literal text; review inferred elements before applying.');
    }
    if(!doc.paragraphs.length)throw new Error('No screenplay paragraphs were found.');
    return {doc:M.normalizeDocument(doc),warnings:[...new Set(warnings)],elements:doc.paragraphs.map(p=>({type:p.type,text:text(p)}))};
  }
  function readPlan(doc){
    const settings=doc.production?.read||{},rate=Math.max(60,Math.min(300,Number(settings.wordsPerMinute)||150)),items=[],scenes=[];
    const overrides=Object.entries(settings.pronunciations||{}).filter(([a])=>a).sort((a,b)=>b[0].length-a[0].length);
    const spoken=s=>{if(!overrides.length)return s;const pattern=new RegExp(overrides.map(([a])=>a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');return s.replace(pattern,match=>settings.pronunciations[match]);};
    const allScenes=M.getScenes(doc);if(!allScenes.length||allScenes[0].startIndex>0)allScenes.unshift({number:'Front matter',heading:'Unscened paragraphs',startIndex:0,endIndex:allScenes[0]?.startIndex??doc.paragraphs.length});
    for(const scene of allScenes){if(scene.omit)continue;let speaker='Narrator',seconds=0;
      for(const p of doc.paragraphs.slice(scene.startIndex,scene.endIndex)){if(p.type==='Character'){speaker=text(p).replace(/\s*\([^)]*\)\s*$/,'').trim().toUpperCase();continue;}if(!['Dialogue','Action','Scene Heading','Parenthetical'].includes(p.type))continue;
        const who=p.type==='Dialogue'||p.type==='Parenthetical'?speaker:'Narrator',value=spoken(text(p));
        const profile={...(settings.profiles?.[who]||{})},speed=Math.max(0.5,Math.min(2,(Number(profile.rate)||1)*rate/150));profile.rate=speed;
        const duration=value.split(/\s+/).filter(Boolean).length/(150*speed)*60+0.5;
        items.push({paragraphId:p.id,scene:scene.number,speaker:who,text:value,seconds:duration,profile});seconds+=duration;
      }scenes.push({scene:scene.number,heading:scene.heading,seconds:Math.round(seconds)});
    }return {items,scenes,seconds:Math.round(items.reduce((n,i)=>n+i.seconds,0))};
  }
  function comment(doc,scope,body,author,role='commenter'){
    const next=clone(doc);if(!['commenter','approver','owner'].includes(role))throw new Error('This review role cannot comment.');
    if(!body.trim()||!author.trim())throw new Error('Enter a reviewer name and comment.');
    if(scope.paragraphId&&!next.paragraphs.some(p=>key(p)===key(scope.paragraphId)))throw new Error('The comment reference is missing.');
    next.production.review||={comments:[]};next.production.review.comments.push({id:M.uid('comment'),paragraphId:scope.paragraphId?key(scope.paragraphId):'',quote:String(scope.quote||''),body:body.trim(),author:author.trim(),createdAt:new Date().toISOString(),resolved:false});
    delete next.production.review.approval;return next;
  }
  function fingerprint(doc){doc=M.normalizeDocument(doc);const scenes=new Map(M.getScenes(doc).map(s=>[key(s.id),s]));return JSON.stringify(stable({paragraphs:doc.paragraphs.map(p=>{const s=paragraphSignature(p),scene=scenes.get(key(p));if(scene)s.scene={...s.scene,color:scene.color,number:scene.number};return s;}),title:doc.title,author:doc.author,page:doc.page,titlePage:doc.titlePage,revision:doc.revision,headerFooter:doc.headerFooter,settings:doc.settings,elements:elementSignatures(doc),watermark:doc.watermark,nativeMetadata:doc.nativeMetadata,sceneNumbers:Object.keys(doc.production.sceneNumbers||{}).length?Object.fromEntries([...scenes.values()].map(s=>[key(s.id),s.number])):{}}));}
  function approve(doc,author,role){if(!['owner','approver'].includes(role))throw new Error('Choose an approver or owner role.');if(!author.trim())throw new Error('Enter an approver name.');const next=clone(doc);next.production.review||={comments:[]};if(next.production.review.comments.some(c=>!c.resolved))throw new Error('Resolve open comments before approving.');next.production.review.approval={author:author.trim(),createdAt:new Date().toISOString(),fingerprint:fingerprint(next)};return next;}
  function approvalValid(doc){return doc.production?.review?.approval?.fingerprint===fingerprint(doc);}
  function reviewCopy(doc){const next=clone(doc);next.documentId=M.toUuid(M.uid('review'));next.sourceFDX=null;next.nativeMetadata=[];next.workspaceNotes=[];next.story={};next.bookmarks=[];next.cast={};next.beats=[];next.production={};for(const p of next.paragraphs){delete p.note;p.tags=[];delete p.alts;delete p.trackedOriginal;if(p.scene){p.scene.notes='';p.scene.synopsis='';}}return next;}
  function invite(doc,role){
    if(!['reader','commenter','approver'].includes(role))throw new Error('Invalid review permission.');
    const next=clone(doc);next.production.review||={comments:[]};next.production.review.invitations||=[];
    const token=M.toUuid(M.uid('invite'))+M.toUuid(M.uid('secret')),draft=reviewCopy(doc),issued=fingerprint(doc);
    const invitation={token,role,fingerprint:issued,copyFingerprint:fingerprint(draft)};next.production.review.invitations.push(invitation);
    return {doc:next,packet:{kind:'azkript-review',version:1,token,role,draft,fingerprint:invitation.copyFingerprint}};
  }
  function validatePacket(packet){if(packet?.kind!=='azkript-review'||packet.version!==1||!['reader','commenter','approver'].includes(packet.role)||typeof packet.token!=='string'||!packet.draft?.paragraphs||fingerprint(M.normalizeDocument(packet.draft))!==packet.fingerprint)throw new Error('Invalid or modified review packet.');}
  function respond(packet,response){validatePacket(packet);if(!response.author?.trim())throw new Error('Enter your reviewer name.');if(packet.role==='reader'&&(response.body?.trim()||response.approve))throw new Error('Read-only review cannot comment or approve.');if(response.approve&&packet.role!=='approver')throw new Error('This invitation cannot approve drafts.');return {kind:'azkript-response',version:1,token:packet.token,copyFingerprint:packet.fingerprint,author:response.author.trim(),body:String(response.body||'').trim(),paragraphId:response.paragraphId?key(response.paragraphId):'',approve:!!response.approve};}
  function applyResponse(doc,response){
    if(response?.kind!=='azkript-response'||response.version!==1)throw new Error('Invalid review response.');
    const invite=doc.production?.review?.invitations?.find(i=>i.token===response.token);
    if(!invite||invite.used)throw new Error('Unknown or already consumed review invitation.');
    if(invite.fingerprint!==fingerprint(doc)||invite.copyFingerprint!==response.copyFingerprint)throw new Error('This response belongs to a different or changed draft.');
    if(invite.role==='reader'&&(response.body||response.approve))throw new Error('Read-only invitation cannot change review data.');
    if(response.approve&&invite.role!=='approver')throw new Error('Invitation does not grant draft approval.');
    if(typeof response.author!=='string'||!response.author.trim()||typeof response.body!=='string')throw new Error('Invalid response fields.');
    let next=response.body?comment(doc,{paragraphId:response.paragraphId},response.body,response.author,invite.role):clone(doc);
    if(response.approve)next=approve(next,response.author,'approver');
    next.production.review.invitations.find(i=>i.token===response.token).used=true;return next;
  }
  return {lock,numberScenes,revisions,revisionBaseline,categories,tag,breakdown,csv,handoff,preflight,exportText,importText,readPlan,comment,approve,approvalValid,reviewCopy,fingerprint,invite,validatePacket,respond,applyResponse};
});
