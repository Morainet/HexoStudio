const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { parseOptions } = require('../server/cli.cjs');
const { smokeCli } = require('../scripts/cli-smoke.cjs');

const cli = path.resolve(__dirname, '../bin/hexostudio.cjs');
function command(args, extraEnv = {}) {
  const env = { ...process.env };
  for (const key of ['HEXO_ROOT', 'HEXOSTUDIO_HOST', 'HEXOSTUDIO_PORT', 'HEXOSTUDIO_SETTINGS', 'HEXOSTUDIO_TOKEN']) delete env[key];
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 10000 });
}

test('CLI options override environment and resolve paths from the caller directory', () => {
  const cwd = path.join(os.tmpdir(), 'caller');
  const options = parseOptions(['start', '-p', '5000', '--host', '::1', '--root', './blog', '--settings', './account.json'],
    { HEXOSTUDIO_PORT: '6000', HEXOSTUDIO_HOST: '0.0.0.0', HEXO_ROOT: '/ignored' }, cwd);
  assert.deepEqual(options, { port: 5000, host: '::1', root: path.join(cwd, 'blog'), settings: path.join(cwd, 'account.json') });
  assert.equal(parseOptions([], {}).host, '127.0.0.1');
  assert.equal(parseOptions([], {}).port, 4545);
  assert.equal(parseOptions([], { HEXOSTUDIO_PORT: '0' }).port, 0);
});

test('CLI rejects unknown commands, flags and invalid values before startup', () => {
  for (const args of [['delete'], ['start', 'extra'], ['--unknown'], ['--port'], ['--port=-1'], ['--port=1.5'], ['--port=65536'], ['--host=https://example.com'], ['--root=']]) {
    assert.throws(() => parseOptions(args, {}));
  }
  const result = command(['start', '--port=bad']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Port must be/);
});

test('CLI help and version work without loading settings or starting a server', () => {
  const env = { HEXOSTUDIO_HOST: '0.0.0.0', HEXOSTUDIO_PORT: 'invalid', HEXOSTUDIO_SETTINGS: 'missing/settings.json' };
  const help = command(['--help'], env);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: hexostudio/);
  const version = command(['--version'], env);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), require('../package.json').version);
});

test('CLI cannot expose the service without an environment token', () => {
  const result = command(['start', '--host', '0.0.0.0', '--port', '0']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HEXOSTUDIO_TOKEN/);
});

test('CLI serves the application from an unrelated working directory and shuts down', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-cli-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await smokeCli(cli, directory);
  assert.equal(fs.existsSync(path.join(directory, 'settings.json')), false);
});

test('CLI reports an occupied port without silently choosing a different port', async t => {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = command(['start', '--port', String(server.address().port)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already in use/);
});
