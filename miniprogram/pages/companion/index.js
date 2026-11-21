/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { page, split, confirm, navigate } = require('../../utils/runtime');
const { companion: schema } = require('../../utils/schema');
page({
 data: { schema, form: { name: '', relationshipKind: 'CUSTOM', personality: '真诚,贴近,稳定', speakingStyle: '', immersionEnabled: true, proactiveMessagesEnabled: false, proactiveFrequencyPreset: '24h', proactiveFrequencyMinutes: 1440 }, person: null, relationship: null, previewText: '', previewReply: '' },
 async init(params) {
  if (!params.id) return;
  const result = await this.api('companions/' + encodeURIComponent(params.id));
  this.setData({ person: result.companion, form: { ...result.companion, personality: result.companion.personality.join(',') } });
  const relationship = await this.api('companions/' + encodeURIComponent(params.id) + '/relationship-state');
  this.setData({ relationship: relationship.relationshipState || relationship.state || relationship });
 },
 save() { return this.run(async () => {
  const form = { ...this.data.form, personality: split(this.data.form.personality) };
  const initial = String(form.initialMemoriesText || '').split('\n').map(s=>s.trim()).filter(Boolean);
  delete form.initialMemoriesText;
  if(!this.params.id && initial.length) { if(initial.length>12) throw new Error('共同经历最多12条。'); form.initialMemories=initial.map(content=>({type:'relationship_event',content})); }
  if (!form.name.trim() || !form.speakingStyle.trim()) throw new Error('请填写名字和说话习惯。');
  const result = await this.api(this.params.id ? 'companions/' + encodeURIComponent(this.params.id) : 'companions', this.params.id ? 'PATCH' : 'POST', form);
  this.params.id = result.companion.id; this.setData({ person: result.companion, notice: '人物已保存。' });
 }); },
 preview() { return this.run(async () => {
  if (!this.data.previewText.trim()) throw new Error('请输入试聊消息。');
  const result = await this.api('chat/complete', 'POST', { companion: { ...this.data.form, personality: split(this.data.form.personality) }, recentMessages: [{ role: 'user', content: this.data.previewText }] });
  this.setData({ previewReply: result.content || result.reply || '没有返回内容，请检查模型。' });
 }); },
 chat() { if (this.params.id) navigate('chat', { id: this.params.id }); },
 remove() { return this.run(async () => {
  if (!await confirm('删除这个人物及相关数据？此操作不可撤销。')) return;
  await this.api('companions/' + encodeURIComponent(this.params.id), 'DELETE'); wx.navigateBack();
 }); }
});
