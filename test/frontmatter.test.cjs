const test = require('node:test');
const assert = require('node:assert/strict');
const { updateFrontmatter } = require('../server/frontmatter.cjs');

test('updates selected fields while preserving custom YAML and article body', () => {
  const source = '---\ntitle: Old title\ntags:\n  - old\ncover: /cover.png\ncustom:\n  nested: yes\n---\n\n正文\n';
  const result = updateFrontmatter(source, { title: '新标题', tags: ['Hexo', '写作'], categories: ['记录'] });
  assert.match(result, /title: "新标题"/);
  assert.match(result, /tags: \["Hexo","写作"\]/);
  assert.match(result, /categories: \["记录"\]/);
  assert.match(result, /cover: \/cover\.png\ncustom:\n  nested: yes/);
  assert.match(result, /---\n\n正文\n$/);
  assert.doesNotMatch(result, /  - old/);
});

test('preserves CRLF and rejects unsupported fields', () => {
  const result = updateFrontmatter('---\r\ntitle: Old\r\n---\r\nBody', { title: 'New' });
  assert.equal(result, '---\r\ntitle: "New"\r\n---\r\nBody');
  assert.throws(() => updateFrontmatter('Body', { permalink: 'bad' }), /不支持/);
});
