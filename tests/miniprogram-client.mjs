import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createClient, normalizeBase, sessionCookie } = require('../miniprogram/utils/client.js');
const base = 'http://127.0.0.1:3000';
for (const host of ['127.0.0.1', '10.0.0.2', '192.168.1.2', '172.16.0.2', '172.31.255.1']) {
  assert.equal(normalizeBase(`http://${host}:3000/`), `http://${host}:3000`);
}
for (const bad of ['https://example.com', 'http://8.8.8.8:3000', 'http://172.32.1.1:3000',
  'http://192.168.999.1:3000', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
  'http://user:pass@127.0.0.1:3000', 'http://127.0.0.1:3000/path']) {
  assert.throws(() => normalizeBase(bad));
}
assert.equal(sessionCookie({ cookies: ['other=x; Path=/', 'perpetual_renewal_session=example; HttpOnly; Path=/'] }),
  'perpetual_renewal_session=example');
assert.equal(sessionCookie({ header: { 'set-cookie': 'perpetual_renewal_session=; Max-Age=0' } }), 'perpetual_renewal_session=');

const requests = [];
let next;
const transport = options => {
  requests.push(options);
  if (next === 'network') options.fail({ errMsg: 'sensitive upstream details' });
  else options.success(next);
};
const reply = (data, statusCode = 200, cookies = []) => ({ data, statusCode, cookies });
const client = createClient(base, transport);
next = reply({ session: {} }, 200, ['perpetual_renewal_session=example; Path=/; HttpOnly']);
await client.login('local@example.com', 'example-password');
assert.deepEqual(requests.at(-1).data, { email: 'local@example.com', password: 'example-password' });
assert.equal(requests.at(-1).header.Cookie, undefined);
next = reply({ companions: [] });
await client.companions();
assert.equal(requests.at(-1).header.Cookie, 'perpetual_renewal_session=example');
const other = createClient('http://192.168.1.3:3000', transport);
await other.companions();
assert.equal(requests.at(-1).header.Cookie, undefined, 'sessions must not cross client/base boundaries');
next = reply({ messages: [] });
await client.messages('a/b');
assert.equal(requests.at(-1).url, base + '/api/conversations/a%2Fb/messages');
next = reply({ assistantMessage: { id: 'reply' } }, 201);
await client.send('conversation', 'hello', 'wx_example');
assert.equal(requests.at(-1).method, 'POST');
assert.deepEqual(requests.at(-1).data, { content: 'hello', clientMessageId: 'wx_example' });
next = reply({ error: 'sensitive detail' }, 401);
await assert.rejects(client.companions(), error => error.status === 401 && !error.message.includes('sensitive'));
next = reply({ companions: [] });
await client.companions();
assert.equal(requests.at(-1).header.Cookie, undefined);
next = reply({ session: {} });
await assert.rejects(client.login('local@example.com', 'example-password'), /Cookie/);
next = reply({ session: {} }, 200, ['perpetual_renewal_session=example; Path=/']);
await client.login('local@example.com', 'example-password');
next = 'network';
const beforeFailure = requests.length;
await assert.rejects(client.send('conversation', 'hello', 'wx_example'), /先刷新/);
assert.equal(requests.length, beforeFailure + 1, 'never auto-retry a possibly delivered message');
await assert.rejects(client.logout(), /连接失败/);
next = reply({ companions: [] });
await client.companions();
assert.equal(requests.at(-1).header.Cookie, undefined, 'logout clears cookie even if the server is unreachable');
next = reply('<html>login</html>');
await assert.rejects(client.companions(), /请求未完成/);

// Late responses cannot repopulate a cleared session.
let delayed;
const delayedClient = createClient(base, options => { delayed = options; });
const oldRequest = delayedClient.companions();
delayedClient.clear();
delayed.success(reply({ companions: [] }, 200, ['perpetual_renewal_session=old; Path=/']));
await assert.rejects(oldRequest, error => error.stale === true);

const app = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url)));
for (const path of app.pages) {
  new vm.Script(readFileSync(new URL(`../miniprogram/${path}.js`, import.meta.url), 'utf8'));
  JSON.parse(readFileSync(new URL(`../miniprogram/${path}.json`, import.meta.url)));
  assert.ok(readFileSync(new URL(`../miniprogram/${path}.wxml`, import.meta.url), 'utf8').includes('<view'));
}
const scope = JSON.parse(readFileSync(new URL('../miniprogram/feature-scope.json', import.meta.url)));
assert.equal(scope.scope, 'all-existing-web-features');
const declared = scope.features.flatMap(feature => feature.routes).sort();
const actual = readdirSync(new URL('../src/app/api/', import.meta.url), { recursive: true })
  .map(path => path.replaceAll('\\', '/'))
  .filter(path => path.endsWith('/route.ts'))
  .map(path => path.slice(0, -'/route.ts'.length)).sort();
assert.deepEqual(declared, actual, 'every current API must be accounted for in full migration scope');
console.log('Mini program checks passed: local addresses, cookie isolation, API contracts, failure handling, stale session fencing, configuration and full API scope. No model calls.');
