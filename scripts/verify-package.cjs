const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { smokeCli } = require('./cli-smoke.cjs');

async function verify() {
  const root = path.resolve(__dirname, '..');
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this check with npm run test:package.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexostudio-npm-'));
  const run = (args, cwd) => {
    const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache') };
    for (const key of ['HEXO_ROOT', 'HEXOSTUDIO_HOST', 'HEXOSTUDIO_PORT', 'HEXOSTUDIO_SETTINGS', 'HEXOSTUDIO_TOKEN']) delete env[key];
    const result = spawnSync(process.execPath, [npm, ...args], {
      cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
      env
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed:\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  };
  try {
    const [packed] = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root));
    const names = packed.files.map(file => file.path);
    const previewAssets = require('../public/preview-assets.json').files;
    for (const name of ['public/preview-assets.json', 'public/rich-preview.js', 'public/diagram-preview.html', ...Object.keys(previewAssets).map(name => `public/${name}`)]) assert.ok(names.includes(name), `Missing preview asset: ${name}`);
    for (const required of ['bin/hs.cjs', 'server/cli.cjs', 'server/index.cjs', 'public/index.html', 'public/app.js', 'public/favicon.svg', 'public/favicon.ico', 'public/favicon-32.png', 'public/icon-192.png', 'public/apple-touch-icon.png', 'LICENSE', 'README.md', 'CHANGELOG.md', 'package.json']) {
      assert.ok(names.includes(required), `Missing package file: ${required}`);
    }
    for (const name of names) {
      if (Object.hasOwn(previewAssets, name.replace(/^public\//, ''))) continue;
      assert.match(name, /^(?:bin\/[^/]+\.cjs|server\/[^/]+\.cjs|public\/(?:preview-assets\.json|[^/]+\.(?:html|js|css|png|ico|svg))|docs\/[^/]+\.md|README\.md|CHANGELOG\.md|LICENSE|package\.json)$/,
        `Unexpected package file: ${name}`);
    }
    const installation = path.join(temporary, 'installation');
    const runtime = path.join(temporary, 'runtime');
    fs.mkdirSync(installation);
    fs.mkdirSync(runtime);
    fs.writeFileSync(path.join(installation, 'package.json'), JSON.stringify({ name: 'hexostudio-install-check', private: true }));
    run(['install', path.join(temporary, packed.filename), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], installation);
    const installed = path.join(installation, 'node_modules', ...packed.name.split('/'));
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'server/index.cjs');
    assert.deepEqual(manifest.bin, { hs: 'bin/hs.cjs' });
    assert.equal(fs.existsSync(path.join(installation, 'node_modules', 'electron')), false);
    assert.equal(fs.existsSync(path.join(installation, 'node_modules', 'electron-builder')), false);
    assert.equal(fs.existsSync(path.join(installation, 'node_modules', 'mermaid')), false);
    assert.match(require(path.join(installed, 'server/preview.cjs')).renderPreview('$E=mc^2$'), /class="katex"/);
    const fields = require(path.join(installed, 'server/article-fields.cjs'));
    assert.equal(fields.inspect('---\ncover: /cover.jpg\n---\nBody')[0].value, '/cover.jpg');
    const service = require(path.join(installed, 'server/cli-service.cjs'));
    const managedSettings = path.join(runtime, 'managed.json');
    try {
      const started = run(['exec', '--offline', '--no', '--', 'hs', 'start', '-d', '--port', '0', '--settings', managedSettings], installation);
      assert.match(started, /Background service started/);
      const status = JSON.parse(run(['exec', '--offline', '--no', '--', 'hs', 'status', '--json', '--settings', managedSettings], installation));
      assert.equal(status.status, 'running');
      assert.equal((await fetch(status.url)).status, 200);
    } finally { await service.stop(managedSettings); }
    const version = run(['exec', '--offline', '--no', '--', 'hs', '--version'], installation).trim();
    assert.equal(version, manifest.version);
    const diagnostics = JSON.parse(run(['exec', '--offline', '--no', '--', 'hs', 'doctor', '--json', '--settings', path.join(runtime, 'settings.json')], installation));
    assert.equal(diagnostics.ok, true);
    assert.ok(diagnostics.checks.some(check => check.id === 'settings'));
    await smokeCli(path.join(installed, manifest.bin.hs), runtime);
    const destination = process.env.HEXOSTUDIO_PACKAGE_OUTPUT || path.join(root, 'dist', 'npm');
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(temporary, packed.filename), path.join(destination, packed.filename));
    console.log(`Verified ${packed.filename}: ${names.length} files, ${packed.size} bytes; clean install, CLI, HTTP and shutdown passed.`);
    console.log(`Package: ${path.join(destination, packed.filename)}`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

verify().catch(error => { console.error(error.message); process.exitCode = 1; });
