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
  for (const [name, type] of [['favicon.svg', 'image/svg+xml'], ['favicon.ico', 'image/x-icon'], ['favicon-32.png', 'image/png'], ['icon-192.png', 'image/png'], ['apple-touch-icon.png', 'image/png']]) {
    const icon = await fetch(`${url}/${name}?v=1`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), type);
    assert.equal(icon.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), fs.readFileSync(path.join(__dirname, '../public', name)));
    const head = await fetch(`${url}/${name}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  for (const name of ['package.json', 'desktop/icons/icon.png', 'constructor']) {
    assert.equal((await fetch(`${url}/${name}`)).status, 404);
  }
  assert.equal((await fetch(`${url}/api/version`)).status, 401);
  const version = await fetch(`${url}/api/version`, { headers: { Authorization: `Bearer ${token}` } });
  const info = await version.json();
  assert.match(info.buildId, /^[a-f0-9]{64}$/);
  const html = await fetch(`${url}/`);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  assert.match(await html.text(), new RegExp(`content="${info.buildId}"`));
  const brand=await (await fetch(`${url}/api/branding`)).json();
  const brandingWrite=headers=>fetch(`${url}/api/branding`,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({revision:brand.revision,branding:{name:'Local OEM',releaseRepository:''}})});
  assert.equal((await brandingWrite({})).status,401);
  assert.equal((await brandingWrite({Authorization:`Bearer ${token}`,Origin:'https://evil.example'})).status,403);
  assert.equal((await brandingWrite({Authorization:`Bearer ${token}`})).status,200);
  assert.equal(JSON.parse(fs.readFileSync(env.HEXOSTUDIO_SETTINGS,'utf8')).branding.name,'Local OEM');
  const publicBrand=await (await fetch(`${url}/api/branding`)).json();
  assert.deepEqual(Object.keys(publicBrand).sort(),['branding','revision']);
  assert.equal((await (await fetch(`${url}/api/updates`,{headers:{Authorization:`Bearer ${token}`}})).json()).status,'disabled');
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
