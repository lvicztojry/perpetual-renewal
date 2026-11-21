import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const port=3218,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{
 windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AUTH_MODE:'local-email',RENEWAL_REPOSITORY:'memory',DATABASE_URL:'',DATABASE_URL_UNPOOLED:'',
 LLM_API_KEY:'',LLM_BASE_URL:'',LLM_MODEL:'',VOICE_API_KEY:'',VOICE_PROVIDER:'shared-llm',LLM_PROVIDER:'compatible',AUTH_APP_URL:base,
 SESSION_COOKIE_SECRET:'example-native-session-test-signing-value',USER_KEY_VAULT_SECRET:'example-native-vault-test-signing-value',NEXT_TELEMETRY_DISABLED:'1'}
});
let output='';server.stdout.on('data',b=>{output=(output+b).slice(-12000);});server.stderr.on('data',b=>{output=(output+b).slice(-12000);});
const state={client:null,epoch:0,drafts:{},foreground:true};
const tempRoot=path.resolve('.tmp-miniprogram-qa');mkdirSync(tempRoot,{recursive:true});
global.getApp=()=>state;
let definition;
global.Page=value=>{definition=value;};
global.wx={
 request(options){fetch(options.url,{method:options.method,headers:options.header,body:['GET','HEAD'].includes(options.method)?undefined:JSON.stringify(options.data)}).then(async r=>options.success({statusCode:r.status,header:Object.fromEntries(r.headers),cookies:r.headers.getSetCookie(),data:await r.json()})).catch(e=>options.fail(e));},
 showModal(options){options.success({confirm:true});},navigateTo(){},navigateBack(){},reLaunch(){},pageScrollTo(){},
 env:{USER_DATA_PATH:tempRoot},getFileSystemManager(){return {writeFile(o){try{writeFileSync(o.filePath,o.data,o.encoding);o.success({});}catch(e){o.fail(e);}}};},shareFileMessage(o){o.success({});}
};
function assignPath(object,key,value){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=object;for(const part of parts.slice(0,-1)){target[part]??={};target=target[part];}target[parts.at(-1)]=value;}
function nativePage(name,params={}){
 const file=path.resolve(`miniprogram/pages/${name}/index.js`);delete require.cache[file];require(file);
 const instance={...definition,data:structuredClone(definition.data),params,alive:true,visible:true,version:0,setData(update){for(const[key,value]of Object.entries(update))assignPath(this.data,key,value);}};
 return instance;
}
function noError(page){assert.equal(page.data.error,'',page.data.error);}
async function ready(){const until=Date.now()+90000;while(Date.now()<until){if(server.exitCode!==null)throw new Error('Isolated Next exited');try{const r=await fetch(base+'/api/companions');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,400));}throw new Error('Isolated Next timed out');}
try{
 await ready();
 const {createClient}=require('../miniprogram/utils/client');state.client=createClient(base);
 await state.client.request('/api/auth/login','POST',{email:'native-qa@example.com'});
 const home=nativePage('home');await home.refresh();
 const person=nativePage('companion');person.data.form={...person.data.form,name:'原生测试人物',speakingStyle:'自然简短地说话'};await person.save();noError(person);assert.ok(person.data.person.id);
 const companionId=person.data.person.id;
 const chat=nativePage('chat',{id:companionId});await chat.init(chat.params);chat.data.draft='我喜欢雨天散步，这是一次隔离测试。';await chat.send();noError(chat);assert.ok(chat.data.messages.some(m=>m.role==='assistant'));
 const incoming=chat.data.messages.find(m=>m.role==='assistant');
 await chat.messageAction({currentTarget:{dataset:{id:incoming.id,action:'set_important'}}});noError(chat);
 await chat.messageAction({currentTarget:{dataset:{id:incoming.id,action:'regenerate'}}});noError(chat);
 const memories=nativePage('memories',{id:companionId});await memories.init();memories.data.form.content='用户喜欢雨天散步';await memories.save();noError(memories);assert.ok(memories.data.memories.length);
 const memory=memories.data.memories[0];memories.select({currentTarget:{dataset:{id:memory.id}}});memories.data.form.status='active';await memories.save();noError(memories);
 const active=memories.data.memories.find(m=>m.id===memory.id);memories.select({currentTarget:{dataset:{id:active.id}}});await memories.history();noError(memories);
 const dream=nativePage('dream',{id:companionId});await dream.init();await dream.start();noError(dream);dream.data.message='假设我今天很累，你会说什么？';await dream.generate();noError(dream);assert.ok(dream.data.state.rounds.length);
 const round=dream.data.state.rounds[0];dream.data.roundId=round.id;dream.data.choiceId=round.choices[0].id;dream.data.correction='先接住我的话，不要立刻给建议';await dream.feedback();noError(dream);
 if(dream.data.fragments[0])dream.data.fragments[0].confirmed=true;await dream.apply();noError(dream);assert.equal(dream.data.state.status,'applied');
 const group=nativePage('groups');await group.init({});group.data.form={name:'隔离测试群',background:'测试用群'};group.data.selectedIds=[companionId];await group.save();noError(group);
 group.data.draft='大家好，今天想聊聊散步。';await group.send();noError(group);assert.ok(group.data.group.messages.some(m=>m.speakerId));
 await group.api('groups/'+group.params.id,'POST',{action:'message',content:'断线恢复测试',clientId:'native_reconnect_test',mentionIds:[]});
 await group.loadGroup();assert.ok(group.data.progress.speakers.length);await group.resume();noError(group);assert.equal(group.data.progress.speakers.length,0);
 group.editGroup();group.data.form.background='更新群背景';await group.save();noError(group);assert.equal(group.data.group.background,'更新群背景');
 group.data.sourceIds=[group.data.group.messages[0].id];group.data.knownBy=[companionId];group.data.memoryText='大家在群里聊过散步';await group.remember();noError(group);assert.equal(group.data.group.memories.length,1);
 await group.exportGroup();noError(group);
 const settings=nativePage('settings');await settings.init();settings.data.form.nickname='原生测试昵称';await settings.saveProfile();noError(settings);await settings.exportData();noError(settings);
 settings.data.model={provider:'compatible',baseUrl:'http://127.0.0.1:9',model:'example-model',apiKey:'example-local-test-credential'};await settings.saveModel();noError(settings);assert.equal(settings.data.model.apiKey,'');assert.ok(settings.data.credential.configured);await settings.deleteModel();noError(settings);
 const importer=nativePage('importer');importer.data.text='我：你好\n朋友：你好呀\n我：今天怎么样\n朋友：还不错';await importer.parse();noError(importer);importer.data.target='朋友';importer.data.self='我';await importer.sample();noError(importer);assert.ok(importer.data.sample.length);
 await importer.analyze();noError(importer);assert.ok(importer.data.draft);importer.data.previewText='你好';await importer.preview();noError(importer);assert.ok(importer.data.history.length);await importer.create();noError(importer);
 await state.client.request('/api/sync/read','POST',{scope:'private',threadId:chat.data.person.conversationId,messageIds:chat.data.messages.filter(m=>m.role==='assistant').map(m=>m.id)});
 const isolated=createClient(base);await isolated.request('/api/auth/login','POST',{email:'other-native-qa@example.com'});
 await assert.rejects(isolated.request('/api/groups/'+group.params.id));
 await assert.rejects(isolated.request('/api/companions/'+companionId+'/dream'));
 await home.refresh();assert.ok(home.data.companions.some(p=>p.id===companionId));
 const originalApi=chat.api;chat.data.draft='失败时保留草稿';chat.api=async()=>{throw new Error('模拟网络中断');};await chat.send();assert.equal(chat.data.draft,'失败时保留草稿');assert.equal(chat.data.busy,false);assert.match(chat.data.error,/模拟网络中断/);chat.api=originalApi;
 console.log('Native page integration passed against isolated Next mock/memory server: people, chat, retry, memory, dream, groups, settings, file export, local transcript selection, character import and account isolation. No paid model or real user data.');
}catch(e){console.error(e);console.error('Isolated server tail (redacted):',output.replace(/(?:sk-|postgres(?:ql)?:\/\/)[^\s]+/g,'[redacted]').slice(-2000));process.exitCode=1;}
finally{
 if(server.exitCode===null && process.env.MINI_QA_STAY_OPEN!=='1'){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});else server.kill('SIGTERM');}
 if(process.env.MINI_QA_STAY_OPEN==='1') console.log('Isolated simulator QA server remains on '+base+'; PID '+server.pid+'. Stop this test process to finish QA.');
 delete global.Page;delete global.wx;delete global.getApp;
}
