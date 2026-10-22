const MarkdownIt = require('markdown-it');

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true });
const defaultLinkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, index, options, env, self);
};
const MAX_PREVIEW_BYTES = 5_000_000;

function renderPreview(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_PREVIEW_BYTES) {
    throw new Error('预览内容无效或超过 5 MB');
  }
  const body = content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return markdown.render(body);
}

module.exports = { renderPreview };
