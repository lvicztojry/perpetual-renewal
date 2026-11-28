/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { page, app, id, confirm, navigate } = require('../../utils/runtime');
const { attach } = require('../../utils/media');
page({
 data: { person: null, messages: [], draft: '', recording: false, playing: false, proactive: [], proactiveFilter:'all', showProactive:false },
 async init(params) {
  attach(this); this.marked = new Set();
  const { companion } = await this.api('companions/' + encodeURIComponent(params.id));
  this.setData({ person: companion, draft: app().drafts['private:' + params.id] || '' });
  await this.refresh();
 },
 show() { if(this.data.person) this.observeMessages(); },
 input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); app().drafts['private:' + this.params.id] = this.data.draft; },
 async refresh() {
  if (!this.data.person) return;
  // 轮询与发送可能同时请求历史；只让最新一次结果落地，避免旧响应把刚发出的消息抹掉。
  const token = this.refreshToken = (this.refreshToken || 0) + 1;
  const result = await this.api('conversations/' + encodeURIComponent(this.data.person.conversationId) + '/messages');
  if (token !== this.refreshToken) return;
  const messages = result.messages.filter(m => !m.metadata?.deletedAt && !m.metadata?.hidden).map(m => ({ ...m, time: m.createdAt.slice(0,16).replace('T',' '), failed: m.metadata?.status === 'failed', important: !!m.metadata?.important }));
  // 轮询每 5 秒回来一次；内容没变就不要 setData，否则列表重渲染会把滚动位置顶回去。
  const signature = messages.map(m => m.id + ':' + m.content + ':' + (m.important ? 1 : 0)).join('|');
  if (signature !== this.messageSignature) {
   this.messageSignature = signature;
   this.setData({ messages });
   this.observeMessages();
  }
  this.checkProactive();
 },
 checkProactive() {
  if (!this.data.person.proactiveMessagesEnabled) return;
  if (this.proactiveBusy) return;
  if (this.lastProactive && Date.now() - this.lastProactive < 60000) return;
  this.proactiveBusy = true;
  this.lastProactive = Date.now();
  // 生成草稿可能耗时十几秒；走 background，不占用轮询锁，也不拖住对话。
  this.background(async () => {
   await this.api('companions/' + this.params.id + '/proactive-drafts','POST',{});
   const drafts = await this.api('companions/' + this.params.id + '/proactive-drafts');
   this.setData({ proactive: drafts.data, availability:drafts.availability });
  }).finally(() => { this.proactiveBusy = false; });
 },
 observeMessages() {
  if(this.observer) this.observer.disconnect();
  if(!this.visible || !wx.createIntersectionObserver) return;
  this.observer = wx.createIntersectionObserver(this, { observeAll: true, thresholds: [0.5] });
  this.observer.relativeTo('.history').observe('.incoming', r => {
   if(!this.visible || this.data.showProactive || app().foreground === false || r.intersectionRatio < 0.5 || this.marked.has(r.dataset.id)) return;
   const message = this.data.messages.find(m => m.id === r.dataset.id);
   if(!message || message.failed) return;
   this.marked.add(message.id);
   this.api('sync/read','POST',{ scope:'private', threadId:this.data.person.conversationId, messageIds:[message.id] }).catch(() => this.marked.delete(message.id));
  });
 },
 send() { return this.run(async () => {
  const content = this.data.draft.trim(); if(!content) return;
  const key = 'private:' + this.params.id;
  const pending = app().drafts[key + ':pending'];
  const clientMessageId = pending && pending.content === content ? pending.id : id();
  app().drafts[key + ':pending'] = { id: clientMessageId, content };
  await this.api('conversations/' + this.data.person.conversationId + '/messages','POST',{ content, clientMessageId });
  this.setData({ draft: '' }); delete app().drafts[key]; delete app().drafts[key + ':pending']; await this.refresh();
 }); },
 messageAction(e) { return this.run(async () => {
  const message = this.data.messages.find(m => m.id === e.currentTarget.dataset.id), action = e.currentTarget.dataset.action;
  const path = 'conversations/' + this.data.person.conversationId + '/messages';
  if(action === 'delete') { if(!await confirm('删除这条消息？')) return; await this.api(path + '?messageId=' + encodeURIComponent(message.id),'DELETE'); }
  else await this.api(path,'PATCH',{ action, messageId:message.id, important: !message.important });
  await this.refresh();
 }); },
 speak(e) { const message = this.data.messages.find(m => m.id === e.currentTarget.dataset.id); if(message) return this.speakText(message.content); },
 record() { this.startRecording(); }, stopRecord() { this.finishRecording(); }, cancelRecord() { this.cancelRecording(); }, stopAudio() { this.stopMedia(); },
 open(e) { navigate(e.currentTarget.dataset.page, { id:this.params.id }); },
 proactive(e) { return this.run(async () => { await this.api('proactive-messages/' + e.currentTarget.dataset.id,'PATCH',{status:e.currentTarget.dataset.status}); this.lastProactive = 0; await this.refresh(); }); },
 generateProactive() { return this.run(async () => { await this.api('companions/'+this.params.id+'/proactive-drafts','POST',{force:true,maxDrafts:1}); this.lastProactive=0; await this.refresh(); }); },
 filterProactive(e) { this.setData({proactiveFilter:e.detail.value}); },
  toggleProactive() {this.setData({showProactive:!this.data.showProactive});if(!this.data.showProactive)this.observeMessages();},
 refreshNow() { return this.run(() => this.refresh()); }
});
