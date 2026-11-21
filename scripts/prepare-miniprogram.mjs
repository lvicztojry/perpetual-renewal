import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const check=process.argv.includes('--check');
function output(file,content){if(check){if(!existsSync(file)||!readFileSync(file).equals(Buffer.from(content)))throw new Error('Generated mini program file is stale: '+file);}else{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,content);}}
const sources=['import/transcript','import/character-draft','renewal/types','http/response-safety','logging/sanitize'];
for(const source of sources){
 let code=ts.transpileModule(readFileSync('src/lib/'+source+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText;
 code=code.replace(/require\("@\/lib\/([^"\n]+)"\)/g,(_,ref)=>{if(!sources.includes(ref))throw new Error('Unreviewed client dependency: '+ref);let relative=path.posix.relative(path.posix.dirname(source),ref);if(!relative.startsWith('.'))relative='./'+relative;return 'require('+JSON.stringify(relative)+')';});
 output('miniprogram/vendor/'+source+'.js','/* Generated from src/lib/'+source+'.ts; run node scripts/prepare-miniprogram.mjs. */\n/* eslint-disable -- generated TypeScript output */\n/* eslint no-warning-comments: off */\n'+code);
}
const catalog=ts.transpileModule(readFileSync('src/lib/starters/catalog.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText;
output('miniprogram/vendor/starters.js','/* Generated; run node scripts/prepare-miniprogram.mjs. */\n/* eslint-disable */\n'+catalog);
const story=[...readFileSync('src/app/story/page.tsx','utf8').matchAll(/<(h1|h2|p)(?:\s[^>]*)?>([^<]+)<\/\1>/g)].map(m=>({kind:m[1],text:m[2]}));
output('miniprogram/vendor/story.json',JSON.stringify(story,null,2)+'\n');
output('miniprogram/vendor/story.js','/* Generated story content. */\nmodule.exports = '+JSON.stringify(story,null,2)+';\n');
const app=JSON.parse(readFileSync('miniprogram/app.json','utf8'));
for(const route of app.pages)output('miniprogram/'+route+'.json',JSON.stringify({navigationBarTitleText:'生生不息'},null,2)+'\n');
// Deterministic bronze bell PCM, following the original mode ratios and decay envelope.
const rate=16000,duration=6,modes=[[.5,.23,5.5],[1,.55,5],[1.19,.38,4.6],[1.5,.25,4],[2,.72,4.2],[2.76,.38,3.3],[4.07,.25,2.6],[5.43,.17,2],[8.21,.09,1.3],[12.17,.08,.8]];
for(const dream of [false,true]){
 const pcm=Buffer.alloc(44+rate*duration*2);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(rate,24);pcm.writeUInt32LE(rate*2,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40);
 let seed=0x531ea;
 for(let i=0;i<rate*duration;i++){let sum=0,t=i/rate;for(const delay of dream?[0]:[0,2.15]){const u=t-delay;if(u<0)continue;for(const [ratio,amplitude,decay]of modes){if(u>decay)continue;const gain=u<.002?u/.002:Math.exp(Math.log(.0001/amplitude)*(u-.002)/(decay-.002));const phase=2*Math.PI*73.416*ratio*(u+.006*.13*(1-Math.exp(-u/.13)));sum+=Math.sin(phase)*amplitude*gain;}seed=(Math.imul(seed,1664525)+1013904223)>>>0;if(u<.12)sum+=(seed/2147483648-1)*.3*Math.exp(-80*u);}sum=.85*.94*Math.tanh(sum*1.6)*Math.min(1,(duration-t)/.65);pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,sum))*32767),44+i*2);}
 output('miniprogram/assets/'+(dream?'dream':'bell')+'.wav',pcm);
}
console.log(check?'Mini program generated sources are current.':'Mini program shared logic, story, page configs and audio prepared.');
