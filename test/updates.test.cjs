const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker, isNewerRelease } = require('../server/updates.cjs');

test('stable versions compare numerically and respect prerelease installations', () => {
  assert.equal(isNewerRelease('v0.10.0', '0.9.9'), true);
  assert.equal(isNewerRelease('v1.0.0', '0.99.99'), true);
  assert.equal(isNewerRelease('0.8.0', '0.8.0-beta.1'), true);
  assert.equal(isNewerRelease('0.8.0', '0.8.0+build.9'), false);
  assert.equal(isNewerRelease('v0.8.0', '0.9.0'), false);
  assert.equal(isNewerRelease('v0.9.0-beta.1', '0.8.0'), false);
  assert.equal(isNewerRelease('latest', '0.8.0'), false);
});

test('release checks coalesce requests, cache results, and only link to the official repository', async () => {
  let time = 0, calls = 0;
  const check = createUpdateChecker({ version: '0.9.0', now: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/Morainet/HexoStudio/releases/latest');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ tag_name: '0.10.0', html_url: 'https://evil.example' }) };
  } });
  const [a, b] = await Promise.all([check(), check()]);
  assert.equal(calls, 1); assert.equal(a, b);
  assert.equal(a.status, 'available');
  assert.equal(a.currentVersion, '0.9.0');
  assert.equal(a.releaseUrl, 'https://github.com/Morainet/HexoStudio/releases/tag/0.10.0');
  await check(); assert.equal(calls, 1);
  time = 60_001;
  await check(); assert.equal(calls, 2);
});

test('absence, current version and failed checks are distinct, with retry after failure', async () => {
  const check = response => createUpdateChecker({ version: '0.8.0', fetchImpl: async () => response })();
  assert.equal((await check({ status: 404 })).status, 'no-release');
  assert.equal((await check({ ok: true, json: async () => ({ tag_name: 'v0.8.0' }) })).status, 'current');
  for (const response of [
    { status: 403, ok: false },
    { ok: true, json: async () => ({ tag_name: 'v1.0.0', draft: true }) },
    { ok: true, json: async () => ({ tag_name: 'v1.0.0', prerelease: true }) },
    { ok: true, json: async () => ({ tag_name: '../../bad' }) },
    { ok: true, json: async () => { throw new Error('Invalid JSON'); } }
  ]) assert.equal((await check(response)).status, 'unavailable');
  let time = 0, calls = 0;
  const retry = createUpdateChecker({ now: () => time, fetchImpl: async () => {
    if (++calls === 1) throw new Error('Network timeout');
    return { status: 404 };
  } });
  assert.equal((await retry()).status, 'unavailable');
  await retry(); assert.equal(calls, 1);
  time = 30_001;
  assert.equal((await retry()).status, 'no-release');
});
