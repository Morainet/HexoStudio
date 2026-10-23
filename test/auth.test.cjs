const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthManager } = require('../server/auth.cjs');
const { createStore } = require('../server/auth-store.cjs');

function fixture() {
  let settings = {};
  let account = null;
  const memoryStore = {
    async probe() {}, async read() { return account; },
    async create(record) { if (account) throw new Error('目标已有管理员'); account = record; },
    async replace(record) { account = record; }
  };
  const auth = new AuthManager(() => settings, value => { settings = value; },
    (config, load, save) => config.type === 'file' ? createStore(config, load, save) : memoryStore);
  const request = (cookie = '', csrf = '') => ({ headers: { host: '127.0.0.1:4545', cookie, 'x-csrf-token': csrf }, socket: { remoteAddress: '127.0.0.1' } });
  return { auth, request, settings: () => settings };
}

test('管理员首次设置、登录、会话和密码修改', async () => {
  const { auth, request, settings } = fixture();
  assert.equal(await auth.configured(), false);
  const first = await auth.setup('admin', 'long-secure-password', request(), false, { type: 'postgres', url: 'postgresql://user:password@db.example/hexostudio' });
  assert.equal(await auth.configured(), true);
  assert.equal((await auth.account()).password, undefined);
  assert.notEqual((await auth.account()).hash, 'long-secure-password');
  assert.match(first.cookie, /HttpOnly; SameSite=Strict/);
  const firstRequest = request(first.cookie.split(';')[0], first.csrf);
  assert.equal((await auth.status(firstRequest)).authenticated, true);
  assert.doesNotThrow(() => auth.checkCsrf(firstRequest));
  assert.throws(() => auth.checkCsrf(request(first.cookie.split(';')[0])), /会话验证失败/);
  await assert.rejects(auth.setup('other', 'another-long-password', request()), /已创建/);
  await assert.rejects(auth.login('admin', 'wrong-password', '127.0.0.1'), /用户名或密码错误/);
  const second = await auth.login('admin', 'long-secure-password', '127.0.0.1');
  assert.equal((await auth.status(request(second.cookie.split(';')[0]))).authenticated, true);
  await auth.changePassword(firstRequest, 'long-secure-password', 'changed-long-password');
  assert.equal((await auth.status(firstRequest)).authenticated, false);
  assert.equal((await auth.status(request(second.cookie.split(';')[0]))).authenticated, false);
  await assert.rejects(auth.login('admin', 'long-secure-password', '127.0.0.1'), /用户名或密码错误/);
  const third = await auth.login('admin', 'changed-long-password', '127.0.0.1');
  assert.equal((await auth.status(request(third.cookie.split(';')[0]))).authenticated, true);
  auth.clearSession(request(third.cookie.split(';')[0]));
  assert.equal((await auth.status(request(third.cookie.split(';')[0]))).authenticated, false);
});

test('首次设置限制在本机，并限制密码猜测', async () => {
  const { auth, request } = fixture();
  const remote = request(); remote.socket.remoteAddress = '192.0.2.1';
  await assert.rejects(auth.setup('admin', 'long-secure-password', remote), /本机/);
  await assert.rejects(auth.setup('admin', 'short', request()), /12/);
  await auth.setup('admin', 'long-secure-password', request(), false, { type: 'postgres', url: 'postgresql://user:password@db.example/hexostudio' });
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login('admin', 'wrong', '127.0.0.1'), /用户名或密码错误/);
  await assert.rejects(auth.login('admin', 'long-secure-password', '127.0.0.1'), error => error.status === 429);
});

test('setup and connection testing reject local storage and missing configuration', async () => {
  for (const storage of [undefined, { type: 'file' }, { type: 'sqlite', path: '/tmp/account.sqlite' }]) {
    const { auth, request } = fixture();
    await assert.rejects(auth.setup('admin', 'long-secure-password', request(), false, storage), error => error.status === 400);
    await assert.rejects(auth.testStorage(request(), storage), error => error.status === 400);
    assert.equal(await auth.configured(), false);
  }
});

test('all three supported database types can initialize authentication', async () => {
  for (const storage of [
    { type: 'postgres', url: 'postgresql://u:p@db.example/studio' },
    { type: 'mysql', url: 'mysql://u:p@db.example/studio' },
    { type: 'mongodb', url: 'mongodb://u:p@db.example/studio' }
  ]) {
    const { auth, request, settings } = fixture();
    await auth.setup('admin', 'long-secure-password', request(), false, storage);
    assert.equal(settings().authStorage.type, storage.type);
    assert.equal(settings().admin, undefined);
    await auth.login('admin', 'long-secure-password', '127.0.0.1');
  }
});
