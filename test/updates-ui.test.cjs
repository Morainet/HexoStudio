const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const HexoI18n = require('../public/i18n.js');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function fixture() {
  const nodes = new Map(), requests = [], state = { mode: 'cloud', cloud: true, dialogVersion: 0 };
  const $ = key => {
    if (!nodes.has(key)) {
      const classes = new Set();
      nodes.set(key, { textContent: '', dataset: {}, disabled: false, focus() {}, classList: {
        contains: value => classes.has(value), toggle(value, on) { if (on) classes.add(value); else classes.delete(value); }
      } });
    }
    return nodes.get(key);
  };
  const context = vm.createContext({ $, state, HexoI18n, t: HexoI18n.t, document: { activeElement: null }, icon: () => '',
    modal(html) { state.dialogVersion++; $('#modal-content').innerHTML = html; return true; },
    api: name => new Promise((resolve, reject) => requests.push({ name, resolve, reject }))
  });
  vm.runInContext(source.slice(source.indexOf('const releaseHome ='), source.indexOf('function storageFields(')), context);
  return { $, state, context, requests };
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
