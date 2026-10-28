const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { MongoClient } = require('mongodb');
const { proxyOptions, mongoOptions, mongoError } = require('../server/mongo-connection.cjs');
const { normalizeStorage, describeStorage } = require('../server/auth-store.cjs');

test('Mongo proxy configuration is validated, preserved privately, and passed to the driver', () => {
  const config = normalizeStorage({ type: 'mongodb', url: 'mongodb+srv://u:dbsecret@cluster.example/blog', proxyUrl: 'socks5://proxyuser:proxy%40secret@127.0.0.1:7890' });
  assert.equal(config.database, 'blog');
  assert.equal(mongoOptions(config).proxyPassword, 'proxy@secret');
  assert.equal(mongoOptions(config).proxyPort, 7890);
  assert.equal(mongoOptions(config).serverSelectionTimeoutMS, 20000);
  assert.doesNotMatch(JSON.stringify(describeStorage(config)), /secret|proxyuser/);
  assert.deepEqual(proxyOptions(''), {});
  assert.equal(proxyOptions('socks5://[::1]:1080').proxyHost, '::1');
  for (const url of ['http://localhost:7890', 'socks5://localhost', 'socks5://localhost:0', 'socks5://localhost:65536', 'socks5://localhost:7890/path', 'socks5://localhost:7890?token=secret']) assert.throws(() => proxyOptions(url));
});

test('nested driver errors produce actionable fixed text without leaking secrets', () => {
  const secret = 'mongodb://admin:secret@private-host/?proxyPassword=hidden';
  for (const [nested, pattern] of [
    [{ code: 18 }, /认证失败/], [{ code: 13 }, /权限不足/],
    [{ code: 'ECONNREFUSED', syscall: 'querySrv' }, /DNS/],
    [{ code: 'CERT_HAS_EXPIRED' }, /TLS/],
    [{ message: `Socks5 proxy rejected ${secret}` }, /SOCKS5/],
    [{ code: 'ETIMEDOUT' }, /实际出口 IP/],
    [{ name: 'MongoParseError' }, /参数无效/]
  ]) {
    const error = { name: 'MongoServerSelectionError', message: secret, reason: { servers: new Map([['private-host', { error: { cause: { ...nested, message: nested.message || secret } } }]]) } };
    const result = mongoError(error);
    assert.equal(result.status, 503); assert.match(result.message, pattern);
    assert.doesNotMatch(result.message, /admin|secret|private-host|hidden/);
  }
  const cyclic = {}; cyclic.cause = cyclic;
  assert.match(mongoError(cyclic).message, /连接或操作失败/);
});

test('real Mongo driver negotiates with the configured SOCKS5 endpoint', async t => {
  const sockets = new Set(); let reached = false;
  const proxy = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.once('data', greeting => {
      assert.equal(greeting[0], 5); socket.write(Buffer.from([5, 0]));
      socket.once('data', request => {
        reached = request[0] === 5 && request[1] === 1;
        socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
      });
    });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const client = new MongoClient('mongodb://db.invalid:27017/blog', { ...mongoOptions({ proxyUrl: `socks5://127.0.0.1:${proxy.address().port}` }), serverSelectionTimeoutMS: 400, connectTimeoutMS: 200 });
  t.after(async () => { await client.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); });
  await assert.rejects(client.connect(), error => { assert.match(mongoError(error).message, /SOCKS5/); return true; });
  assert.equal(reached, true, 'database destination reached through proxy without local destination DNS');
});
