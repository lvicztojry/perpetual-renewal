/* eslint-disable @typescript-eslint/no-require-imports */
const { page, app } = require('../../utils/runtime');
const { createClient } = require('../../utils/client');
const { field } = require('../../utils/schema');
const localServer = require('../../utils/local-server');
page({
 data: { schema: [], form: {}, mode: '', title: '' },
 init(params) {
  const modes = { register: '注册', 'forgot-password': '找回密码', 'verify-email': '验证邮箱', 'reset-password': '重置密码' };
  if (!modes[params.mode]) throw new Error('无效操作');
  const schema = [field('base','电脑服务地址')];
  if (['register','forgot-password'].includes(params.mode)) schema.push(field('email','邮箱'));
  if (params.mode === 'register') schema.push(field('nickname','昵称'));
  if (['register','reset-password'].includes(params.mode)) schema.push(field('password','密码（至少12位）','password'));
  if (['verify-email','reset-password'].includes(params.mode)) schema.push(field('token','邮件中的完整链接或验证令牌','long'));
  this.setData({ mode: params.mode, title: modes[params.mode], schema, form: { base: app().authBase || localServer.base, token: '', password: '', email: '', nickname: '' } });
 },
 submit() { return this.run(async () => {
  const { base, ...form } = this.data.form, match = /[?&]token=([^&#]+)/.exec(form.token || '');
  if (match) form.token = decodeURIComponent(match[1]);
  await createClient(base).request('/api/auth/' + this.data.mode, 'POST', form);
  this.setData({ 'form.password': '', 'form.token': '', notice: ['register','forgot-password'].includes(this.data.mode) ? '如资料有效，邮件将发送到该邮箱。请检查收件箱及垃圾邮件。' : '已完成，请返回登录。' });
 }); }
});
