// Runs only after explicit WechatIDE/Codex authorization and an isolated QA server.
/* global wx, getApp, getCurrentPages */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.env.WECHAT_DEVTOOLS_ROOT || 'D:/微信web开发者工具';
const project=path.resolve('miniprogram');
const entry=path.join(root,'resources/app.asar.unpacked/js/common/cli/skill-index.js');
const bootstrap="const e=process.argv[1],a=process.argv.slice(2);process.argv=[process.execPath,e,'--electron'].concat(a);require(e)";
function tool(name,args=[]){
 const r=spawnSync(path.join(root,'微信开发者工具.exe'),['-e',bootstrap,entry,'-c','Codex',name,'--project',project,...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:45000});
 if(r.error)throw r.error;
 const raw=r.stdout.slice(r.stdout.indexOf('{'));let value;try{value=JSON.parse(raw);}catch{throw new Error('Invalid WechatIDE response: '+r.stdout.slice(-1000));}
 if(!value.ok || value.result?.success===false)throw new Error(name+': '+(value.message || value.result.error));
 return value;
}
function evaluate(fn){let value=tool('automation_evaluate',['--fn-source',fn.toString()]);while(value?.result!==undefined)value=value.result;return value;}
if(process.argv.includes('--restore')){
 tool('automation_wx_api',['--action','restore','--method','showModal']);
 evaluate(async function(){if(wx.__nativeQAOriginalRequest){wx.request=wx.__nativeQAOriginalRequest;delete wx.__nativeQAOriginalRequest;}if(getApp().client)await getApp().client.logout();getApp().client=null;getApp().drafts={};getApp().epoch++;wx.reLaunch({url:'/pages/home/index'});return {restored:true};});
 console.log('Simulator restored to normal login.');
}else{
 tool('automation_wx_api',['--action','mock','--method','showModal','--result',JSON.stringify({confirm:true,cancel:false})]);
 tool('automation_navigate',['--action','reLaunch','--url','/pages/home/index']);
 const login=evaluate(async function(){
  const original=wx.__nativeQAOriginalRequest || wx.request;wx.__nativeQAOriginalRequest=original;
  wx.request=function(options){if(options.url==='http://127.0.0.1:3218/api/auth/login')options.data={email:'native-qa@example.com'};return original(options);};
  getApp().introSeen=true;const page=getCurrentPages().slice(-1)[0];page.setData({base:'http://127.0.0.1:3218',email:'native-qa@example.com',password:'example'});
  await page.login();return {loggedIn:page.data.loggedIn,error:page.data.error,people:page.data.companions.length};
 });
 assert.equal(login.error,'',login.error);assert.equal(login.loggedIn,true);assert.ok(login.people>0);
 const person=evaluate(function(){return getCurrentPages().slice(-1)[0].data.companions.find(p=>p.name==='原生测试人物').id;});
 const groupId=evaluate(function(){return getCurrentPages().slice(-1)[0].data.groups.find(g=>g.name==='隔离测试群').id;});
 tool('automation_navigate',['--action','navigateTo','--url','/pages/chat/index?id='+encodeURIComponent(person)]);
 const chat=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;p.setData({draft:'来自微信模拟器的隔离验收消息'});await p.send();return {name:p.data.person?.name,count:p.data.messages.length,error:p.data.error};});
 assert.equal(chat.error,'',chat.error);assert.ok(chat.name);assert.ok(chat.count>0);
 console.log('Simulator login and private chat passed.');
 tool('simulator_screenshot',['--path',path.resolve('.tmp-miniprogram-qa/wechat-chat.jpg')]);
 tool('automation_navigate',['--action','redirectTo','--url','/pages/groups/index?id='+encodeURIComponent(groupId)]);
 const group=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;p.setData({draft:'模拟器群聊接话测试'});await p.send();return {count:p.data.group.messages.length,incoming:p.data.group.messages.some(m=>!!m.speakerId),error:p.data.error};});
 assert.equal(group.error,'',group.error);assert.ok(group.incoming);
 console.log('Simulator group chat passed.');
 tool('simulator_screenshot',['--path',path.resolve('.tmp-miniprogram-qa/wechat-group.jpg')]);
 tool('automation_navigate',['--action','redirectTo','--url','/pages/memories/index?id='+encodeURIComponent(person)]);
 const memories=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;p.fresh();p.setData({'form.content':'模拟器验收记忆候选'});await p.save();return {count:p.data.memories.length,error:p.data.error};});
 assert.equal(memories.error,'',memories.error);assert.ok(memories.count>0);
 console.log('Simulator memory creation passed.');
 tool('automation_navigate',['--action','redirectTo','--url','/pages/dream/index?id='+encodeURIComponent(person)]);
 const dream=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;await p.action('start');p.setData({message:'假设我今天很累，你会怎么说？'});await p.generate();return {rounds:p.data.state.rounds.length,status:p.data.state.status,error:p.data.error};});
 assert.equal(dream.error,'',dream.error);assert.ok(dream.rounds>0);
 console.log('Simulator dream generation passed.');
 tool('simulator_screenshot',['--path',path.resolve('.tmp-miniprogram-qa/wechat-dream.jpg')]);
 tool('automation_navigate',['--action','redirectTo','--url','/pages/settings/index']);
 const settings=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;return {nickname:p.data.form.nickname,status:p.data.status.length,error:p.data.error};});
 assert.equal(settings.error,'',settings.error);assert.ok(settings.status>0);
 console.log('Simulator settings passed.');
 tool('automation_navigate',['--action','redirectTo','--url','/pages/importer/index']);
 const importer=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;p.setData({text:'我：你好\n朋友：你好呀\n我：今天怎样\n朋友：很好呀'});await p.parse();p.setData({target:'朋友',self:'我'});await p.sample();await p.analyze();return {samples:p.data.sample.length,draft:!!p.data.draft,error:p.data.error};});
 assert.equal(importer.error,'',importer.error);assert.ok(importer.samples>0);assert.equal(importer.draft,true);
 tool('automation_navigate',['--action','redirectTo','--url','/pages/echoes/index']);
 const echoes=evaluate(async function(){const p=getCurrentPages().slice(-1)[0];if(p.initialization)await p.initialization;p.setData({muted:true});p.play({currentTarget:{dataset:{kind:'dream'}}});const result={story:p.data.story.length,playing:p.data.playing,error:p.data.error};p.skip();return result;});
 assert.equal(echoes.error,'',echoes.error);assert.ok(echoes.story>5);assert.equal(echoes.playing,true);
 console.log('Wechat simulator passed actual runtime login, HTTP/cookies, private and group messages, memory creation, dream generation, settings, local transcript selection/analysis and story/animation controls against isolated QA server.');
}
