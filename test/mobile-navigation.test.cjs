const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(mobile = true) {
  const elements = new Map(), listeners = new Map();
  const document = { activeElement: null, querySelector: key => elements.get(key), addEventListener: (key, fn) => listeners.set(key, fn) };
  function element(key) {
    const attributes = new Map(), classes = new Set(), events = new Map();
    const node = { key, inert: false, attributes, events,
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
      addEventListener: (name, fn) => events.set(name, fn),
      getClientRects: () => [1], focus() { document.activeElement = node; }
    };
    elements.set(key, node); return node;
  }
  const sidebar = element('#workspace-navigation'), toggle = element('#navigation-toggle'), close = element('#navigation-close');
  const main = element('.main'), backdrop = element('#navigation-backdrop'), app = element('#app'), active = element('.nav button.active');
  document.body = element('body');
  sidebar.contains = node => [close, active].includes(node);
  sidebar.querySelectorAll = () => [close, active]; sidebar.querySelector = () => active;
  const viewport = { matches: mobile, addEventListener(name, fn) { this.change = fn; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/mobile.js'), 'utf8'), { document, window: { matchMedia: () => viewport } });
  function key(value, shiftKey = false) {
    const event = { key: value, shiftKey, preventDefault() { this.prevented = true; } };
    listeners.get('keydown')(event); return event;
  }
  return { sidebar, toggle, close, main, backdrop, app, active, document, viewport, listeners, key };
}

test('mobile drawer hides inactive navigation, traps focus, and restores access on dismissal', () => {
  const f = fixture();
  assert.equal(f.sidebar.inert, true); assert.equal(f.main.inert, false);
  f.toggle.events.get('click')();
  assert.equal(f.sidebar.inert, false); assert.equal(f.main.inert, true);
  assert.equal(f.sidebar.attributes.get('aria-modal'), 'true');
  assert.equal(f.document.activeElement, f.close);
  assert.equal(f.key('Tab', true).prevented, true); assert.equal(f.document.activeElement, f.active);
  f.key('Tab'); assert.equal(f.document.activeElement, f.close);
  f.key('Escape');
  assert.equal(f.main.inert, false); assert.equal(f.sidebar.inert, true);
  assert.equal(f.document.activeElement, f.toggle);
  assert.equal(f.toggle.attributes.get('aria-expanded'), 'false');
  f.toggle.events.get('click')(); f.backdrop.events.get('click')();
  assert.equal(f.main.inert, false);
});

test('navigation actions close before dialogs open; resize and logout clear drawer state', () => {
  const f = fixture();
  f.toggle.events.get('click')();
  f.sidebar.events.get('click')({ target: { closest: () => f.active } });
  assert.equal(f.main.inert, false); assert.equal(f.document.activeElement, f.toggle);
  f.toggle.events.get('click')(); f.viewport.matches = false; f.viewport.change();
  assert.equal(f.sidebar.inert, false); assert.equal(f.main.inert, false);
  assert.equal(f.document.activeElement, f.active);
  f.viewport.matches = true; f.viewport.change();
  assert.equal(f.sidebar.inert, true); assert.equal(f.document.activeElement, f.toggle);
  f.toggle.events.get('click')(); f.app.classList.toggle('hidden', true);
  f.listeners.get('hexostudio:render')();
  assert.equal(f.main.inert, false); assert.equal(f.document.body.classList.contains('navigation-open'), false);
  const desktop = fixture(false);
  assert.equal(desktop.sidebar.inert, false);
  desktop.toggle.events.get('click')(); assert.equal(desktop.main.inert, false);
});
