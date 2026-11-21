/* eslint-disable @typescript-eslint/no-require-imports */
// local-server.generated.js 由 scripts/start-local.ps1 在局域网启动时生成（不入库）。
// 用 JS 模块而非 JSON：小程序运行时 require JSON 曾报错，见 docs/WECHAT_MINIPROGRAM.md。
let generated = null;
try { generated = require('./local-server.generated'); } catch { generated = null; }
module.exports = { base: (generated && generated.base) || 'http://localhost:3000' };
