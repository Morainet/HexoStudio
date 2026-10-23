const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('HTTP config routes reject anonymous writes, cross-site writes and external symlinks', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-http-security-'));
  const root = path.join(temporary, 'blog');
  const external = path.join(temporary, 'external');
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true });
  fs.mkdirSync(path.join(external, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Temporary test\n');
  const sentinel = path.join(external, 'demo', '_config.yml');
  fs.writeFileSync(sentinel, 'secret: untouched\n');
  fs.symlinkSync(external, path.join(root, 'themes'), 'dir');
  const token = crypto.randomBytes(32).toString('hex');
  const env = {
    HEXOSTUDIO_SETTINGS: path.join(temporary, 'settings.json'), HEXO_ROOT: root,
    HEXOSTUDIO_HOST: '127.0.0.1', HEXOSTUDIO_TOKEN: token
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const { server, url } = await require('../server/index.cjs').startServer(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const write = headers => fetch(`${url}/api/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ scope: 'theme:demo', content: 'overwritten: true\n' })
  });
  assert.equal((await write({})).status, 401);
  assert.equal((await write({ Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await write({ Authorization: `Bearer ${token}` })).status, 400);
  const read = await fetch(`${url}/api/config?scope=theme:demo`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(read.status, 400);
  assert.doesNotMatch(await read.text(), /secret: untouched/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'secret: untouched\n');
  const safe = await fetch(`${url}/api/config?scope=site`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(safe.status, 200);
  assert.equal((await safe.json()).content, 'title: Temporary test\n');
});
