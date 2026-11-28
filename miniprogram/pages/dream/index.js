/* eslint-disable @typescript-eslint/no-require-imports */
const { page, split, confirm, navigate } = require('../../utils/runtime');
const { field } = require('../../utils/schema');
page({
 data:{state:null,companion:null,form:{personality:'',speakingStyle:''},schema:[field('personality','性格（逗号分隔）'),field('speakingStyle','说话习惯','long')],fragments:[],message:'',mode:'compare',correction:'',scope:'always',choiceId:'',roundId:''},
 async init() { await this.load(); },
 async load() { const result=await this.api('companions/'+this.params.id+'/dream'); this.accept(result); },
 accept(result) {
  const update={}; if(result.companion) update.companion=result.companion;
  if(result.state) Object.assign(update,{state:result.state,fragments:result.state.fragments,form:{personality:result.state.draftProfile.personality.join(','),speakingStyle:result.state.draftProfile.speakingStyle}});
  this.setData(update);
 },
 async action(action,body={}) { const result=await this.api('companions/'+this.params.id+'/dream','POST',{action,revision:this.data.state?.revision,...body}); this.accept(result); return result; },
 start() { return this.run(async () => { const fresh=!this.data.state || this.data.state.status!=='draft'; await this.action('start'); if(fresh) navigate('echoes',{kind:'dream',auto:'1'}); }); },
 async saveDraft() { await this.action('edit',{draftProfile:{personality:split(this.data.form.personality),speakingStyle:this.data.form.speakingStyle},fragments:this.data.fragments}); },
 save() { return this.run(()=>this.saveDraft()); },
 mode(e) {this.setData({mode:e.detail.value});}, scope(e) {this.setData({scope:e.detail.value});},
 fragment(e) { this.setData({['fragments['+e.currentTarget.dataset.index+'].'+e.currentTarget.dataset.key]:e.detail.value}); },
 fragmentScope(e) {this.setData({['fragments['+e.currentTarget.dataset.index+'].scope']:['always','context','occasional'][Number(e.detail.value)]});},
 removeFragment(e) {this.setData({fragments:this.data.fragments.filter(f=>f.id!==e.currentTarget.dataset.id)});},
 generate() {return this.run(async()=>{await this.saveDraft();await this.action('generate',{message:this.data.message,mode:this.data.mode});this.setData({message:''});});},
 choose(e) { this.setData({roundId:e.currentTarget.dataset.round,choiceId:e.currentTarget.dataset.choice || ''}); },
 feedback() {return this.run(async()=>{await this.saveDraft();await this.action('feedback',{roundId:this.data.roundId,...(this.data.choiceId?{choiceId:this.data.choiceId}:{}),correction:this.data.correction,scope:this.data.scope});this.setData({correction:'',roundId:'',choiceId:''});});},
 apply() {return this.run(async()=>{await this.saveDraft();if(await confirm('请核对应用预览。仅已确认片段将写入人物；确认应用？')) await this.action('apply');});},
 discard() {return this.run(async()=>{if(await confirm('丢弃当前练习草稿？正式聊天不会被修改。')) await this.action('discard');});},
 restore(e) {return this.run(async()=>{if(await confirm('恢复到这个人物版本？')) await this.action('restore',{versionId:e.currentTarget.dataset.id});});},
 rebase() {return this.run(async()=>{const latest=await this.api('companions/'+this.params.id+'/dream');if(!await confirm('以最新人物版本为基准继续？将重新读取服务端梦境，请先核对尚未保存的内容。')) return;this.accept(latest);await this.action('rebase',{expectedCompanionUpdatedAt:latest.companion.updatedAt});});},
 reload() {return this.run(async()=>{if(await confirm('重新读取会放弃尚未保存的编辑。继续？')) await this.load();});}
});
