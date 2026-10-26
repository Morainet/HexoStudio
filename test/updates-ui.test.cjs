const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const HexoI18n = require('../public/i18n.js');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function fixture({ mode = 'cloud', buildId } = {}) {
  const nodes = new Map(), requests = [], state = { mode, cloud: mode === 'cloud', dialogVersion: 0 };
  const $ = key => {
    if (!nodes.has(key)) {
      const classes = new Set();
      nodes.set(key, { textContent: '', dataset: {}, disabled: false, focus() {}, classList: {
        contains: value => classes.has(value), toggle(value, on) { if (on) classes.add(value); else classes.delete(value); }
      } });
    }
    return nodes.get(key);
  };
  if (buildId) $('meta[name="hexostudio-build"]').content = buildId;
  let reloads = 0;
  const context = vm.createContext({ $, state, HexoI18n, t: HexoI18n.t, document: { activeElement: null }, icon: () => '',
    window: { location: { reload() { reloads++; } } },
    canLeaveEditor: () => !state.editorDirty, canLeaveConfig: () => !state.configDirty, toast() {},
    modal(html) { state.dialogVersion++; $('#modal-content').innerHTML = html; return true; },
    api: name => new Promise((resolve, reject) => requests.push({ name, resolve, reject }))
  });
  vm.runInContext(source.slice(source.indexOf('const releaseHome ='), source.indexOf('function storageFields(')), context);
  return { $, state, context, requests, get reloads() { return reloads; } };
}
const result = { status: 'available', currentVersion: '0.8.0', latestVersion: '0.9.0', checkedAt: '2026-10-26T00:00:00Z', releaseUrl: 'https://github.com/Morainet/HexoStudio/releases/tag/0.9.0' };
test('background check and dialog share a request, badge and official release link', async () => {
  const f = fixture();
  const background = f.context.checkForUpdates();
  const dialog = f.$('#version-updates').onclick();
  assert.equal(f.requests.length, 1);
  assert.equal(f.$('#update-check').disabled, true);
  f.requests[0].resolve(result); await Promise.all([background, dialog]);
  assert.equal(f.$('#update-badge').classList.contains('hidden'), false);
  assert.equal(f.$('#update-current').textContent, 'v0.8.0');
  assert.equal(f.$('#update-release').href, result.releaseUrl);
  assert.equal(f.$('#update-check').disabled, false);
  assert.match(f.$('#modal-content').innerHTML, /Vercel/);
  const retry = f.$('#update-check').onclick();
  f.requests[1].reject(new Error('offline')); await retry;
  assert.equal(f.$('#update-status').textContent, '暂时无法检查更新，请稍后重试');
  assert.equal(f.$('#update-badge').classList.contains('hidden'), true);
  assert.equal(f.$('#update-current').textContent, 'v0.8.0');
  assert.equal(f.$('#update-latest').textContent, '—');
});
test('a late response never updates a closed or replaced dialog', async () => {
  const f = fixture();
  const opening = f.$('#version-updates').onclick();
  f.state.dialogVersion++;
  f.$('#update-status').textContent = 'another dialog';
  f.requests[0].resolve(result); await opening;
  assert.equal(f.$('#update-status').textContent, 'another dialog');
});

test('desktop offers an installer without website deployment polling or refresh', async () => {
  const f = fixture({ mode: 'desktop', buildId: 'a'.repeat(64) });
  const opening = f.$('#version-updates').onclick();
  assert.deepEqual(f.requests.map(x => x.name), ['updates']);
  f.requests[0].resolve(result); await opening;
  assert.match(f.$('#modal-content').innerHTML, /应用更新/);
  assert.match(f.$('#modal-content').innerHTML, /已安装版本/);
  assert.equal(f.$('#update-status').textContent, '应用有新版本可安装');
  assert.equal(f.$('#update-release').innerHTML, '下载新版');
  assert.equal(f.$('#update-web-ready').classList.contains('hidden'), true);
  f.state.webUpdateAvailable = true;
  f.context.refreshUpdatedWebsite(); assert.equal(f.reloads, 0);
});
test('website detects same-version deployment changes independently of releases and protects edits', async () => {
  const f = fixture({ buildId: 'a'.repeat(64) });
  const opening = f.$('#version-updates').onclick();
  assert.deepEqual(f.requests.map(x => x.name), ['version', 'updates']);
  f.requests[0].resolve({ version: '0.8.0', buildId: 'b'.repeat(64) });
  f.requests[1].resolve({ currentVersion: '0.8.0', status: 'unavailable' }); await opening;
  assert.equal(f.$('#web-update-notice').classList.contains('hidden'), false);
  assert.equal(f.$('#update-web-ready').classList.contains('hidden'), false);
  assert.equal(f.$('#update-badge').textContent, '可刷新');
  assert.match(f.$('#modal-content').innerHTML, /当前部署版本/);
  for (const flag of ['editorDirty', 'configDirty', 'saving', 'uploading', 'gitBusy', 'modalBusy', 'connecting']) {
    f.state[flag] = true;
    f.context.refreshUpdatedWebsite(); assert.equal(f.reloads, 0, flag);
    f.state[flag] = false;
  }
  const failed = f.context.checkDeployment();
  f.requests[2].reject(new Error('offline')); await failed;
  assert.equal(f.state.webUpdateAvailable, true);
  f.context.refreshUpdatedWebsite(); assert.equal(f.reloads, 1);
  const rollback = f.context.checkDeployment();
  f.requests[3].resolve({ version: '0.8.0', buildId: 'a'.repeat(64) }); await rollback;
  assert.equal(f.state.webUpdateAvailable, false);
  assert.equal(f.$('#web-update-notice').classList.contains('hidden'), true);
});
