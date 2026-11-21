/* eslint-disable @typescript-eslint/no-require-imports */
const { page, app, navigate, confirm } = require('../../utils/runtime');
const { createClient } = require('../../utils/client');
page({
 data: { base: 'http://localhost:3000', email: '', password: '', loggedIn: false, companions: [], groups: [], starters: [], companionCount:0, groupCount:0, showConnection:false, heroFailed:false },
 init() { this.setData({ loggedIn: !!app().client }); },
 async refresh() {
  if (!app().client) return;
  this.setData({ loggedIn: true });
  const [people, groups, inbox] = await Promise.all([this.api('companions'), this.api('groups'), this.api('sync/inbox')]);
  const unread = (scope, id) => (inbox.threads.find(t => t.scope === scope && t.threadId === id) || {}).unreadCount || 0;
  this.setData({ companionCount:people.companions.length, groupCount:groups.groups.length, companions: people.companions.map(c => ({ ...c, initial:c.name.slice(0,1), unread: unread('private', c.conversationId) })), groups: groups.groups.map(g => ({ ...g, unread: unread('group', g.id) })) });
 },
 login() { return this.run(async () => {
  const client = createClient(this.data.base), password = this.data.password;
  this.setData({ password: '' });
  await client.login(this.data.email.trim(), password);
  app().client = client; app().epoch++; app().drafts = {};
  this.setData({ loggedIn: true }); await this.refresh();
  if(!app().introSeen) { app().introSeen=true; navigate('echoes',{kind:'renewal',auto:'1'}); }
 }); },
 auth(e) { app().authBase = this.data.base; navigate('auth', { mode: e.currentTarget.dataset.mode }); },
 open(e) { navigate('chat', { id: e.currentTarget.dataset.id }); },
 previewStarters() { this.setData({ starters: require('../../vendor/starters').STARTER_CHARACTERS }); },
 install() { return this.run(async () => {
  if (!await confirm('添加留灯会六位人物和群聊？已有修改与消息会保留。')) return;
  await this.api('starters', 'POST', {}); await this.refresh();
 }); },
 logout() { return this.run(async () => {
  try { await app().client.logout(); }
  finally { app().client = null; app().epoch++; app().drafts = {}; this.setData({ loggedIn: false, companions: [], groups: [], companionCount:0, groupCount:0, starters: [], password: '' }); }
 }); },
 refreshNow() { return this.run(() => this.refresh()); }
 ,connection() {this.setData({showConnection:!this.data.showConnection});}
 ,heroError() {this.setData({heroFailed:true});}
});
