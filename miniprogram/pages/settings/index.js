/* global wx */
/* eslint-disable @typescript-eslint/no-require-imports */
const { page, app, confirm, saveFile } = require('../../utils/runtime');
const { field, options } = require('../../utils/schema');
const profileSchema=[field('nickname','昵称'),field('timezone','时区'),field('language','语言'),field('proactiveMessagesEnabled','允许主动回响','boolean'),field('proactiveFrequencyHours','默认频率（小时）','number')];
const modelSchema=[field('provider','模型供应商','select',options([['compatible','兼容接口'],['openai-compatible','OpenAI 兼容'],['anthropic','Anthropic'],['gemini','Gemini'],['openai-responses','OpenAI Responses']])),field('baseUrl','接口地址'),field('model','模型名称'),field('apiKey','API Key（留空保留原值）','password')];
const statusRows = status => status.items.map(item=>({label:item.label,value:({ready:'已就绪',warning:'待确认',missing:'未配置'}[item.status] || item.status)+' · '+item.description+' '+item.nextStep}));
const usageRows = dashboard => [
 ...Object.entries({calls:'总调用',successfulCalls:'成功调用',failedCalls:'失败调用',inputTokens:'输入 Token',outputTokens:'输出 Token',totalTokens:'总 Token',estimatedCostUsd:'估算费用（美元）',averageLatencyMs:'平均响应毫秒'}).map(([key,label])=>({label,value:dashboard.summary[key] ?? '暂无'})),
 ...dashboard.byProviderModel.map(row=>({label:row.provider+' / '+row.model,value:row.calls+' 次 · '+row.totalTokens+' Token · 估算 $'+row.estimatedCostUsd})),
 ...dashboard.recent.map(row=>({label:row.createdAt+' · '+row.purpose,value:row.provider+' / '+row.model+' · '+row.status}))
];
page({
 data:{schema:profileSchema,form:{},modelSchema,model:{provider:'compatible',baseUrl:'',model:'',apiKey:''},models:[],credential:null,usage:[],status:[],range:7,confirmation:''},
 async init() {
  const [profile,credential,status]=await Promise.all([this.api('me'),this.api('me/llm-credential'),this.api('me/config-status')]);
  this.setData({form:profile.user,credential:credential.credential,status:statusRows(status.configStatus),model:{provider:credential.credential.provider || 'compatible',baseUrl:'',model:credential.credential.model || '',apiKey:''}}); await this.loadUsage();
 },
 editModel(e) {this.setData({['model.'+e.detail.key]:e.detail.value});},
 saveProfile() {return this.run(async()=>{const r=await this.api('me','PATCH',this.data.form);this.setData({form:r.user,notice:'资料已保存。'});});},
 saveModel() {return this.run(async()=>{const r=await this.api('me/llm-credential','PUT',this.data.model);this.setData({credential:r.credential,'model.apiKey':'',notice:'模型配置已加密保存。'});});},
 deleteModel() {return this.run(async()=>{if(!await confirm('删除保存的模型凭据？'))return;const r=await this.api('me/llm-credential','DELETE');this.setData({credential:r.credential,'model.apiKey':'',notice:'已删除。'});});},
 models() {return this.run(async()=>{const r=await this.api('me/llm-models');this.setData({models:r.models.map(m=>typeof m==='string'?{id:m}:m)});});},
 chooseModel(e) {this.setData({'model.model':this.data.models[Number(e.detail.value)].id});},
 test() {return this.run(async()=>{const {apiKey:unused,...config}=this.data.model;void unused;const r=await this.api('me/llm-test','POST',config);this.setData({notice:r.ok?'连接成功，用时 '+r.latencyMs+' 毫秒。':'连接失败：'+(r.error || r.errorType || '请核对配置')});});},
 async loadUsage() {const r=await this.api('usage/model-calls?rangeDays='+this.data.range);this.setData({usage:usageRows(r.dashboard)});},
 usage() {return this.run(()=>this.loadUsage());},
 exportData() {return this.run(async()=>{if(!await confirm('导出文件包含私人聊天与记忆，请只保存到可信位置。继续？'))return;await saveFile(await this.api('me/export'));});},
 deleteAccount() {return this.run(async()=>{if(this.data.confirmation!=='删除我的账号')throw new Error('请输入“删除我的账号”确认。');if(!await confirm('所有账号数据将被删除且不可恢复。确认继续？'))return;await this.api('me/account','DELETE',{confirmation:this.data.confirmation});app().client.clear();app().client=null;app().epoch++;app().drafts={};wx.reLaunch({url:'/pages/home/index'});});}
});
