const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
function legacyAccount() {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync('long-secure-password', Buffer.from(salt, 'hex'), 64, { N: 1 << 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return { username: 'admin', salt, hash };
}
const { AuthManager } = require('../server/auth.cjs');
const { createStore, normalizeStorage, describeStorage } = require('../server/auth-store.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-auth-'));
  let settings = {};
  const load = () => settings;
  const save = value => { settings = value; };
  let remoteRecord = null;
  const remoteStore = {
    async probe() {}, async read() { return remoteRecord; },
    async create(record) { if (remoteRecord) throw new Error('目标已有管理员'); remoteRecord = record; },
    async replace(record) { remoteRecord = record; }
  };
  const auth = new AuthManager(load, save, (config, load, save) => ['file', 'sqlite'].includes(config.type) ? createStore(config, load, save) : remoteStore);
  const request = () => ({ headers: { host: '127.0.0.1:4545' }, socket: { remoteAddress: '127.0.0.1' } });
  return { dir, load, save, auth, request, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('existing SQLite accounts remain readable after upgrading', async t => {
  const f = fixture(); t.after(f.cleanup);
  const config = { type: 'sqlite', path: path.join(f.dir, 'admin.sqlite') };
  await createStore(config, f.load, f.save).create(legacyAccount());
  f.save({ authStorage: config });
  assert.equal(f.load().admin, undefined);
  const stored = await createStore(config, f.load, f.save).read();
  assert.equal(stored.username, 'admin');
  assert.notEqual(stored.hash, 'long-secure-password');
  await assert.rejects(createStore(config, f.load, f.save).create(stored), /已有管理员/);
  await f.auth.login('admin', 'long-secure-password', '127.0.0.1');
  await f.auth.changePassword(f.request(), 'long-secure-password', 'new-long-secure-password');
  await assert.rejects(f.auth.login('admin', 'long-secure-password', '127.0.0.1'), /错误/);
  await f.auth.login('admin', 'new-long-secure-password', '127.0.0.1');
});

test('legacy file account migrates to a remote database and remains usable', async t => {
  const f = fixture(); t.after(f.cleanup);
  f.save({ admin: legacyAccount() });
  await f.auth.login('admin', 'long-secure-password', '127.0.0.1');
  for (const type of ['file', 'sqlite']) await assert.rejects(f.auth.moveStorage(f.request(), 'long-secure-password', { type }), error => error.status === 400);
  const oldHash = f.load().admin.hash;
  const config = { type: 'postgres', url: 'postgresql://u:p@db.example/studio' };
  await assert.rejects(f.auth.moveStorage(f.request(), 'wrong', config), /当前密码错误/);
  await f.auth.moveStorage(f.request(), 'long-secure-password', config);
  assert.equal(f.load().admin, undefined);
  assert.equal((await f.auth.account()).hash, oldHash);
  await f.auth.login('admin', 'long-secure-password', '127.0.0.1');
  await assert.rejects(f.auth.moveStorage(f.request(), 'long-secure-password', config), /不同/);
});

test('storage input validates providers and descriptions hide secrets', () => {
  assert.equal(normalizeStorage({ type: 'postgres', url: 'postgresql://u:secret@db.example/blog' }).type, 'postgres');
  assert.equal(normalizeStorage({ type: 'mysql', url: 'mysql://u:secret@db.example/blog' }).type, 'mysql');
  const mongo = normalizeStorage({ type: 'mongodb', url: 'mongodb://u:secret@db.example', database: 'blog' });
  assert.equal(mongo.database, 'blog');
  assert.doesNotMatch(describeStorage(mongo).label, /secret/);
  assert.throws(() => normalizeStorage({ type: 'postgres', url: 'mysql://x/db' }), /不匹配/);
  assert.throws(() => normalizeStorage({ type: 'sqlite', path: 'relative.sqlite' }), /绝对路径/);
});
