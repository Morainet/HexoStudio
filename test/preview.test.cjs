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

test('renders inline and block math while preserving code, currency, and escaped dollar signs', () => {
  const html = renderPreview('行内 $E=mc^2$\n\n$$\n\\sum_{i=1}^{n}i = \\frac{n(n+1)}{2}\n$$\n\n`$code$`\n\n价格 $5 and $10，转义 \\$x\\$');
  assert.match(html, /class="katex"/); assert.match(html, /class="katex-display"/);
  assert.match(html, /<code>\$code\$<\/code>/);
  assert.match(html, /价格 \$5 and \$10/); assert.match(html, /转义 \$x\$/);
  assert.match(renderPreview('$$x^2$$'), /katex-display/);
  assert.doesNotMatch(renderPreview('```text\n$x$\n```'), /class="katex/);
});

test('invalid or hostile math and Mermaid stay inert and do not break other Markdown', () => {
  const html = renderPreview('坏公式 $\\invalid{x}$\n\n# 后续内容\n\n$\\href{javascript:alert(1)}{click}$\n\n$\\includegraphics{https://evil.example/x}$\n\n```mermaid\ngraph TD\nA["<script>alert(1)</script>"]-->B\n```');
  assert.match(html, /class="math-error"/); assert.match(html, /<h1>后续内容<\/h1>/);
  assert.doesNotMatch(html, /<script|<iframe|<img|<a\s/i);
  assert.match(html, /class="mermaid-source"/); assert.match(html, /&lt;script&gt;/);
  const tooLarge = renderPreview('$' + 'x'.repeat(10001) + '$');
  assert.match(tooLarge, /math-error/);
});
