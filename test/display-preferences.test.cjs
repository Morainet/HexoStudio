const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const i18n = require('../public/i18n.js');

test('translations keep interpolation values and unknown messages intact', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.t('文章管理'), 'Posts');
  assert.equal(i18n.t`草稿已发布：${'草稿 {0} <script>'}`, 'Draft published: 草稿 {0} <script>');
  assert.equal(i18n.t('Unknown driver error'), 'Unknown driver error');
  assert.equal(i18n.t('__proto__'), '__proto__');
  assert.equal(i18n.error('管理员数据库连接或操作失败（ECONNREFUSED）'), 'Administrator database connection or operation failed (ECONNREFUSED)');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.t`保存${'文章'}`, '保存文章');
});

function fixture(stored, blocked = false) {
  const events = new Map(), controls = new Map();
  const document = {
    documentElement: { dataset: {}, style: {} },
    querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, { value: '', classList: { contains: () => true }, append() {}, setAttribute() {}, addEventListener(name, callback) { this[name] = callback; } });
      return controls.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener: (name, callback) => events.set(name, callback),
    dispatchEvent: event => { events.get(event.type)?.(event); return !event.defaultPrevented; }
  };
  const system = { matches: false, addEventListener(name, callback) { this.change = callback; } };
  let saved;
  const context = vm.createContext({
    document, navigator: { language: 'en-US' },
    window: { matchMedia: () => system },
    localStorage: { getItem() { if (blocked) throw new Error('blocked'); return stored; }, setItem(key, value) { if (blocked) throw new Error('blocked'); saved = JSON.parse(value); } },
    CustomEvent: class { constructor(type) { this.type = type; } preventDefault() { this.defaultPrevented = true; } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/i18n.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/preferences.js'), 'utf8'), context);
  events.get('DOMContentLoaded')();
  return { document, controls, events, system, saved: () => saved };
}

test('system theme follows OS changes while an explicit selection stays fixed', () => {
  const f = fixture('{}');
  assert.equal(f.document.documentElement.dataset.theme, 'light');
  f.system.matches = true; f.system.change();
  assert.equal(f.document.documentElement.dataset.theme, 'dark');
  f.controls.get('#theme-preference').change({ target: { value: 'light' } });
  f.system.change();
  assert.equal(f.document.documentElement.dataset.theme, 'light');
  assert.deepEqual(f.saved(), { theme: 'light', language: 'en' });
});

test('saved choices restore before rendering and language changes can be blocked during a save', () => {
  const f = fixture('{"theme":"dark","language":"zh-CN"}');
  assert.equal(f.document.documentElement.dataset.theme, 'dark');
  assert.equal(f.document.documentElement.lang, 'zh-CN');
  const select = f.controls.get('#language-preference');
  f.events.set('hexostudio:before-language', event => event.preventDefault());
  select.value = 'en'; select.change({ target: select });
  assert.equal(select.value, 'zh-CN');
  assert.equal(f.document.documentElement.lang, 'zh-CN');
  assert.equal(f.saved(), undefined);
  f.events.delete('hexostudio:before-language');
  select.value = 'en'; select.change({ target: select });
  assert.equal(f.document.documentElement.lang, 'en');
  assert.equal(f.saved().language, 'en');
});

test('invalid or unavailable preference storage does not prevent startup or theme changes', () => {
  for (const [value, blocked] of [['{broken', false], ['null', false], ['{}', true]]) {
    const f = fixture(value, blocked);
    assert.equal(f.document.documentElement.dataset.theme, 'light');
    assert.doesNotThrow(() => f.controls.get('#theme-preference').change({ target: { value: 'dark' } }));
    assert.equal(f.document.documentElement.dataset.theme, 'dark');
  }
});
