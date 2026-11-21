/* global wx */
// Local development only. Credentials and session cookies stay in memory.
const SESSION_NAME = 'perpetual_renewal_session';

function normalizeBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  const match = /^http:\/\/(localhost|\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(base);
  if (!match) throw new Error('请填写电脑的本地地址，例如 http://127.0.0.1:3000。');
  const octets = match[1].split('.').map(Number);
  const [a, b] = octets;
  const port = Number(match[2]);
  if(match[1] === 'localhost' && port >= 1 && port <= 65535) return base;
  if (octets.some(n => n > 255) || port < 1 || port > 65535 ||
      !(a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31))) {
    throw new Error('本地联调版只接受回环或局域网 IPv4 地址。');
  }
  return base;
}

function sessionCookie(response) {
  const header = response.header || {};
  const raw = response.cookies && response.cookies.length
    ? response.cookies : [header['Set-Cookie'] || header['set-cookie'] || ''];
  for (const entry of raw) {
    const match = new RegExp('(?:^|,\\s*)(' + SESSION_NAME + '=[^;,]*)').exec(entry);
    if (match) return match[1];
  }
  return null;
}

function createClient(value, requestImpl) {
  const base = normalizeBase(value);
  const transport = requestImpl || (options => wx.request(options));
  let cookie = '';
  let generation = 0;
  async function request(path, method = 'GET', data) {
    return new Promise((resolve, reject) => {
      const requestedGeneration = generation;
      transport({
        url: base + path, method, data, timeout: 120000,
        header: { 'content-type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
        success(response) {
          if (requestedGeneration !== generation) { const error = new Error('会话已切换，请重新操作。'); error.stale = true; reject(error); return; }
          const nextCookie = sessionCookie(response);
          if (nextCookie !== null) cookie = nextCookie;
          if (response.statusCode === 401) cookie = '';
          if (response.statusCode < 200 || response.statusCode >= 300 ||
              !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
            const message = response.statusCode === 401 ? '登录已失效，请重新登录。' :
              response.statusCode === 403 ? '请求被拒绝，请检查后台启动方式和来源校验；不要关闭认证保护。' :
              response.statusCode === 409 ? '内容已在另一端更新，请刷新后重新核对再保存。' :
              response.statusCode >= 500 ? '本机服务暂不可用，请在电脑端检查服务日志。' :
              '请求未完成，请检查账号资料或本机服务。';
            const error = new Error(message);
            error.status = response.statusCode;
            reject(error);
            return;
          }
          resolve(response.data);
        },
        fail() { reject(new Error('连接失败或超时。请检查电脑服务、地址、同一 Wi-Fi 和开发工具域名校验设置；发送超时后先刷新记录确认是否送达。')); }
      });
    });
  }
  return {
    request,
    asset: name => base + '/visuals/' + encodeURIComponent(name),
    async login(email, password) {
      generation++;
      cookie = '';
      try {
        const result = await request('/api/auth/login', 'POST', { email, password });
        if (!cookie || cookie === SESSION_NAME + '=') throw new Error('未收到会话 Cookie，请检查开发者工具网络面板。');
        return result;
      } catch (error) { cookie = ''; throw error; }
    },
    companions: () => request('/api/companions'),
    messages: id => request('/api/conversations/' + encodeURIComponent(id) + '/messages'),
    send: (id, content, clientMessageId) => request('/api/conversations/' + encodeURIComponent(id) + '/messages', 'POST', { content, clientMessageId }),
    async logout() {
      try { await request('/api/auth/logout', 'POST', {}); }
      finally { cookie = ''; generation++; }
    },
    clear() { cookie = ''; generation++; }
  };
}
module.exports = { createClient, normalizeBase, sessionCookie };
