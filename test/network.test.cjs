const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const network = require('../server/network.cjs');
const { mongoOptions } = require('../server/mongo-connection.cjs');
const { gitEnv } = require('../server/git.cjs');

async function listen(server, t) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return server.address().port;
}
async function proxy(t) {
  const requests = [];
  const server = net.createServer(socket => {
    socket.once('data', () => {
      socket.write(Buffer.from([5, 0]));
      socket.once('data', request => {
        const host = request[3] === 3 ? request.subarray(5, 5 + request[4]).toString() : [...request.subarray(4, 8)].join('.');
        const port = request.readUInt16BE(request.length - 2);
        requests.push({ host, port });
        const upstream = net.connect(port, '127.0.0.1');
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
        upstream.once('connect', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.pipe(upstream).pipe(socket);
        });
      });
    });
  });
  const port = await listen(server, t);
  network.configure(() => ({ mode: 'socks5', proxyUrl: `socks5://127.0.0.1:${port}` }));
  t.after(() => network.configure(() => undefined));
  return requests;
}

test('network settings preserve credentials privately, reject invalid modes, and detect stale writes', () => {
  const saved = network.mutation(undefined, { revision: 'initial', mode: 'socks5', proxyUrl: 'socks5://alice:secret@127.0.0.1:7890' });
  assert.doesNotMatch(JSON.stringify(network.record(saved)), /alice|secret/);
  assert.equal(network.mutation(saved, { revision: saved.revision, mode: 'socks5', proxyUrl: '' }).proxyUrl, saved.proxyUrl);
  assert.throws(() => network.mutation(saved, { revision: 'initial', mode: 'direct' }), /已变化/);
  assert.throws(() => network.mutation(saved, { revision: saved.revision, mode: 'http' }), /网络模式/);
  assert.throws(() => network.mutation(undefined, { revision: 'initial', mode: 'socks5', proxyUrl: 'https://proxy.example' }));
  assert.equal(network.mutation(saved, { revision: saved.revision, mode: 'direct' }).proxyUrl, undefined);
});

test('HTTP requests traverse SOCKS with remote target DNS; explicit direct mode skips it', async t => {
  const target = http.createServer((req, res) => res.end('through-proxy'));
  const port = await listen(target, t), requests = await proxy(t);
  const response = await network.fetchNetwork(`http://destination.invalid:${port}/`, { signal: AbortSignal.timeout(2000) });
  assert.equal(await response.text(), 'through-proxy');
  assert.equal(requests[0].host, 'destination.invalid');
  network.configure(() => ({ mode: 'direct' }));
  const direct = await network.fetchNetwork(`http://127.0.0.1:${port}/`);
  assert.equal(await direct.text(), 'through-proxy'); assert.equal(requests.length, 1);
});

test('a failed manual proxy does not silently fall back to a direct connection', async t => {
  let hits = 0;
  const target = http.createServer((req, res) => { hits++; res.end('unexpected'); });
  const port = await listen(target, t);
  network.configure(() => ({ mode: 'socks5', proxyUrl: 'socks5://127.0.0.1:1' }));
  t.after(() => network.configure(() => undefined));
  await assert.rejects(network.fetchNetwork(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
  assert.equal(hits, 0);
});

test('PostgreSQL connects through SOCKS and completes the native startup exchange', async t => {
  const target = net.createServer(socket => {
    socket.once('data', () => {
      socket.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]));
      socket.once('data', () => socket.end());
    });
  });
  const port = await listen(target, t), requests = await proxy(t);
  const config = { type: 'postgres', url: `postgres://user:pass@database.invalid:${port}/blog` };
  const client = new (require('pg').Client)({ connectionString: config.url, connectionTimeoutMillis: 2000, ...network.databaseStream(config) });
  t.after(() => client.end());
  await client.connect(); await client.end();
  assert.equal(requests[0].host, 'database.invalid');
});

test('MySQL receives a server-first response through SOCKS and reports the actual database error', async t => {
  const target = net.createServer(socket => {
    const body = Buffer.concat([Buffer.from([255, 21, 4]), Buffer.from('#28000test database reached')]);
    const header = Buffer.alloc(4); header.writeUIntLE(body.length, 0, 3);
    socket.end(Buffer.concat([header, body]));
  });
  const port = await listen(target, t), requests = await proxy(t);
  const config = { type: 'mysql', url: `mysql://user:pass@database.invalid:${port}/blog` };
  await assert.rejects(require('mysql2/promise').createConnection({ uri: config.url, connectTimeout: 2000, ...network.databaseStream(config) }), error => error.code === 'ER_ACCESS_DENIED_ERROR');
  assert.equal(requests[0].host, 'database.invalid');
});

test('Git and Mongo inherit the shared proxy while database overrides take priority', t => {
  network.configure(() => ({ mode: 'socks5', proxyUrl: 'socks5://user:secret@127.0.0.1:7890' }));
  t.after(() => network.configure(() => undefined));
  const env = gitEnv({ provider: 'github', token: 'repo-token' });
  assert.equal(env.GIT_CONFIG_VALUE_2, 'socks5h://user:secret@127.0.0.1:7890');
  assert.match(env.GIT_CONFIG_VALUE_0, /^Authorization: Basic /);
  assert.equal(mongoOptions({}).proxyPort, 7890);
  assert.equal(mongoOptions({ proxyUrl: 'socks5://127.0.0.1:1080' }).proxyPort, 1080);
  network.configure(() => ({ mode: 'direct' }));
  assert.equal(gitEnv().GIT_CONFIG_VALUE_0, '');
  assert.equal(gitEnv().NO_PROXY, '*');
  assert.equal(mongoOptions({}).proxyHost, undefined);
});

test('AI proxy pins the validated IP and TLS failure sends no API credentials', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-network-tls-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(folder, 'key.pem'), '-out', path.join(folder, 'cert.pem'), '-days', '1', '-subj', '/CN=public.example'], { stdio: 'ignore' });
  let requests = 0;
  const target = https.createServer({ key: fs.readFileSync(path.join(folder, 'key.pem')), cert: fs.readFileSync(path.join(folder, 'cert.pem')) }, (req, res) => { requests++; res.end('{}'); });
  target.on('tlsClientError', () => {});
  const port = await listen(target, t), destinations = await proxy(t);
  await assert.rejects(require('../server/ai.cjs').completion({ baseUrl: `https://public.example:${port}/v1`, model: 'test', apiKey: 'private-test-key' }, [], {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }], timeout: 2000
  }), /无法连接 AI/);
  assert.equal(destinations[0].host, '93.184.216.34');
  assert.equal(requests, 0, 'no HTTP request or credential is sent before valid TLS');
  await assert.rejects(network.fetchNetwork(`https://public.example:${port}/`, { signal: AbortSignal.timeout(2000) }));
  assert.equal(requests, 0, 'repository/update transport also rejects an untrusted certificate');
});
