/* global Page, wx, getApp */
function app() { return getApp(); }
function id() { return 'wx_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
function split(value) { return String(value || '').split(/\n|，|,/).map(s => s.trim()).filter(Boolean); }
function confirm(content) { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: r => resolve(r.confirm), fail: () => resolve(false) })); }
function navigate(page, params = {}) {
  const query = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  wx.navigateTo({ url: '/pages/' + page + '/index' + (query ? '?' + query : '') });
}
function page(definition) {
  Page({
    ...definition,
    data: { busy: false, error: '', notice: '', form: {}, ...definition.data },
    onLoad(params) {
      this.params = params; this.alive = true; this.version = 0; this.initialized = !definition.init;
      if (definition.init) this.initialization = this.run(async () => { await definition.init.call(this, params); this.initialized = true; });
    },
    onShow() {
      this.visible = true;
      this.epoch = app().epoch;
      if (definition.init && !this.initialized) Promise.resolve(this.initialization).then(() => {
        if (this.alive && this.visible && !this.initialized) this.initialization = this.run(async () => { await definition.init.call(this, this.params); this.initialized = true; });
      });
      if (definition.refresh) {
        this.run(() => definition.refresh.call(this));
        this.timer = setInterval(() => { if (!this.data.busy && this.visible) this.run(() => definition.refresh.call(this)); }, definition.interval || 5000);
      }
      if (definition.show) definition.show.call(this);
    },
    onHide() { this.visible = false; this.version++; clearInterval(this.timer); if (this.stopMedia) this.stopMedia(); },
    onUnload() { this.alive = false; this.version++; clearInterval(this.timer); if (this.stopMedia) this.stopMedia(); },
    async api(path, method = 'GET', data) {
      const epoch = app().epoch, version = this.version;
      if (!app().client) { const e = new Error('请先登录连接。'); e.status = 401; throw e; }
      const result = await app().client.request('/api/' + path, method, data);
      if (!this.alive || this.visible === false || epoch !== app().epoch || version !== this.version) { const e = new Error('页面已离开'); e.stale = true; throw e; }
      return result;
    },
    async run(operation) {
      if (this.data.busy || !this.alive) return;
      this.setData({ busy: true, error: '', notice: '' });
      try { await operation(); }
      catch (e) {
        if (e.stale || !this.alive) return;
        if (e.status === 401) {
          if (app().client) app().client.clear();
          app().client = null; app().epoch++; app().drafts = {};
          wx.reLaunch({ url: '/pages/home/index' });
        } else this.setData({ error: e.message || '操作未完成，请重试。' });
      } finally { if (this.alive) this.setData({ busy: false }); }
    },
    edit(event) { this.setData({ ['form.' + event.detail.key]: event.detail.value }); },
    input(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
    go(event) { navigate(event.currentTarget.dataset.page, event.currentTarget.dataset.id ? { id: event.currentTarget.dataset.id } : {}); },
    ...Object.fromEntries(Object.entries(definition).filter(([key]) => !['data', 'onLoad', 'onShow', 'onHide', 'onUnload'].includes(key)))
  });
}
async function saveFile(value, name = '生生不息导出.json') {
  const path = wx.env.USER_DATA_PATH + '/' + name;
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: JSON.stringify(value, null, 2), encoding: 'utf8', success: resolve, fail: reject }));
  if (wx.shareFileMessage) await new Promise((resolve, reject) => wx.shareFileMessage({ filePath: path, fileName: name, success: resolve, fail: reject }));
  else wx.showModal({ title: '文件已保存', content: path, showCancel: false });
}
module.exports = { page, app, id, split, confirm, navigate, saveFile };
