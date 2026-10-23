const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSettings, diagnose } = require('../server/diagnostics.cjs');
const { parseOptions } = require('../server/cli.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-doctor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, settings: path.join(directory, 'settings.json') };
}

test('new installations report actionable warnings without writing settings', t => {
  const { settings } = fixture(t);
  const report = diagnose({ settings }, () => ({ status: null }));
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks.filter(check => check.status === 'warn').map(check => check.id), ['git', 'settings', 'database', 'project']);
  assert.equal(fs.existsSync(settings), false);
});

test('diagnostics never include credentials or raw parser errors', t => {
  const { settings } = fixture(t);
  const secret = 'SECRET_MUST_NOT_APPEAR';
  for (const content of [`{"token":"${secret}", broken}`, JSON.stringify({ connection: { token: secret }, authStorage: { type: 'postgres', url: `postgresql://u:${secret}@db.example/studio` } }), JSON.stringify({ authStorage: { type: 'postgres', url: secret } })]) {
    fs.writeFileSync(settings, content);
    const report = diagnose({ settings }, () => ({ status: 0, stdout: secret }));
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.equal(fs.readFileSync(settings, 'utf8'), content);
  }
});

test('settings preflight rejects malformed JSON, non-objects, directories and oversized files', t => {
  const { directory, settings } = fixture(t);
  for (const content of ['broken', 'null', '[]', '"text"', ' '.repeat(1_000_001)]) {
    fs.writeFileSync(settings, content);
    assert.throws(() => readSettings(settings), /Settings/);
  }
  assert.throws(() => readSettings(directory), /file/);
});

test('project diagnostics distinguish valid source, missing dependencies and invalid folders', t => {
  const { directory, settings } = fixture(t);
  const root = path.join(directory, 'blog');
  fs.mkdirSync(path.join(root, 'source', '_posts'), { recursive: true });
  fs.writeFileSync(path.join(root, '_config.yml'), 'title: Test\n');
  fs.writeFileSync(settings, JSON.stringify({ root }));
  let report = diagnose({ settings }, () => ({ status: 0 }));
  assert.equal(report.checks.find(check => check.id === 'project').status, 'pass');
  assert.equal(report.checks.find(check => check.id === 'hexo').status, 'warn');
  report = diagnose({ settings, root: path.join(directory, 'missing') }, () => ({ status: 0 }));
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(check => check.id === 'project').status, 'fail');
});

test('doctor JSON works without a server and exits nonzero on invalid settings', t => {
  const { settings } = fixture(t);
  fs.writeFileSync(settings, 'invalid SECRET');
  const env = { ...process.env, HEXOSTUDIO_PORT: 'invalid', HEXOSTUDIO_HOST: 'invalid' };
  delete env.HEXO_ROOT;
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/hs.cjs'), 'doctor', '--json', '--settings', settings], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /SECRET/);
});

test('start fails before listening when settings are invalid and paths support quoted tilde', t => {
  const { settings } = fixture(t);
  fs.writeFileSync(settings, '{SECRET');
  const env = { ...process.env }; delete env.HEXO_ROOT;
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/hs.cjs'), 'start', '--port', '0', '--host', '127.0.0.1', '--settings', settings], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not valid JSON/);
  assert.doesNotMatch(result.stderr, /SECRET/);
  assert.doesNotMatch(result.stdout, /http:/);
  assert.equal(parseOptions(['--settings', '~/studio.json'], {}).settings, path.join(os.homedir(), 'studio.json'));
  assert.throws(() => parseOptions(['--json'], {}), /doctor/);
});
