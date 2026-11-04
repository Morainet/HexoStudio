const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

test('command HTTP routes authenticate, serialize, recover after disconnect and cancel by task id', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-command-http-'));
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true }); fs.writeFileSync(path.join(root, '_config.yml'), 'title: Test\ndeploy:\n  type: git\n');
  const entry = path.join(root, 'node_modules', 'hexo', 'bin', 'hexo'); fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "console.log('working');setInterval(()=>console.log('tick'),1000);");
  const values = { HEXO_ROOT: root, HEXOSTUDIO_SETTINGS: path.join(root, 'settings.json'), HEXOSTUDIO_TOKEN: 'command-test-token', HEXOSTUDIO_MODE: 'web' };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  const { server, url } = await require('../server/index.cjs').startServer(0);
  let task;
  const headers = { Authorization: 'Bearer command-test-token', Origin: url, 'Content-Type': 'application/json' };
  t.after(async () => {
    if (task?.status === 'running') await fetch(url + '/api/command/cancel', { method: 'POST', headers, body: JSON.stringify({ id: task.id }) });
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal((await fetch(url + '/api/command/status')).status, 401);
  assert.equal((await fetch(url + '/api/command/cancel', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const stream = await fetch(url + '/api/command', { method: 'POST', headers, body: JSON.stringify({ action: 'generate-deploy' }) });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader(); await reader.read(); await reader.cancel();
  let status = await (await fetch(url + '/api/command/status', { headers })).json(); task = status.task;
  assert.equal(task.status, 'running'); assert.equal(status.hexoInstalled, true);
  assert.equal((await fetch(url + '/api/command', { method: 'POST', headers, body: JSON.stringify({ action: 'clean' }) })).status, 409);
  assert.equal((await fetch(url + '/api/git/stage', { method: 'POST', headers, body: JSON.stringify({ paths: ['x'] }) })).status, 409);
  assert.equal((await fetch(url + '/api/command/cancel', { method: 'POST', headers, body: JSON.stringify({ id: 'stale-id' }) })).status, 409);
  assert.equal((await fetch(url + '/api/command/cancel', { method: 'POST', headers, body: JSON.stringify({ id: task.id }) })).status, 200);
  for (let i = 0; i < 40; i++) {
    task = (await (await fetch(url + '/api/command/status', { headers })).json()).task;
    if (task.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(task.status, 'cancelled'); assert.equal(task.step, 'generate'); assert.doesNotMatch(task.log, /\$ hexo deploy/);
});
