/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const {page,split,navigate,confirm}=require('../../utils/runtime');
const {parseTranscript}=require('../../vendor/import/transcript');
const {selectTranscriptSample}=require('../../vendor/import/character-draft');
const {companion,field}=require('../../utils/schema');
page({
 data:{text:'',participants:[],target:'',self:'',sample:[],warnings:[],draft:null,form:{},schema:[...companion.slice(0,5).filter(f=>f.key!=='companionAddress'),field('personality','性格（逗号分隔）'),field('speakingStyle','说话习惯','long'),field('background','背景','long'),field('toneExamples','语气样例（每行一条）','long'),field('sharedMemories','共同经历（每行一条）','long')],previewText:'',history:[]},
 chooseFile(){wx.chooseMessageFile({count:1,type:'file',extension:['txt','json','jsonl'],success:r=>{if(r.tempFiles[0].size>1000000){this.setData({error:'文件过大，请拆分。'});return;}wx.getFileSystemManager().readFile({filePath:r.tempFiles[0].path,encoding:'utf8',success:f=>this.setData({text:f.data}),fail:()=>this.setData({error:'文件读取失败'})});}});},
 parse(){return this.run(async()=>{const parsed=parseTranscript(this.data.text);this.parsed=parsed.messages;this.setData({participants:parsed.participants,warnings:parsed.warnings,sample:[],draft:null});});},
 target(e){this.setData({target:this.data.participants[Number(e.detail.value)].name,sample:[]});},
 self(e){this.setData({self:this.data.participants[Number(e.detail.value)].name,sample:[]});},
 sample(){return this.run(async()=>{const result=selectTranscriptSample(this.parsed || [],this.data.target,this.data.self);this.setData({sample:result.sample.map((m,i)=>({...m,key:String(i),selected:true})),warnings:[...this.data.warnings,'请逐条核对，仅勾选的双方消息会发送给模型。']});});},
 toggle(e){this.setData({['sample['+e.currentTarget.dataset.index+'].selected']:e.detail.value});},
 analyze(){return this.run(async()=>{if(!await confirm('只将已勾选的双方样本发送给当前模型，继续提炼？'))return;const messages=this.data.sample.filter(m=>m.selected).map(({speaker,content})=>({speaker,content}));const r=await this.api('character-import','POST',{action:'analyze',targetSpeaker:this.data.target,selfSpeaker:this.data.self,messages});this.setData({draft:r.draft,form:{...r.draft,personality:r.draft.personality.join(','),toneExamples:r.draft.toneExamples.join('\n'),sharedMemories:r.draft.sharedMemories.join('\n')},warnings:r.warnings,history:[]});});},
 draft(){return {...this.data.form,customKind:this.data.form.customKind || '',userAddress:this.data.form.userAddress || '',background:this.data.form.background || '',personality:split(this.data.form.personality),toneExamples:String(this.data.form.toneExamples||'').split('\n').filter(Boolean),sharedMemories:String(this.data.form.sharedMemories||'').split('\n').filter(Boolean)};},
 preview(){return this.run(async()=>{const history=this.data.history.slice(-10);const r=await this.api('character-import','POST',{action:'preview',draft:this.draft(),message:this.data.previewText,history});this.setData({history:[...history,{role:'user',content:this.data.previewText},{role:'assistant',content:r.reply}],previewText:''});});},
 create(){return this.run(async()=>{if(!await confirm('按已核对的人物资料及共同经历创建？主动消息默认关闭。'))return;const r=await this.api('character-import','POST',{action:'create',draft:this.draft()});navigate('chat',{id:r.companion.id});});}
});
