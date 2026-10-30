const katex = require('katex');
module.exports = function mathPlugin(markdown) {
  function render(content, display, env) {
    env.mathCount = (env.mathCount || 0) + 1;
    if (content.length > 10000 || env.mathCount > 200) return `<span class="math-error">${markdown.utils.escapeHtml(content)}</span>`;
    try { return katex.renderToString(content, { displayMode: display, trust: false, strict: 'ignore', throwOnError: true, maxSize: 10, maxExpand: 300, macros: {} }); }
    catch { return `<span class="math-error">${markdown.utils.escapeHtml(content)}</span>`; }
  }
  markdown.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== '$') return false;
    const size = state.src[start + 1] === '$' ? 2 : 1;
    if (/\s/.test(state.src[start + size] || '')) return false;
    let end = start + size;
    for (; end < state.posMax; end++) {
      if (state.src[end] === '\n') return false;
      if (state.src[end] === '\\') { end++; continue; }
      if (state.src.slice(end, end + size) !== '$'.repeat(size)) continue;
      if (end === start + size || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + size] || '')) continue;
      if (!silent) { const token = state.push('math_inline', 'math', 0); token.content = state.src.slice(start + size, end); token.meta = { display: size === 2 }; }
      state.pos = end + size; return true;
    }
    return false;
  });
  markdown.block.ruler.before('fence', 'math_block', (state, start, last, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const first = state.bMarks[start] + state.tShift[start];
    if (state.src.slice(first, first + 2) !== '$$') return false;
    let content = '', end = start;
    for (; end < last; end++) {
      const line = state.src.slice(end === start ? first + 2 : state.bMarks[end] + state.tShift[end], state.eMarks[end]);
      const close = line.indexOf('$$');
      if (close >= 0) {
        if (line.slice(close + 2).trim()) return false;
        content += line.slice(0, close);
        if (!silent) { const token = state.push('math_block', 'math', 0); token.block = true; token.content = content.trim(); token.map = [start, end + 1]; }
        state.line = end + 1; return true;
      }
      content += line + '\n';
      if (content.length > 10000) return false;
    }
    return false;
  });
  markdown.renderer.rules.math_inline = (tokens, index, _options, env) => render(tokens[index].content, tokens[index].meta.display, env);
  markdown.renderer.rules.math_block = (tokens, index, _options, env) => render(tokens[index].content, true, env) + '\n';
};
