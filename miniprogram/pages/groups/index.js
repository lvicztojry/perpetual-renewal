/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { page, app, id, confirm, saveFile } = require('../../utils/runtime');
const { field } = require('../../utils/schema');
const settings = [field('name','群名'),field('background','群背景','long'),field('proactiveEnabled','允许群内主动消息','boolean'),field('intervalMinutes','间隔（分钟）','number'),field('maxReplies','每轮最多发言人数','number'),field('autoChat','允许自行续聊','boolean'),field('maxAutoRounds','最多连续轮数','number'),field('quietStart','安静时段开始（HH:mm）'),field('quietEnd','安静时段结束（HH:mm）')];
page({
 data: { groups: [], group: null, people: [], members: [], form: {name:'',background:''}, schema: settings.slice(0,2), editing: false, draft:'', mentions:[], sourceIds:[], knownBy:[], memoryText:'', progress:null },
 async init(params) {
  const result = await this.api('companions'); this.setData({ people:result.companions });
  if(params.id) { this.setData({draft:app().drafts['group:'+params.id] || ''}); await this.loadGroup(); } else await this.refresh();
 },
 async refresh() {
  if(this.params.id) {
   await this.loadGroup();
   if(this.data.group.settings.proactiveEnabled && this.data.group.settings.autoChat && (!this.lastAutoCheck || Date.now()-this.lastAutoCheck>60000)) {
    this.lastAutoCheck=Date.now();
    const result=await this.api('groups/'+this.params.id,'POST',{action:'proactive'});
    if(result.speakers?.length) await this.deliver({turn:result.group.turn,speakers:result.speakers});
   }
  }
  else { const result = await this.api('groups'); this.setData({groups:result.groups}); }
 },
 async loadGroup() {
  const result = await this.api('groups/' + this.params.id);
  const names = Object.fromEntries(this.data.people.map(p => [p.id,p.name]));
  result.group.messages = result.group.messages.map(m => ({ ...m, name:m.speakerId ? names[m.speakerId] || '已移除人物' : '我' }));
  this.setData({group:result.group, progress:result.progress,groupPeople:this.data.people.filter(p=>result.group.members.some(m=>m.companionId===p.id))}); this.observeMessages();
 },
 show() { if(this.data.group) this.observeMessages(); },
 observeMessages() {
  if(this.observer) this.observer.disconnect();
  if(!this.visible || !this.data.group || !wx.createIntersectionObserver) return;
  this.marked ||= new Set();
  this.observer = wx.createIntersectionObserver(this,{observeAll:true,thresholds:[0.5]});
  this.observer.relativeTo('.history').observe('.incoming', r => {
   if(!this.visible || this.data.showMemory || this.data.showMentions || this.data.editing || r.intersectionRatio < 0.5 || this.marked.has(r.dataset.id)) return;
   this.marked.add(r.dataset.id);
   this.api('sync/read','POST',{scope:'group',threadId:this.params.id,messageIds:[r.dataset.id]}).catch(() => this.marked.delete(r.dataset.id));
  });
 },
 selectMembers(e) { this.setData({selectedIds:e.detail.value}); },
 input(e) { this.setData({[e.currentTarget.dataset.field]:e.detail.value}); if(e.currentTarget.dataset.field==='draft') app().drafts['group:'+this.params.id]=e.detail.value; },
 selectMentions(e) { this.setData({mentions:e.detail.value}); },
 selectSources(e) { this.setData({sourceIds:e.detail.value}); },
 selectKnown(e) { this.setData({knownBy:e.detail.value}); },
 editGroup() {
  const g = this.data.group;
  this.editRevision = g.revision;
  this.setData({editing:true,schema:settings,form:{name:g.name,background:g.background,...g.settings},members:this.data.people.map(p => ({companionId:p.id,name:p.name,selected:g.members.some(m => m.companionId===p.id),...(g.members.find(m => m.companionId===p.id) || {allowPrivateMemories:false,proactiveEnabled:true,relationship:''})}))});
 },
 memberChange(e) {
  const index = Number(e.currentTarget.dataset.index), key = e.currentTarget.dataset.key;
  this.setData({['members['+index+'].'+key]:e.detail.value});
 },
 cancelEdit() { this.setData({editing:false}); },
 save() { return this.run(async () => {
  const f = this.data.form;
  if(this.params.id) {
   const groupSettings = {}; for(const key of ['proactiveEnabled','intervalMinutes','maxReplies','autoChat','maxAutoRounds','quietStart','quietEnd']) groupSettings[key]=f[key];
   await this.api('groups/'+this.params.id,'POST',{action:'update',revision:this.editRevision,name:f.name,background:f.background,members:this.data.members.filter(m=>m.selected),settings:groupSettings});
   this.setData({editing:false}); await this.loadGroup();
  } else {
   const result = await this.api('groups','POST',{name:f.name,background:f.background,companionIds:this.data.selectedIds || []});
   this.params.id=result.group.id; this.setData({group:result.group,editing:false}); await this.loadGroup();
  }
 }); },
 async deliver(progress) {
  if(!progress) return;
  for(const speakerId of progress.speakers || []) {
   const result = await this.api('groups/'+this.params.id,'POST',{action:'reply',turn:progress.turn,speakerId});
   this.setData({group:result.group}); if(result.skipped) { this.setData({notice:'本轮暂停：'+result.skipped}); break; }
  }
  await this.loadGroup();
 },
 send() { return this.run(async () => {
  const content=this.data.draft.trim(); if(!content) return;
  if(!this.pending || this.pending.content!==content) this.pending={content,clientId:id(),mentionIds:this.data.mentions};
  const result=await this.api('groups/'+this.params.id,'POST',{action:'message',...this.pending});
  this.pending=null; delete app().drafts['group:'+this.params.id]; this.setData({group:result.group,draft:''});
  await this.deliver({turn:result.group.turn,speakers:result.speakers});
 }); },
 resume() { return this.run(async () => { await this.loadGroup(); await this.deliver(this.data.progress); }); },
 proactive() { return this.run(async () => {
  const result=await this.api('groups/'+this.params.id,'POST',{action:'proactive'});
  if(result.skipped) this.setData({notice:'当前未触发：'+result.skipped});
  await this.deliver({turn:result.group.turn,speakers:result.speakers});
 }); },
 remember() { return this.run(async () => {
  await this.api('groups/'+this.params.id,'POST',{action:'remember',revision:this.data.group.revision,content:this.data.memoryText,sourceMessageIds:this.data.sourceIds,knownBy:this.data.knownBy});
  this.setData({sourceIds:[],knownBy:[],memoryText:''}); await this.loadGroup();
 }); },
 forget(e) { return this.run(async () => { if(!await confirm('删除这条共同记忆？')) return; await this.api('groups/'+this.params.id,'POST',{action:'forget',revision:this.data.group.revision,memoryId:e.currentTarget.dataset.id}); await this.loadGroup(); }); },
 exportGroup() { return this.run(() => saveFile(this.data.group,'群聊导出.json')); },
 remove() { return this.run(async () => { if(!await confirm('删除群聊及其消息和共同记忆？')) return; await this.api('groups/'+this.params.id,'DELETE'); wx.navigateBack(); }); },
 refreshNow() { return this.run(() => this.refresh()); }
 ,togglePanel(e) {const field=e.currentTarget.dataset.field;if(['showMemory','showMentions','showBackground'].includes(field))this.setData({[field]:!this.data[field]});}
});
