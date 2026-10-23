const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

async function smokeCli(cli, cwd) {
  const env = { ...process.env };
  for (const key of ['HEXO_ROOT', 'HEXOSTUDIO_HOST', 'HEXOSTUDIO_PORT', 'HEXOSTUDIO_SETTINGS', 'HEXOSTUDIO_TOKEN']) delete env[key];
  const child = spawn(process.execPath, [cli, 'start', '--port', '0', '--settings', path.join(cwd, 'settings.json')], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  const closed = once(child, 'close');
  // Attach immediately so a spawn error is handled while waiting for startup.
  closed.catch(() => {});
  let output = '';
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`CLI startup timed out: ${errors}`)), 15000);
      const finish = (error, url) => { clearTimeout(timeout); error ? reject(error) : resolve(url); };
      child.once('error', error => finish(error));
      child.once('close', code => finish(new Error(`CLI exited ${code}: ${errors}`)));
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/HexoStudio: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      });
    });
    const homepage = await fetch(url);
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /HexoStudio/);
    assert.equal((await fetch(`${url}/app.js`)).status, 200);
    const status = await (await fetch(`${url}/api/auth/status`)).json();
    assert.equal(status.configured, false);
    assert.equal(status.authenticated, false);
    assert.equal((await fetch(`${url}/api/posts`)).status, 401);
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
    try {
      const [code, signal] = await closed;
      if (process.platform !== 'win32') {
        assert.equal(code, 0, `CLI did not shut down cleanly: ${errors}`);
        assert.equal(signal, null);
      }
    } finally { clearTimeout(timer); }
  }
}

module.exports = { smokeCli };
