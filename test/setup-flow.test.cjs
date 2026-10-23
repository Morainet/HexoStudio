const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the actual form handlers with an in-memory DOM and API, without
// creating administrator accounts or connecting to a user's database.
function fixture() {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      value: '', dataset: {}, disabled: false, textContent: '', children: [],
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle(name, force) { if (force) classes.add(name); else classes.delete(name); } },
      append(child) { this.children.push(child); if (child.id) elements.set(`#${child.id}`, child); },
      replaceChildren() { this.children = []; }, focus() {}, setAttribute() {}, removeAttribute() {}, reset() {}
    };
  }
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  $('#auth-storage-type').value = 'postgres';
  const calls = [];
  const state = {};
  let fail = false;
  let renders = 0;
  const context = vm.createContext({ $, state,
    document: { createElement: element, querySelectorAll: () => [] },
    api: async (name, options) => {
      calls.push({ name, data: options?.data });
      if (fail) throw new Error('数据库连接失败');
      if (name === 'status') return { root: null, mode: 'web' };
      return { csrf: 'test-session' };
    },
    refreshPosts: async () => {}, render: () => { renders++; }
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function storageFields('), source.indexOf("$('#logout').onclick")), context);
  return { $, calls, state, show: context.showAuth, fail(value) { fail = value; }, get renders() { return renders; }, submit: () => $('#auth-form').onsubmit({ preventDefault() {} }) };
}

test('database comes first; failed validation stays on the same step and can retry', async () => {
  const f = fixture(); f.show(false);
  assert.equal(f.$('#auth-form').dataset.step, 'storage');
  assert.equal(f.$('#auth-account-fields').disabled, true);
  f.$('#auth-storage-url').value = 'postgresql://test@localhost/test';
  f.fail(true); await f.submit();
  assert.equal(f.$('#auth-form').dataset.step, 'storage');
  assert.equal(f.$('#auth-storage-row').disabled, false);
  assert.equal(f.$('#auth-submit').disabled, false);
  assert.match(f.$('#auth-error').textContent, /连接失败/);
  f.fail(false); await f.submit();
  assert.equal(f.$('#auth-form').dataset.step, 'account');
  assert.equal(f.$('#auth-storage-row').disabled, true);
  assert.equal(f.$('#auth-account-fields').disabled, false);
  assert.deepEqual(f.calls.map(call => call.name), ['auth/storage/test', 'auth/storage/test']);
});

test('back preserves inputs and revalidates; account creation keeps selected database', async () => {
  const f = fixture(); f.show(false);
  const url = 'postgresql://test@localhost/test';
  f.$('#auth-storage-url').value = url;
  await f.submit();
  f.$('#auth-username').value = 'admin';
  f.$('#auth-password').value = 'test-password-long';
  f.$('#auth-confirm').value = 'different';
  await f.submit();
  assert.equal(f.calls.length, 1);
  f.$('#auth-back').onclick();
  assert.equal(f.$('#auth-storage-url').value, url);
  assert.equal(f.$('#auth-username').value, 'admin');
  await f.submit();
  f.$('#auth-confirm').value = 'test-password-long';
  await f.submit();
  assert.deepEqual(f.calls.map(call => call.name), ['auth/storage/test', 'auth/storage/test', 'auth/setup', 'status']);
  assert.equal(f.calls[2].data.storage.url, url);
  assert.equal(f.state.csrf, 'test-session');
  assert.equal(f.state.root, null);
  assert.equal(f.renders, 1); // The workspace routes an unconnected account to blog setup.
  assert.equal(f.$('#auth-password').value, '');
  assert.equal(f.$('#auth-storage-url').value, '');
});

test('existing accounts go directly to login without database validation', async () => {
  const f = fixture(); f.show(true);
  assert.equal(f.$('#auth-form').dataset.mode, 'login');
  assert.equal(f.$('#auth-form').dataset.step, 'account');
  assert.equal(f.$('#auth-storage-row').disabled, true);
  assert.equal(f.$('#auth-back').classList.contains('hidden'), true);
  f.$('#auth-username').value = 'admin';
  f.$('#auth-password').value = 'test-password-long';
  await f.submit();
  assert.deepEqual(f.calls.map(call => call.name), ['auth/login', 'status']);
  assert.equal(f.calls[0].data.storage, undefined);
});
