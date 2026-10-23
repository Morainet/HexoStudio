const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AuthManager } = require('../server/auth.cjs');
const { createStore, normalizeStorage, describeStorage } = require('../server/auth-store.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-auth-'));
  let settings = {};
  const load = () => settings;
  const save = value => { settings = value; };
  const auth = new AuthManager(load, save);
  const request = () => ({ headers: { host: '127.0.0.1:4545' }, socket: { remoteAddress: '127.0.0.1' } });
  return { dir, load, save, auth, request, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('SQLite stores only salted hashes and survives reopening', async t => {
  const f = fixture(); t.after(f.cleanup);
  const config = { type: 'sqlite', path: path.join(f.dir, 'admin.sqlite') };
  await f.auth.setup('admin', 'long-secure-password', f.request(), false, config);
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

test('legacy file account migrates to SQLite and remains usable', async t => {
  const f = fixture(); t.after(f.cleanup);
  await f.auth.setup('admin', 'long-secure-password', f.request(), false, { type: 'file' });
  const oldHash = f.load().admin.hash;
  const config = { type: 'sqlite', path: path.join(f.dir, 'migrated.sqlite') };
  await assert.rejects(f.auth.moveStorage(f.request(), 'wrong', config), /当前密码错误/);
  await f.auth.moveStorage(f.request(), 'long-secure-password', config);
  assert.equal(f.load().admin, undefined);
  assert.equal((await createStore(config, f.load, f.save).read()).hash, oldHash);
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
