const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPreview } = require('../server/preview.cjs');

test('renders Markdown features used by Hexo posts', () => {
  const html = renderPreview('---\ntitle: Preview\n---\n\n# 标题\n\n![图片](/images/hexostudio/photo.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<img src="\/images\/hexostudio\/photo.png" alt="图片"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /title: Preview/);
});

test('does not render scripts or unsafe links', () => {
  const html = renderPreview('[click](javascript:alert(1))\n\n![bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img src=x|href="javascript:|src="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
});

test('external links open without access to the editor page', () => {
  const html = renderPreview('[Hexo](https://hexo.io)');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
