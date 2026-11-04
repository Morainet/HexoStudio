const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../public/editor-tools.js');

test('literal search supports punctuation, Unicode and stable original offsets', () => {
  assert.deepEqual(tools.find('A.* a.*', 'a.*').matches, [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.deepEqual(tools.find('A.* a.*', 'a.*', true).matches, [{ start: 4, end: 7 }]);
  assert.deepEqual(tools.find('İABC 中文🙂abc', 'abc').matches, [{ start: 1, end: 4 }, { start: 9, end: 12 }]);
  assert.equal(tools.find('a\\b [x] $&', 'a\\b [x] $&').matches.length, 1);
  assert.deepEqual(tools.find('abc', '').matches, []);
  assert.equal(tools.find('aa', 'aaa').matches.length, 0);
});

test('replacement preserves literal dollar patterns, quotes, backslashes and newlines', () => {
  const source = '猫 cat CAT';
  const result = tools.replaceAll(source, tools.find(source, 'cat').matches, '$&\\\n<script>');
  assert.equal(result, '猫 $&\\\n<script> $&\\\n<script>');
  assert.equal(tools.replaceAll('aaa', tools.find('aaa', 'a').matches, ''), '');
  assert.equal(tools.replaceAll('aaaa', tools.find('aaaa', 'aa').matches, 'a'), 'aa');
  assert.equal(tools.find('x'.repeat(10001), 'x').limited, true);
  assert.equal(tools.find('x'.repeat(10000), 'x').limited, false);
});

test('snippet selection stays inside inserted content and code fences safely enclose source', () => {
  const code = tools.snippet('code', '```js\nalert(1)\n```');
  assert.match(code.text, /^\n````text\n/);
  assert.equal(code.text.slice(code.start, code.end), '```js\nalert(1)\n```');
  const math = tools.snippet('math', 'x^2 + y^2');
  assert.equal(math.text, '\n$$\nx^2 + y^2\n$$\n');
  assert.equal(math.text.slice(math.start, math.end), 'x^2 + y^2');
  for (const kind of ['code', 'table', 'mermaid', 'math']) {
    const result = tools.snippet(kind, '');
    assert.ok(result.end > result.start && result.end < result.text.length);
  }
  assert.equal(tools.snippet('table', '').text.slice(3, 5), '列一');
  assert.equal(tools.snippet('no-such-kind', ''), null);
});

function uiFixture(text) {
  const fs = require('node:fs'), vm = require('node:vm');
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set(id === 'editor-find-panel' ? ['hidden'] : []);
      nodes.set(id, { value: '', textContent: '', disabled: false, selectionStart: 0, selectionEnd: 0, clientHeight: 500,
        classList: { contains: c => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
        setAttribute() {}, focus() {}, select() {}, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
        closest() { return node('panel'); },
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
        setRangeText(value, start, end) { this.value = this.value.slice(0, start) + value + this.value.slice(end); this.setSelectionRange(start + value.length, start + value.length); },
        dispatchEvent(event) { this.listeners[event.type]?.(event); }
      });
    }
    return nodes.get(id);
  }
  let changed = 0, busy = false;
  const editor = node('editor'); editor.value = text;
  const context = vm.createContext({ module: { exports: {} }, document: { getElementById: node, execCommand: () => false }, Event: class { constructor(type) { this.type = type; } }, getComputedStyle: () => ({ lineHeight: '24px' }) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/editor-tools.js'), 'utf8'), context);
  context.module.exports.attach({ editor, t: s => s, changed: () => changed++, remember() {}, writable: () => !busy, showWrite() {} });
  return { node, editor, get changed() { return changed; }, busy(value) { busy = value; } };
}

test('search wraps in both directions, replaces current only and respects busy state', () => {
  const f = uiFixture('cat CAT cat');
  f.node('editor-find-toggle').onclick();
  const query = f.node('editor-find-query'); query.value = 'cat'; query.oninput();
  f.node('editor-find-next').onclick(); assert.equal(f.editor.selectionStart, 0);
  f.node('editor-find-prev').onclick(); assert.equal(f.editor.selectionStart, 8);
  f.node('editor-find-next').onclick(); assert.equal(f.editor.selectionStart, 0);
  f.node('editor-find-replacement').value = '$&';
  f.busy(true); f.node('editor-find-replace').onclick(); assert.equal(f.editor.value, 'cat CAT cat');
  f.busy(false); f.node('editor-find-replace').onclick(); assert.equal(f.editor.value, '$& CAT cat');
  assert.equal(f.editor.selectionStart, 3); // Next remaining match is selected.
  f.node('editor-find-case').onclick();
  assert.equal(f.node('editor-find-count').textContent, '0 / 1');
  f.node('editor-find-all').onclick(); assert.equal(f.editor.value, '$& CAT $&');
  assert.equal(f.changed, 2);
});

test('too many matches or an oversized replacement never mutates the editor', () => {
  for (const [text, replacement] of [['x'.repeat(10001), 'z'], ['x'.repeat(10000), 'z'.repeat(1000)]]) {
    const f = uiFixture(text); f.node('editor-find-toggle').onclick();
    f.node('editor-find-query').value = 'x'; f.node('editor-find-query').oninput();
    f.node('editor-find-replacement').value = replacement; f.node('editor-find-replacement').oninput();
    assert.equal(f.node('editor-find-all').disabled, true);
    f.node('editor-find-all').onclick();
    assert.equal(f.editor.value, text); assert.equal(f.changed, 0);
  }
});
