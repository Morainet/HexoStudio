/* Literal search keeps replacement text ($&, backslashes, etc.) unchanged. */
const EditorTools = (() => {
  const limit = 10000;
  function find(text, query, sensitive = false) {
    if (!query) return { matches: [], limited: false };
    const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(pattern, sensitive ? 'gu' : 'giu');
    const matches = [];
    for (const match of text.matchAll(regex)) {
      if (matches.length === limit) return { matches, limited: true };
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return { matches, limited: false };
  }
  function replaceAll(text, matches, replacement) {
    let cursor = 0, result = '';
    for (const match of matches) {
      result += text.slice(cursor, match.start) + replacement;
      cursor = match.end;
    }
    return result + text.slice(cursor);
  }
  function snippet(kind, selected, t = value => value) {
    let text, start, end;
    if (kind === 'code') {
      // Selected source may itself contain fences; use a longer enclosing fence.
      let fenceLength = 3;
      for (const match of selected.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
      const fence = '`'.repeat(fenceLength);
      const body = selected || t('在此输入代码');
      text = `\n${fence}text\n${body}\n${fence}\n`;
      start = fence.length + 6; end = start + body.length;
    } else if (kind === 'table') {
      text = `\n| ${t('列一')} | ${t('列二')} |\n| --- | --- |\n| ${t('单元格')} | ${t('单元格')} |\n`;
      start = 3; end = start + t('列一').length;
    } else if (kind === 'mermaid') {
      text = '\n```mermaid\nflowchart LR\n  A[Start] --> B[Done]\n```\n';
      start = 12; end = text.lastIndexOf('\n```');
    } else if (kind === 'math') {
      const body = selected || 'E = mc^2';
      text = `\n$$\n${body}\n$$\n`; start = 4; end = start + body.length;
    } else return null;
    return { text, start, end };
  }
  function replaceRange(editor, start, end, text) {
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, end);
    // Native insertion preserves the browser's undo transaction where supported.
    let inserted = false;
    try { inserted = document.execCommand?.('insertText', false, text); } catch { /* use the standard textarea API */ }
    if (!inserted) {
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function markup(t) {
    return `<div id="editor-find-panel" class="editor-find hidden" role="search" aria-label="${t('文章内查找替换')}">
      <div class="editor-find-row"><input id="editor-find-query" type="text" maxlength="1000" autocomplete="off" spellcheck="false" aria-label="${t('查找文字')}" placeholder="${t('查找文字')}"><button type="button" id="editor-find-case" aria-label="${t('区分大小写')}" title="${t('区分大小写')}" aria-pressed="false">Aa</button><span id="editor-find-count" class="editor-find-count" role="status" aria-live="polite"></span><button type="button" id="editor-find-prev" aria-label="${t('上一个匹配')}" title="${t('上一个匹配')}">↑</button><button type="button" id="editor-find-next" aria-label="${t('下一个匹配')}" title="${t('下一个匹配')}">↓</button><button type="button" id="editor-find-close" aria-label="${t('关闭查找')}" title="${t('关闭查找')}">×</button></div>
      <div class="editor-find-row"><input id="editor-find-replacement" type="text" maxlength="10000" autocomplete="off" spellcheck="false" aria-label="${t('替换为')}" placeholder="${t('替换为')}"><button type="button" id="editor-find-replace">${t('替换')}</button><button type="button" id="editor-find-all">${t('全部替换')}</button></div>
    </div>`;
  }
  function attach({ editor, t, changed, remember, writable, showWrite }) {
    const $ = id => document.getElementById(id);
    const panel = $('editor-find-panel'), query = $('editor-find-query');
    let matches = [], limited = false, index = -1, sensitive = false;
    const open = () => !panel.classList.contains('hidden');
    function controls() {
      const replacementLength = $('editor-find-replacement').value.length;
      const outputLength = editor.value.length + matches.reduce((length, match) => length + replacementLength - (match.end - match.start), 0);
      const tooLong = outputLength > 2_000_000;
      $('editor-find-count').textContent = tooLong ? t('替换后内容过长，请减少替换内容') : limited ? t('匹配过多，请缩小查找范围') : !query.value ? '' : matches.length ? `${index < 0 ? 0 : index + 1} / ${matches.length}` : t('无匹配');
      for (const name of ['prev', 'next']) $('editor-find-' + name).disabled = !matches.length || limited;
      $('editor-find-replace').disabled = !writable() || index < 0 || limited;
      $('editor-find-all').disabled = !writable() || !matches.length || limited || tooLong;
    }
    function refresh() {
      ({ matches, limited } = find(editor.value, query.value, sensitive));
      index = matches.findIndex(match => match.start === editor.selectionStart && match.end === editor.selectionEnd);
      controls();
    }
    function select(i) {
      if (!matches.length || limited) return;
      index = (i + matches.length) % matches.length;
      showWrite(); editor.focus({ preventScroll: true });
      editor.setSelectionRange(matches[index].start, matches[index].end);
      // Scroll the native textarea to the selected line without a duplicate overlay.
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
      const lines = editor.value.slice(0, matches[index].start).split('\n').length - 1;
      editor.scrollTop = Math.max(0, lines * lineHeight - editor.clientHeight / 2);
      remember(); controls();
    }
    function next(back = false) {
      refresh();
      if (index >= 0) return select(index + (back ? -1 : 1));
      const pos = editor.selectionStart;
      const i = back ? matches.findLastIndex(match => match.start < pos) : matches.findIndex(match => match.start >= pos);
      select(i < 0 ? back ? matches.length - 1 : 0 : i);
    }
    function toggle(force = !open()) {
      panel.classList.toggle('hidden', !force);
      $('editor-find-toggle').setAttribute('aria-expanded', String(force));
      if (force) {
        showWrite();
        const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
        if (selected && selected.length <= 1000 && !selected.includes('\n')) query.value = selected;
        refresh(); query.focus(); query.select();
      } else { editor.focus({ preventScroll: true }); remember(); }
    }
    function replace(all) {
      if (!writable()) return;
      refresh();
      if (!matches.length || limited || (!all && index < 0)) return;
      const replacement = $('editor-find-replacement').value;
      if (all && $('editor-find-all').disabled) return;
      if (all) replaceRange(editor, 0, editor.value.length, replaceAll(editor.value, matches, replacement));
      else {
        const match = matches[index];
        replaceRange(editor, match.start, match.end, replacement);
        editor.setSelectionRange(match.start + replacement.length, match.start + replacement.length);
      }
      remember(); changed(); refresh();
      if (!all) next();
    }
    $('editor-find-toggle').onclick = () => toggle();
    $('editor-find-close').onclick = () => toggle(false);
    query.oninput = refresh;
    $('editor-find-replacement').oninput = controls;
    $('editor-find-prev').onclick = () => next(true);
    $('editor-find-next').onclick = () => next();
    $('editor-find-case').onclick = () => {
      sensitive = !sensitive;
      $('editor-find-case').setAttribute('aria-pressed', String(sensitive)); refresh();
    };
    $('editor-find-replace').onclick = () => replace(false);
    $('editor-find-all').onclick = () => replace(true);
    panel.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggle(false); }
      if (event.key === 'Enter') { event.preventDefault(); if (event.target === $('editor-find-replacement')) replace(false); else next(event.shiftKey); }
    };
    editor.addEventListener('input', () => { if (open()) refresh(); });
    editor.addEventListener('select', () => { if (open()) refresh(); });
    editor.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && open()) { event.preventDefault(); toggle(false); }
    });
    // The listener belongs to this editor, so navigating removes its shortcut scope.
    editor.closest('.editor-panel').addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (['f', 'h'].includes(event.key.toLowerCase())) {
        event.preventDefault(); toggle(true);
        if (event.key.toLowerCase() === 'h') $('editor-find-replacement').focus();
      }
    });
    controls();
  }
  return { find, replaceAll, snippet, replaceRange, markup, attach };
})();
if (typeof module !== 'undefined') module.exports = EditorTools;
