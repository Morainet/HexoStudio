const test = require('node:test');
const assert = require('node:assert/strict');
const network = require('../server/network.cjs');
const { createChecker } = require('../server/network-check.cjs');

test('connection check uses the draft without saving and contacts only the fixed credential-free HTTPS target', async t => {
  const saved = { mode: 'direct', revision: 'saved-version' };
  network.configure(() => saved); t.after(() => network.configure(() => undefined));
  let call, cancelled = false;
  const check = createChecker({ cooldown: 0, fetchImpl: async (url, options) => {
    call = { url, options }; return { ok: true, body: { async cancel() { cancelled = true; } } };
  } });
  const result = await check({ mode: 'socks5', proxyUrl: 'socks5://alice:secret@127.0.0.1:7890', revision: saved.revision, target: 'http://private.example' });
  assert.equal(result.ok, true); assert.equal(result.mode, 'socks5');
  assert.equal(call.url, 'https://api.github.com/rate_limit');
  assert.equal(call.options.redirect, 'error'); assert.equal(call.options.headers.Authorization, undefined);
  assert.equal(network.current(), saved); assert.equal(saved.mode, 'direct');
  assert.equal(cancelled, true); assert.doesNotMatch(JSON.stringify(result), /alice|secret|127\.0/);
  await assert.rejects(check({ mode: 'direct', revision: 'stale' }), /已变化/);
});

test('check returns safe error categories and times out without reporting success', async t => {
  network.configure(() => ({ mode: 'direct' })); t.after(() => network.configure(() => undefined));
  const input = { mode: 'direct', revision: 'initial' };
  for (const [code, expected] of [['EPROXY', 'proxy'], ['ENOTFOUND', 'dns'], ['CERT_HAS_EXPIRED', 'tls'], ['ECONNRESET', 'network']]) {
    const check = createChecker({ fetchImpl: async () => { throw Object.assign(new Error('private-credential'), { cause: { code } }); } });
    const result = await check(input);
    assert.equal(result.ok, false); assert.equal(result.reason, expected);
    assert.doesNotMatch(JSON.stringify(result), /private-credential/);
  }
  const check = createChecker({ timeout: 20, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal((await check(input)).reason, 'timeout');
  assert.equal((await createChecker({ readOnly: true, fetchImpl: async () => ({ ok: false, body: null }) })({})).reason, 'http');
});

test('concurrent checks and repeated clicks are limited and a later retry is allowed', async t => {
  network.configure(() => ({ mode: 'direct' })); t.after(() => network.configure(() => undefined));
  let finish, time = 100;
  const check = createChecker({ now: () => time, cooldown: 50, fetchImpl: () => new Promise(resolve => { finish = () => resolve({ ok: true }); }) });
  const input = { mode: 'direct', revision: 'initial' };
  const pending = check(input);
  await assert.rejects(check(input), error => error.status === 429);
  time = 120; finish(); assert.equal((await pending).elapsedMs, 20);
  await assert.rejects(check(input), error => error.status === 429);
  time = 171; const retry = check(input); finish(); assert.equal((await retry).ok, true);
});
