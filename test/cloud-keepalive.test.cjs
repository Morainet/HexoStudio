const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudHandler } = require('../server/cloud.cjs');
const { cloudConfig } = require('../server/cloud-store.cjs');

const secret = 'cron-test-'.repeat(8);
function fixture(cronSecret = secret) {
  let reads = 0, unavailable = false;
  const config = cloudConfig({
    HEXOSTUDIO_SECRET: 'ab'.repeat(32), HEXOSTUDIO_SETUP_KEY: 'setup-test-'.repeat(8),
    HEXOSTUDIO_DATABASE_URL: 'mongodb+srv://example.invalid/studio',
    HEXOSTUDIO_ORIGIN: 'https://studio.example', CRON_SECRET: cronSecret
  });
  const store = {
    async read() {
      reads++;
      if (unavailable) throw new Error('private database address and credentials');
      return { admin: { hash: 'private-admin-hash' }, connection: { token: 'private-repository-token' } };
    },
    async update() { assert.fail('Keepalive must not mutate shared state'); }
  };
  const handler = createCloudHandler({ config, store });
  return {
    get reads() { return reads; },
    failDatabase() { unavailable = true; },
    async call({ method = 'GET', authorization, path = '/api/cron/database-keepalive' } = {}) {
      const req = { url: path, method, headers: authorization === undefined ? {} : { authorization } };
      const res = {
        writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.body = JSON.parse(body); }
      };
      await handler(req, res, () => assert.fail('Cron must not serve a static file'));
      return res;
    }
  };
}

test('keepalive authenticates before touching the database, even without a configured secret', async () => {
  for (const value of [undefined, '', 'too-short']) {
    const f = fixture(value === undefined ? null : value);
    assert.equal((await f.call({ authorization: 'Bearer undefined' })).status, 503);
    assert.equal(f.reads, 0);
  }
  const f = fixture();
  for (const authorization of [undefined, 'Bearer wrong', `Bearer ${'x'.repeat(secret.length)}`, `bearer ${secret}`, [secret]]) {
    assert.equal((await f.call({ authorization })).status, 401);
  }
  assert.equal(f.reads, 0);
  const rejected = await f.call({ method: 'POST', authorization: `Bearer ${secret}` });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.Allow, 'GET');
  assert.equal(f.reads, 0);
});

test('each authorized cron invocation reads the database without a user session or exposing its contents', async () => {
  const f = fixture();
  for (let i = 1; i <= 2; i++) {
    const start = Date.now();
    const response = await f.call({ authorization: `Bearer ${secret}` });
    assert.equal(response.status, 200);
    assert.equal(f.reads, i);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['Set-Cookie'], undefined);
    assert.deepEqual(Object.keys(response.body).sort(), ['checkedAt', 'ok']);
    assert.equal(response.body.ok, true);
    assert.ok(Date.parse(response.body.checkedAt) >= start);
    assert.ok(Date.parse(response.body.checkedAt) <= Date.now());
  }
});

test('keepalive reports a failed database read as unavailable without leaking driver details', async () => {
  const f = fixture();
  f.failDatabase();
  const response = await f.call({ authorization: `Bearer ${secret}` });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: '数据库保活检查失败，请检查数据库连接及集群状态' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(f.reads, 1);
  assert.equal((await f.call({ path: '/api/health' })).status, 200);
  assert.equal(f.reads, 1); // Process health deliberately remains independent of the database.
});

test('Vercel schedules the protected database endpoint once a day', () => {
  const { crons } = require('../vercel.json');
  assert.deepEqual(crons, [{ path: '/api/cron/database-keepalive', schedule: '0 3 * * *' }]);
});
