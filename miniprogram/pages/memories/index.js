/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { page, confirm } = require('../../utils/runtime');
const { field, options } = require('../../utils/schema');
const types=options([['user_fact','用户事实'],['relationship_event','共同经历'],['companion_profile','人物资料'],['emotional_preference','情绪偏好']]);
page({
 data:{memories:[],selected:null,form:{content:'',type:'user_fact',status:'pending'},schema:[field('content','记忆内容','long'),field('type','类型','select',types),field('status','状态','select',options([['pending','候选'],['active','生效'],['archived','归档']]))],history:[],cursor:null,replacementId:'',importText:'',importMode:'text',sourceKind:'memory_candidate'},
 async init() { await this.load(); },
 async load() { const result=await this.api('companions/'+this.params.id+'/memories'); this.setData({memories:result.memories}); },
 select(e) { const selected=this.data.memories.find(m=>m.id===e.currentTarget.dataset.id); this.setData({selected,form:{content:selected.content,type:selected.type,status:selected.status},history:[],cursor:null}); },
 fresh() { this.setData({selected:null,form:{content:'',type:'user_fact',status:'pending'},history:[],cursor:null}); },
 save() { return this.run(async () => {
  const selected=this.data.selected;
  if(selected) await this.api('memories/'+selected.id,'PATCH',{...this.data.form,expectedUpdatedAt:selected.updatedAt});
  else await this.api('companions/'+this.params.id+'/memories','POST',{content:this.data.form.content,type:this.data.form.type});
  await this.load(); this.fresh();
 }); },
 forget() { return this.run(async () => {
  if(!await confirm('遗忘会清除这条记忆内容和变更历史，但不会删除原聊天。确认继续？')) return;
  await this.api('memories/'+this.data.selected.id,'DELETE',{expectedUpdatedAt:this.data.selected.updatedAt}); await this.load(); this.fresh();
 }); },
 history() { return this.run(async () => {
  const result=await this.api('memories/'+this.data.selected.id+'/history'+(this.data.cursor?'?before='+encodeURIComponent(this.data.cursor):''));
  this.setData({history:[...this.data.history,...result.items],cursor:result.nextCursor});
 }); },
 replacement(e) { this.setData({replacementId:this.data.memories[Number(e.detail.value)].id}); },
 supersede() { return this.run(async () => {
  const old=this.data.selected, replacement=this.data.memories.find(m=>m.id===this.data.replacementId);
  if(!replacement) throw new Error('请选择替代记忆。');
  if(!await confirm('将原事实归档，并原子确认替代事实？')) return;
  await this.api('memories/'+old.id+'/history','POST',{action:'supersede',expectedUpdatedAt:old.updatedAt,replacementId:replacement.id,replacementUpdatedAt:replacement.updatedAt});
  await this.load(); this.fresh();
 }); },
 chooseFile() { wx.chooseMessageFile({count:1,type:'file',extension:['txt','jsonl','json'],success:r=>{
  if(r.tempFiles[0].size>1000000){this.setData({error:'文件过大，请拆分。'});return;}
  wx.getFileSystemManager().readFile({filePath:r.tempFiles[0].path,encoding:'utf8',success:f=>this.setData({importText:f.data}),fail:()=>this.setData({error:'读取失败'})});
 }}); },
 mode(e) { this.setData({importMode:e.detail.value}); }, source(e) { this.setData({sourceKind:e.detail.value}); },
 importMemories() { return this.run(async () => {
  const text=this.data.importText, payload=this.data.importMode==='jsonl'?{jsonLines:text}:this.data.importMode==='batch'?{batchTexts:text.split(/\n\s*\n/).filter(Boolean)}:{text};
  const result=await this.api('companions/'+this.params.id+'/imports','POST',{...payload,sourceKind:this.data.sourceKind});
  this.setData({notice:'已生成 '+result.memories.length+' 条待确认记忆。',importText:''}); await this.load();
 }); }
});
