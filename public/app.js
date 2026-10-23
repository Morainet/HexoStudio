const state = { csrf: null, root: null, site: null, connection: { type: 'local' }, git: null, gitMessage: '', posts: [], drafts: [], pages: [], contentKind: 'post', view: 'dashboard', current: null, config: null, configDirty: false, search: '', filter: 'all', busy: false, saving: false, editorDirty: false, editorBuffer: null, editorBaseModified: null, metadataValues: {}, metadataBase: {}, previewVersion: 0 };
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const endpoint = (name, params = {}) => `/api/${name}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}`;
async function api(name, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(endpoint(name, options.params), {
    method,
    headers: { ...(options.data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
    body: options.data ? JSON.stringify(options.data) : undefined
  }).catch(() => { throw new Error('无法连接服务，请检查服务是否运行后重试'); });
  const result = await response.json().catch(() => { throw new Error('服务返回异常，请稍后重试'); });
  if (response.status === 401 && !name.startsWith('auth/')) { state.csrf = null; showAuth(true); }
  if (!response.ok) throw Object.assign(new Error(result.error || '请求失败'), { status: response.status });
  return result;
}
function toast(message, tone = 'success') {
  const el = $('#toast');
  el.textContent = message; el.dataset.tone = tone;
  el.classList.remove('hidden'); clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), tone === 'error' ? 7000 : 3500);
}
function modal(content) {
  modal.previousFocus = document.activeElement;
  $('#modal-content').innerHTML = content;
  $('#modal').classList.remove('hidden');
  const focus = $('#modal-content').querySelector('input:not([type="hidden"]),textarea,select,button');
  (focus || $('#modal-close')).focus();
}
function closeModal() {
  if (state.connecting) return;
  $('#modal').classList.add('hidden'); $('#modal-content').innerHTML = '';
  if (modal.previousFocus?.isConnected) modal.previousFocus.focus();
}
async function withButton(button, action, label = '处理中…') {
  if (!button || button.disabled) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = label;
  try { return await action(); }
  catch (error) { toast(error.message, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = original; } }
}
function viewError(title, message, retry) {
  $('#view').innerHTML = `${pageHead('WORKSPACE', title, '')}<section class="panel empty"><div class="symbol">${icon('folder')}</div><h2>暂时无法加载</h2><p>${escapeHTML(message)}</p><button id="retry-view" class="secondary">重新加载</button></section>`;
  $('#retry-view').onclick = retry;
}
function date(value) { return value ? String(value).slice(0, 10) : '未设置日期'; }
function fullName(path) { return path?.split('/').at(-1) || ''; }
function draftKey(path, kind = state.current?.kind || 'post') { return `hexostudio:draft:${state.root}:${kind}:${path}`; }
function metadataValues(meta = {}) { return { title: meta.title || '', date: meta.date || '', tags: (meta.tags || []).join(', '), categories: (meta.categories || []).join(', ') }; }
function metadataEdits() {
  const changes = {};
  for (const key of ['title', 'date', 'tags', 'categories']) {
    if (state.metadataValues[key] === state.metadataBase[key]) continue;
    changes[key] = key === 'tags' || key === 'categories'
      ? state.metadataValues[key].split(/[,，]/).map(value => value.trim()).filter(Boolean)
      : state.metadataValues[key].trim();
  }
  return changes;
}
function readDraft(path, kind) { try { return JSON.parse(localStorage.getItem(draftKey(path, kind)) || (kind === 'post' ? localStorage.getItem(`hexostudio:draft:${state.root}:${path}`) : null)); } catch { return null; } }
function clearDraft(path, kind) { try { localStorage.removeItem(draftKey(path, kind)); if (kind === 'post') localStorage.removeItem(`hexostudio:draft:${state.root}:${path}`); } catch { /* storage may be disabled */ } }
function saveDraft() {
  if (!state.current || !state.editorDirty) return;
  try { localStorage.setItem(draftKey(state.current.path), JSON.stringify({ content: state.editorBuffer, metadataValues: state.metadataValues, modified: state.editorBaseModified, savedAt: Date.now() })); }
  catch { if ($('#editor-status')) $('#editor-status').textContent = '本机草稿未备份，请及时保存'; }
}
function canLeaveEditor() { if (state.uploading) { toast('图片正在上传，请稍候'); return false; } if (state.saving) { toast('文章正在保存，请稍候'); return false; } if (!state.editorDirty) return true; saveDraft(); return window.confirm('文章还有未保存的改动，确定离开吗？建议先保存到博客。'); }
function setEditorDirty() {
  state.editorBuffer = $('#editor').value;
  if (document.activeElement === $('#editor')) rememberEditorSelection();
  document.querySelectorAll('[data-meta]').forEach(input => { state.metadataValues[input.dataset.meta] = input.value; });
  state.editorDirty = state.editorBuffer !== state.current.content || Object.keys(metadataEdits()).length > 0;
  $('#save-post').textContent = state.editorDirty ? '保存更改 ●' : `保存${state.current.kind === 'draft' ? '草稿' : state.current.kind === 'page' ? '页面' : '文章'}`;
  $('#editor-status').textContent = state.editorDirty ? '未保存更改' : '所有更改已保存';
  clearTimeout(state.draftTimer);
  if (state.editorDirty) state.draftTimer = setTimeout(saveDraft, 350); else clearDraft(state.current.path);
  schedulePreview();
}
function schedulePreview(delay = 280) {
  const version = ++state.previewVersion;
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(async () => {
    try {
      const result = await api('preview', { method: 'POST', data: { content: $('#editor')?.value || state.editorBuffer || '' } });
      if (version === state.previewVersion && $('#preview')) $('#preview').innerHTML = result.html;
    } catch (error) { if (version === state.previewVersion && $('#preview')) $('#preview').textContent = `预览失败：${error.message}`; }
  }, delay);
}
function updateShell() {
  $('#project-name').textContent = state.root ? (state.site?.title || fullName(state.root)) : '尚未连接项目';
  $('#project-path').textContent = state.connection?.type === 'remote' ? `${state.connection.provider} · ${state.connection.repository}` : state.root || '请选择 Hexo 目录';
  $('#top-new').disabled = !state.root;
  $('#top-new span').textContent = (state.view === 'pages' || (state.view === 'editor' && state.current?.kind === 'page')) ? '新建页面' : '新建文章';
  document.querySelectorAll('.nav button').forEach(button => {
    const active = button.dataset.view === (state.view === 'editor' ? state.current?.kind === 'page' ? 'pages' : 'posts' : state.view);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const title = { dashboard: '概览', posts: '文章管理', pages: '页面管理', editor: state.current?.kind === 'draft' ? '编辑草稿' : state.current?.kind === 'page' ? '编辑页面' : '编辑文章', config: '站点配置', git: 'Git 仓库', deploy: '构建与部署' }[state.view];
  $('#breadcrumb').textContent = `工作空间 / ${title}`;
}
function pageHead(kicker, title, subtitle, actions = '') { return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></div>`; }
function row(post, compact = false) {
  const identity = `data-kind="${post.kind}" data-open="${escapeHTML(post.path)}"`;
  if (compact) return `<div class="post-row"><div class="post-avatar">${icon('post')}</div><div class="post-summary"><div class="post-title">${escapeHTML(post.title)}</div><div class="post-meta">${escapeHTML(date(post.date || post.modified))} · ${post.words} 字 · ${escapeHTML(post.path)}</div></div><button ${identity}>编辑 ${icon('arrow')}</button></div>`;
  return `<div class="article-row"><div><span class="title">${escapeHTML(post.title)}</span><div class="excerpt">${escapeHTML(post.excerpt || post.path)}</div></div><span>${post.tags.length ? post.tags.slice(0, 2).map(tag => `<span class="pill">${escapeHTML(tag)}</span>`).join('') : '<span class="muted">无标签</span>'}</span><span class="muted">${escapeHTML(date(post.date || post.modified))}</span><div class="row-actions"><button ${identity}>编辑</button>${post.kind === 'draft' ? `<button data-publish="${escapeHTML(post.path)}">发布</button>` : ''}<button data-kind="${post.kind}" data-delete="${escapeHTML(post.path)}">删除</button></div></div>`;
}
function dashboard() {
  const count = state.posts.length;
  const recent = state.posts.slice(0, 5);
  $('#view').innerHTML = `${pageHead('WORKSPACE', '工作台', state.site?.title ? `${escapeHTML(state.site.title)} · 内容概览` : '查看博客内容，继续你的创作。', `<button id="hero-new" class="primary">${icon('plus')} 新建草稿</button>`)}
    <div class="stats"><div class="stat-card"><span class="stat-icon">${icon('post')}</span><div><small>文章总数</small><strong>${count}</strong></div><span class="stat-tail">已发布</span></div><div class="stat-card"><span class="stat-icon">${icon('pages')}</span><div><small>页面总数</small><strong>${state.pages.length}</strong></div><span class="stat-tail">独立页面</span></div><div class="stat-card"><span class="stat-icon">${icon('pen')}</span><div><small>草稿数量</small><strong>${state.drafts.length}</strong></div><span class="stat-tail">待完成</span></div></div>
    <div class="columns"><section class="panel"><div class="panel-title"><h3>最近的文章</h3><button data-view="posts">查看全部 ${icon('arrow')}</button></div><div class="post-list">${recent.length ? recent.map(post => row(post, true)).join('') : `<div class="empty"><div class="symbol">${icon('post')}</div>还没有文章，创建第一篇吧。</div>`}</div></section><section class="panel"><div class="panel-title"><h3>常用操作</h3></div><div class="quick-actions"><button class="quick-action" id="quick-new"><span class="q-icon">${icon('pen')}</span><span><strong>新建草稿</strong><small>记录想法，稍后发布</small></span>${icon('arrow', 'icon quick-arrow')}</button><button class="quick-action" data-view="pages"><span class="q-icon">${icon('pages')}</span><span><strong>管理页面</strong><small>编辑关于、友链等独立页面</small></span>${icon('arrow', 'icon quick-arrow')}</button><button class="quick-action" data-view="config"><span class="q-icon">${icon('settings')}</span><span><strong>编辑站点配置</strong><small>调整 Hexo 与主题设置</small></span>${icon('arrow', 'icon quick-arrow')}</button></div><div class="hint-card">草稿不会展示在博客中。准备好后发布，再构建站点。</div></section></div>`;
  $('#hero-new').onclick = () => showNewPost('draft');
  $('#quick-new').onclick = () => showNewPost('draft');
}
function listPreferences(kind) {
  state.lists ||= {};
  return state.lists[kind] ||= { query: '', tag: 'all', sort: 'recent', page: 1, timeKey: kind === 'page' ? 'modified' : 'date' };
}
function listPage(items, prefs) {
  const sorted = [...items].sort((a, b) => prefs.sort === 'title'
    ? a.title.localeCompare(b.title, 'zh-CN')
    : String(b[prefs.timeKey || 'date'] || b.modified || '').localeCompare(String(a[prefs.timeKey || 'date'] || a.modified || '')));
  const pages = Math.max(1, Math.ceil(sorted.length / 20));
  prefs.page = Math.min(Math.max(prefs.page, 1), pages);
  return { items: sorted.slice((prefs.page - 1) * 20, prefs.page * 20), pages, total: sorted.length };
}
function listFooter(page, prefs) {
  return `<footer class="list-footer"><span role="status">共 ${page.total} 项${page.total ? ` · 第 ${(prefs.page - 1) * 20 + 1}–${Math.min(prefs.page * 20, page.total)} 项` : ''}</span><div><button id="list-prev" class="secondary" ${prefs.page <= 1 ? 'disabled' : ''} aria-label="上一页">上一页</button><span>${prefs.page} / ${page.pages}</span><button id="list-next" class="secondary" ${prefs.page >= page.pages ? 'disabled' : ''} aria-label="下一页">下一页</button></div></footer>`;
}
function listSort(prefs) {
  return `<select id="list-sort" class="filter" aria-label="排序方式"><option value="recent" ${prefs.sort === 'recent' ? 'selected' : ''}>最新优先</option><option value="title" ${prefs.sort === 'title' ? 'selected' : ''}>标题排序</option></select>`;
}
function bindList(prefs, draw, searchId) {
  const input = $(searchId);
  const search = () => {
    const cursor = input.selectionStart;
    prefs.query = input.value; prefs.page = 1;
    draw(); $(searchId).focus(); $(searchId).setSelectionRange(cursor, cursor);
  };
  input.oninput = event => { if (!event.isComposing) search(); };
  input.oncompositionend = search;
  $('#list-sort').onchange = event => { prefs.sort = event.target.value; prefs.page = 1; draw(); };
  $('#list-prev').onclick = () => { prefs.page--; draw(); $('#view').scrollIntoView({ block: 'start' }); };
  $('#list-next').onclick = () => { prefs.page++; draw(); $('#view').scrollIntoView({ block: 'start' }); };
  if ($('#clear-filter')) $('#clear-filter').onclick = () => { prefs.query = ''; prefs.tag = 'all'; prefs.page = 1; draw(); $(searchId).focus(); };
  $('#refresh-list').onclick = () => withButton($('#refresh-list'), async () => {
    const view = state.view; await refreshPosts(); if (state.view === view) draw();
  }, '刷新中…');
}
function postsPage() {
  const items = state.contentKind === 'draft' ? state.drafts : state.posts;
  const prefs = listPreferences(state.contentKind);
  const query = prefs.query.trim().toLowerCase();
  const tags = [...new Set(items.flatMap(post => post.tags))].sort();
  if (prefs.tag !== 'all' && !tags.includes(prefs.tag)) prefs.tag = 'all';
  const page = listPage(items.filter(post => (post.title + post.path + post.tags.join(' ')).toLowerCase().includes(query) && (prefs.tag === 'all' || post.tags.includes(prefs.tag))), prefs);
  const filtered = query || prefs.tag !== 'all';
  $('#view').innerHTML = `${pageHead('CONTENT LIBRARY', '文章管理', `已发布 ${state.posts.length} 篇文章 · ${state.drafts.length} 篇草稿。`, '<button id="refresh-list" class="secondary">刷新</button><button id="new-draft" class="secondary">＋ 新建草稿</button><button id="new-post" class="primary">＋ 新建文章</button>')}
  <div class="content-tabs"><button data-content-kind="post" class="${state.contentKind === 'post' ? 'active' : ''}">已发布文章 <span>${state.posts.length}</span></button><button data-content-kind="draft" class="${state.contentKind === 'draft' ? 'active' : ''}">草稿箱 <span>${state.drafts.length}</span></button></div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" aria-label="搜索文章" placeholder="搜索标题、路径或标签" value="${escapeHTML(prefs.query)}"></label><div class="list-filters"><select id="filter" class="filter" aria-label="按标签筛选"><option value="all">全部标签</option>${tags.map(tag => `<option value="${escapeHTML(tag)}" ${tag === prefs.tag ? 'selected' : ''}>${escapeHTML(tag)}</option>`).join('')}</select>${listSort(prefs)}</div></div>
  <section class="panel table-panel"><div class="table-head"><span>文章</span><span>标签</span><span>日期</span><span>操作</span></div>${page.total ? page.items.map(post => row(post)).join('') : `<div class="empty"><div class="symbol">${icon('post')}</div><h2>${filtered ? '没有匹配的文章' : state.contentKind === 'draft' ? '开始记录新的想法' : '还没有文章'}</h2><p>${filtered ? '试试其他关键词，或清除筛选。' : '点击上方按钮，创建你的第一篇内容。'}</p>${filtered ? '<button id="clear-filter" class="secondary">清除筛选</button>' : ''}</div>`}${listFooter(page, prefs)}</section>`;
  $('#new-post').onclick = () => showNewPost('post');
  $('#new-draft').onclick = () => showNewPost('draft');
  document.querySelectorAll('[data-content-kind]').forEach(button => button.onclick = () => { state.contentKind = button.dataset.contentKind; postsPage(); });
  $('#filter').onchange = event => { prefs.tag = event.target.value; prefs.page = 1; postsPage(); };
  bindList(prefs, postsPage, '#search');
}
function pagesPage() {
  const prefs = listPreferences('page');
  const query = prefs.query.trim().toLowerCase();
  const page = listPage(state.pages.filter(item => `${item.title} ${item.path}`.toLowerCase().includes(query)), prefs);
  $('#view').innerHTML = `${pageHead('INDEPENDENT PAGES', '页面管理', `共 ${state.pages.length} 个独立页面，位于 Hexo 的 source 目录。`, '<button id="refresh-list" class="secondary">刷新</button><button id="new-page" class="primary">＋ 新建页面</button>')}
    <div class="toolbar"><label class="search">${icon('search')}<input id="page-search" type="search" aria-label="搜索页面" placeholder="搜索页面标题或路径" value="${escapeHTML(prefs.query)}"></label>${listSort(prefs)}</div>
    <section class="panel table-panel"><div class="table-head page-table"><span>页面</span><span>文件路径</span><span>最近修改</span><span>操作</span></div>${page.total ? page.items.map(item => `<div class="article-row page-table"><div><span class="title">${escapeHTML(item.title)}</span><div class="excerpt">${escapeHTML(item.excerpt || '独立页面')}</div></div><span class="muted page-path" title="${escapeHTML(item.path)}">${escapeHTML(item.path)}</span><span class="muted">${escapeHTML(date(item.modified))}</span><div class="row-actions"><button data-kind="page" data-open="${escapeHTML(item.path)}">编辑</button><button data-kind="page" data-delete="${escapeHTML(item.path)}">删除</button></div></div>`).join('') : `<div class="empty"><div class="symbol">${icon('pages')}</div><h2>${query ? '没有匹配的页面' : '创建你的第一个页面'}</h2><p>${query ? '换个关键词试试。' : '关于、友链等独立内容都可以在这里管理。'}</p>${query ? '<button id="clear-filter" class="secondary">清除搜索</button>' : ''}</div>`}${listFooter(page, prefs)}</section>`;
  $('#new-page').onclick = () => showNewPost('page');
  bindList(prefs, pagesPage, '#page-search');
}
function editorPage() {
  const post = state.current;
  if (!post) return navigate('posts');
  const label = post.kind === 'draft' ? '草稿' : post.kind === 'page' ? '页面' : '文章';
  $('#view').innerHTML = `${pageHead(post.kind === 'draft' ? 'DRAFT EDITOR' : post.kind === 'page' ? 'PAGE EDITOR' : 'EDITOR', escapeHTML(state.metadataValues.title || fullName(post.path)), `${label} · ${escapeHTML(post.path)}`, `<span id="editor-status" class="editor-status">所有更改已保存</span><button id="back-posts" class="secondary">返回列表</button>${post.kind === 'draft' ? '<button id="publish-draft" class="secondary">发布草稿</button>' : ''}<button id="save-post" class="primary">保存${label}</button>`)}
    <div class="editor-layout"><section class="panel editor-panel"><div class="editor-tabs"><button class="active" data-editor-tab="write">Markdown</button><button data-editor-tab="preview">实时预览</button></div><div class="editor-toolbar" aria-label="编辑工具"><button type="button" data-insert="bold" title="加粗">B</button><button type="button" data-insert="italic" title="斜体"><i>I</i></button><button type="button" data-insert="heading" title="二级标题">H₂</button><button type="button" data-insert="link" title="链接">${icon('link')}</button><span class="toolbar-separator"></span><button type="button" id="upload-image" title="上传图片到博客">${icon('upload')} 上传图片</button><button type="button" id="media-toggle" title="选择已上传的图片">${icon('image')} 图片库</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden><small>可粘贴或拖入图片</small></div><div id="media-library" class="media-library hidden"><div class="media-head"><strong>已上传图片</strong><span>点击图片插入${label}</span></div><div id="media-list" class="media-grid">加载中…</div></div><textarea id="editor" class="editor-textarea" spellcheck="false" aria-label="Markdown ${label}内容"></textarea><div id="preview" class="preview hidden">正在生成预览…</div></section>
    <aside class="panel meta-panel"><h3>${label}信息</h3><label for="meta-title">标题</label><input id="meta-title" data-meta="title" value="${escapeHTML(state.metadataValues.title)}" maxlength="300"><label for="meta-date">日期</label><input id="meta-date" data-meta="date" value="${escapeHTML(state.metadataValues.date)}" placeholder="YYYY-MM-DD HH:mm:ss">${post.kind === 'page' ? '' : `<label for="meta-tags">标签</label><input id="meta-tags" data-meta="tags" value="${escapeHTML(state.metadataValues.tags)}" placeholder="用逗号分隔"><label for="meta-categories">分类</label><input id="meta-categories" data-meta="categories" value="${escapeHTML(state.metadataValues.categories)}" placeholder="用逗号分隔">`}<label>文件路径</label><div class="meta-value">${escapeHTML(post.path)}</div><div class="hint-card">修改${label}信息时只更新对应字段；主题自定义字段保持原样。也可以直接编辑文首的 YAML。</div></aside></div>`;
  $('#editor').value = state.editorBuffer ?? post.content;
  $('#editor').oninput = setEditorDirty;
  $('#editor').onselect = rememberEditorSelection;
  $('#editor').onkeyup = rememberEditorSelection;
  $('#editor').onmouseup = rememberEditorSelection;
  $('#editor').onpaste = event => { const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/')); if (images.length) { event.preventDefault(); uploadImages(images); } };
  $('#editor').ondragover = event => { if ([...(event.dataTransfer?.items || [])].some(item => item.type.startsWith('image/'))) event.preventDefault(); };
  $('#editor').ondrop = event => { const images = [...(event.dataTransfer?.files || [])].filter(file => file.type.startsWith('image/')); if (images.length) { event.preventDefault(); uploadImages(images); } };
  $('#upload-image').onclick = () => $('#image-file').click();
  $('#image-file').onchange = event => { uploadImages([...event.target.files]); event.target.value = ''; };
  $('#media-toggle').onclick = toggleMediaLibrary;
  document.querySelectorAll('[data-meta]').forEach(input => input.oninput = setEditorDirty);
  document.querySelectorAll('[data-insert]').forEach(button => button.onclick = () => insertMarkup(button.dataset.insert));
  $('#save-post').textContent = state.editorDirty ? '保存更改 ●' : `保存${label}`;
  $('#editor-status').textContent = state.editorDirty ? '未保存更改' : '所有更改已保存';
  schedulePreview(0);
  document.querySelectorAll('[data-editor-tab]').forEach(button => button.onclick = () => {
    const preview = button.dataset.editorTab === 'preview';
    document.querySelectorAll('[data-editor-tab]').forEach(tab => tab.classList.toggle('active', tab === button));
    $('#editor').classList.toggle('hidden', preview);
    $('#preview').classList.toggle('hidden', !preview);
    if (preview) schedulePreview(0);
  });
  $('#back-posts').onclick = () => navigate(post.kind === 'page' ? 'pages' : 'posts');
  $('#save-post').onclick = savePost;
  if (post.kind === 'draft') $('#publish-draft').onclick = () => requestPublish(post.path);
}
function insertAtCursor(text, selectStart = 0, selectEnd = 0) {
  if (state.saving || !$('#editor')) return;
  if ($('#editor').classList.contains('hidden')) document.querySelector('[data-editor-tab="write"]').click();
  const editor = $('#editor');
  const start = state.editorSelection?.start ?? editor.value.length;
  const end = state.editorSelection?.end ?? start;
  editor.setRangeText(text, start, end, 'end');
  editor.focus();
  if (selectEnd > selectStart) editor.setSelectionRange(start + selectStart, start + selectEnd);
  rememberEditorSelection();
  setEditorDirty();
}
function rememberEditorSelection() { const editor = $('#editor'); if (editor) state.editorSelection = { start: editor.selectionStart, end: editor.selectionEnd }; }
async function toggleMediaLibrary() {
  const library = $('#media-library');
  library.classList.toggle('hidden');
  if (!library.classList.contains('hidden')) await loadMediaLibrary();
}
async function loadMediaLibrary() {
  const container = $('#media-list');
  if (!container) return;
  try {
    const result = await api('assets');
    if (!$('#media-list') || container !== $('#media-list')) return;
    container.innerHTML = result.images.length ? result.images.map(item => `<button class="media-card" type="button" data-media-url="${escapeHTML(item.url)}" data-media-name="${escapeHTML(item.name)}"><img src="${escapeHTML(item.url)}" alt=""><span>${escapeHTML(item.name)}</span></button>`).join('') : '<p class="media-empty">还没有上传图片。可用上方按钮选择图片，或粘贴、拖入图片。</p>';
    container.querySelectorAll('[data-media-url]').forEach(button => button.onclick = () => {
      const name = button.dataset.mediaName.replace(/[\[\]\\]/g, '\\$&');
      insertAtCursor(`![${name}](${button.dataset.mediaUrl})\n`);
      $('#media-library').classList.add('hidden');
    });
  } catch (error) { container.textContent = `图片库加载失败：${error.message}`; }
}
function insertMarkup(kind) {
  const editor = $('#editor');
  const selected = editor.value.slice(state.editorSelection?.start ?? editor.value.length, state.editorSelection?.end ?? editor.value.length);
  if (kind === 'bold') insertAtCursor(`**${selected || '加粗文字'}**`, 2, 2 + (selected || '加粗文字').length);
  if (kind === 'italic') insertAtCursor(`*${selected || '斜体文字'}*`, 1, 1 + (selected || '斜体文字').length);
  if (kind === 'heading') insertAtCursor(`\n## ${selected || '小标题'}\n`, 4, 4 + (selected || '小标题').length);
  if (kind === 'link') insertAtCursor(`[${selected || '链接文字'}](https://)`, 1, 1 + (selected || '链接文字').length);
}
function imageBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}
async function uploadImages(files) {
  const button = $('#upload-image');
  if (!button || state.uploading || state.saving) return;
  const currentPath = state.current?.path;
  const currentRoot = state.root;
  state.uploading = true;
  button.disabled = true;
  try {
    for (const file of files) {
      if (file.size > 8_000_000) throw new Error(`${file.name} 超过 8 MB`);
      $('#editor-status').textContent = `正在上传 ${file.name}…`;
      const result = await api('assets', { method: 'POST', data: { name: file.name, data: await imageBase64(file) } });
      if (state.current?.path !== currentPath || state.root !== currentRoot || !$('#editor')) return;
      insertAtCursor(`![${result.name}](${result.url})\n`);
      toast(`图片已插入：${result.name}`);
    }
    if (!$('#media-library')?.classList.contains('hidden')) loadMediaLibrary();
  } catch (error) { toast(`上传失败：${error.message}`); }
  finally { state.uploading = false; button.disabled = false; if ($('#editor-status')) $('#editor-status').textContent = state.editorDirty ? '未保存更改' : '所有更改已保存'; }
}
function configPage() {
  if (!state.config) return;
  const config = state.config;
  const format = config.scope.endsWith('.json') ? 'JSON' : 'YAML';
  const options = ['<option value="site">Hexo 站点配置 · _config.yml</option>', ...(config.overrides || []).map(filename => `<option value="override:${escapeHTML(filename)}">${escapeHTML(filename)} · 主题覆盖配置</option>`), ...config.themes.map(theme => `<option value="theme:${escapeHTML(theme)}">${escapeHTML(theme)} · 主题目录配置${theme === state.site?.theme ? '（当前）' : ''}</option>`)].join('');
  $('#view').innerHTML = `${pageHead('SITE SETTINGS', '站点配置', '直接查看并编辑 Hexo 与主题的配置文件。', '<button id="save-config" class="primary">保存配置</button>')}
    <div class="toolbar"><select id="scope" class="scope-select">${options}</select></div><section class="panel editor-panel"><textarea id="config-editor" class="code-area" spellcheck="false" aria-label="${format} 配置"></textarea></section><div class="hint-card">保存前请确认 ${format} 语法正确。HexoStudio 会保留原有注释和字段，不会重新格式化配置。</div>`;
  $('#scope').value = config.scope;
  $('#scope').onchange = async event => { const selected = event.target.value; if (!await loadConfig(selected)) event.target.value = config.scope; };
  $('#config-editor').value = state.configBuffer ?? config.content;
  $('#config-editor').oninput = () => { state.configBuffer = $('#config-editor').value; state.configDirty = state.configBuffer !== state.config.content; $('#save-config').textContent = state.configDirty ? '保存配置 ●' : '保存配置'; };
  $('#save-config').textContent = state.configDirty ? '保存配置 ●' : '保存配置';
  $('#save-config').onclick = saveConfig;
}
function deployPage() {
  $('#view').innerHTML = `${pageHead('PUBLISH WORKFLOW', '构建与部署', '运行当前 Hexo 项目中已安装的本地命令。')}
    <div class="command-grid"><button class="command-card" data-command="clean"><span class="command-icon">${icon('settings')}</span><strong>清理缓存</strong><small>hexo clean · 清理生成文件与缓存</small></button><button class="command-card" data-command="generate"><span class="command-icon">${icon('pages')}</span><strong>生成静态站点</strong><small>hexo generate · 输出到 public 目录</small></button><button class="command-card" data-command="deploy"><span class="command-icon">${icon('rocket')}</span><strong>部署博客</strong><small>hexo deploy · 使用项目当前部署配置</small></button></div>
    <section class="panel"><div class="panel-title"><h3>运行日志</h3><button id="clear-log">清空日志</button></div><div id="terminal" class="terminal" role="log" aria-label="构建日志">${escapeHTML(state.commandLog || '准备就绪。选择上方操作以运行 Hexo 命令。')}</div></section>`;
  document.querySelectorAll('[data-command]').forEach(button => { button.disabled = Boolean(state.busy); button.onclick = () => runCommand(button.dataset.command); });
  $('#clear-log').disabled = Boolean(state.busy);
  $('#clear-log').onclick = () => { state.commandLog = ''; $('#terminal').textContent = '日志已清空。'; };
}
function gitPage() {
  const git = state.git;
  if (!git) { $('#view').innerHTML = `${pageHead('GIT WORKSPACE', 'Git 仓库', '正在读取仓库状态…')}`; return; }
  if (!git.isRepository) { $('#view').innerHTML = `${pageHead('GIT WORKSPACE', 'Git 仓库', '当前 Hexo 项目不是 Git 仓库。')}<section class="panel"><p class="muted">可以切换到 GitHub 或 GitLab 远端仓库，或连接已有的本机 Git 仓库。</p><button id="git-connect" class="primary">连接仓库</button></section>`; $('#git-connect').onclick = showProjectModal; return; }
  const changed = git.changes.length;
  const staged = git.changes.filter(item => item.staged).length;
  $('#view').innerHTML = `${pageHead('GIT WORKSPACE', 'Git 仓库', `${escapeHTML(git.branch || '分离的 HEAD')} · ${changed} 个变更 · 领先 ${git.ahead} / 落后 ${git.behind}`, `<button id="git-refresh" class="secondary">刷新本机</button><button id="git-fetch" class="secondary" ${git.remote ? '' : 'disabled'}>检查远端</button><button id="git-pull" class="secondary" ${git.remote ? '' : 'disabled'}>拉取更新</button><button id="git-push" class="primary" ${git.remote ? '' : 'disabled'}>推送提交</button>`)}
    <section class="panel git-summary"><div><small>远端仓库</small><strong>${escapeHTML(git.remote || '未配置 origin')}</strong></div><div><small>连接方式</small><strong>${git.managed ? 'Token 连接' : '本机 Git 仓库'}</strong></div></section>
    <section class="panel git-files"><div class="panel-title"><h3>文件变更</h3><span class="muted">${staged} 个已暂存</span></div>${changed ? git.changes.map(item => `<div class="git-file"><input type="checkbox" data-git-path="${escapeHTML(item.path)}" aria-label="暂存 ${escapeHTML(item.path)}" ${item.unstaged ? '' : 'disabled'}><span class="git-badge ${item.staged ? 'staged' : ''}">${escapeHTML(item.index)}</span><span class="git-file-name">${escapeHTML(item.path)}${item.staged && item.unstaged ? '<small>暂存后又有修改</small>' : ''}</span><div class="git-file-actions">${item.unstaged ? `<button data-git-diff="working" data-git-file="${escapeHTML(item.path)}">工作区差异</button>` : ''}${item.staged ? `<button data-git-diff="staged" data-git-file="${escapeHTML(item.path)}">暂存差异</button><button data-git-unstage="${escapeHTML(item.path)}">取消暂存</button>` : ''}</div></div>`).join('') : '<div class="empty">工作区没有变更</div>'}<div class="git-actions"><button id="git-stage" class="secondary" ${git.changes.some(item => item.unstaged) ? '' : 'disabled'}>暂存所选文件</button></div></section>
    <section class="panel git-commit"><h3>提交已暂存变更</h3><p>只提交已暂存的版本。若文件在暂存后又被修改，工作区差异不会进入本次提交。</p><div class="git-commit-row"><input id="git-message" placeholder="填写本次提交说明" maxlength="300" value="${escapeHTML(state.gitMessage)}"><button id="git-commit" class="primary" ${staged ? '' : 'disabled'}>创建提交</button></div></section>`;
  if (state.gitBusy) document.querySelectorAll('#view button, #view input').forEach(input => input.disabled = true);
  $('#git-refresh').onclick = loadGit;
  $('#git-fetch').onclick = () => gitSync('fetch');
  $('#git-pull').onclick = () => gitSync('pull');
  $('#git-push').onclick = () => gitSync('push');
  $('#git-stage').onclick = gitStage;
  $('#git-message').oninput = event => { state.gitMessage = event.target.value; };
  $('#git-commit').onclick = gitCommit;
  document.querySelectorAll('[data-git-diff]').forEach(button => button.onclick = () => showGitDiff(button.dataset.gitFile, button.dataset.gitDiff));
  document.querySelectorAll('[data-git-unstage]').forEach(button => button.onclick = () => gitUnstage(button.dataset.gitUnstage));
}
async function loadGit() {
  if (state.gitBusy) return;
  const root = state.root;
  try { const git = await api('git/status'); if (root !== state.root) return; state.git = git; if (state.view === 'git') render(); }
  catch (error) { if (state.view === 'git' && root === state.root) viewError('Git 仓库', error.message, loadGit); }
}
async function gitAction(action, data, message) {
  if (state.gitBusy) return;
  if (state.busy) return toast('Hexo 命令正在运行，请稍候');
  state.gitBusy = true;
  document.querySelectorAll('#view button, #view input').forEach(input => input.disabled = true);
  try {
    state.git = await api(`git/${action}`, { method: 'POST', data });
    if (action === 'commit') state.gitMessage = '';
    if (action === 'pull') { state.config = null; state.configBuffer = null; await refreshPosts(); }
    toast(message);
  } catch (error) { toast(error.message, 'error'); }
  finally { state.gitBusy = false; if (state.view === 'git') render(); }
}
async function gitStage() {
  const paths = [...document.querySelectorAll('[data-git-path]:checked')].map(input => input.dataset.gitPath);
  if (!paths.length) return toast('请先选择文件');
  return gitAction('stage', { paths }, '所选文件已暂存');
}
async function gitUnstage(path) { return gitAction('unstage', { path }, '已取消暂存，文件修改仍保留'); }
async function showGitDiff(path, area) {
  modal(`<h2 id="modal-title">${area === 'staged' ? '暂存差异' : '工作区差异'}</h2><p>${escapeHTML(path)}</p><pre id="git-diff-content" class="git-diff-content">正在读取差异…</pre><div class="actions"><button id="close-diff" class="secondary">关闭</button></div>`);
  $('#close-diff').onclick = closeModal;
  try {
    const result = await api('git/diff', { params: { path, area } });
    if ($('#git-diff-content')) {
      const content = result.content + (result.truncated ? '\n…差异过长，已截断' : '');
      $('#git-diff-content').innerHTML = content.split('\n').map(line => {
        const style = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : '';
        return `<span class="${style}">${escapeHTML(line)}</span>`;
      }).join('\n');
    }
  } catch (error) { if ($('#git-diff-content')) $('#git-diff-content').textContent = error.message; }
}
async function gitCommit() {
  const message = $('#git-message').value.trim();
  if (!message) { toast('请填写提交说明'); $('#git-message').focus(); return; }
  return gitAction('commit', { message }, '提交已创建，可以推送到远端');
}
async function gitSync(action) {
  return gitAction(action, undefined, { fetch: '远端状态已更新', pull: '已拉取远端更新', push: '提交已推送到远端' }[action]);
}
function render() { if (!$('#auth-screen').classList.contains('hidden')) return; updateShell(); if (!state.root) return onboarding(); $('#setup-blog-screen').classList.add('hidden'); $('#setup-blog-screen').replaceChildren(); $('#app').classList.remove('hidden'); ({ dashboard, posts: postsPage, pages: pagesPage, editor: editorPage, config: configPage, git: gitPage, deploy: deployPage })[state.view](); }
function connectionForm() {
  return `<div class="connection-tabs"><button type="button" data-connect-mode="local" class="active">本机目录</button><button type="button" data-connect-mode="remote">GitHub / GitLab</button></div>
    <div id="local-fields" class="connection-fields"><p>输入包含 <code>_config.yml</code> 与 <code>source/_posts</code> 的项目目录。</p><label for="root-input">Hexo 项目目录</label><input id="root-input" placeholder="/Users/name/blog 或 C:\\Users\\name\\blog"><div class="connect-actions"><button id="connect-project" class="primary">连接本机项目</button><button id="browse-project" class="secondary hidden">浏览目录…</button></div></div>
    <div id="remote-fields" class="connection-fields hidden"><p>用 HTTPS 仓库地址和 Token 连接，项目会克隆到本机工作目录。</p><div class="connection-grid"><div><label for="remote-provider">服务商</label><select id="remote-provider"><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></div><div><label for="remote-repo">仓库</label><input id="remote-repo" placeholder="username/repo 或 HTTPS 地址" autocomplete="off"></div><div><label for="remote-token">访问 Token</label><input id="remote-token" type="password" placeholder="有仓库读写权限的 Token" autocomplete="off"></div><div class="full"><details class="advanced-options"><summary>更多选项 · 分支与博客路径</summary><div><label for="remote-branch">项目分支</label><input id="remote-branch" placeholder="留空使用默认分支" autocomplete="off"></div><div class="full"><label for="remote-path">博客路径</label><input id="remote-path" placeholder="留空为仓库根目录；例如 blog" autocomplete="off"></div></details></div></div><button id="connect-remote" class="primary">连接远端仓库</button><p class="secret-note">Token 保存在本机设置文件中，不写入 Git 远端地址。</p></div><p id="connection-error" class="form-error hidden" role="alert"></p>`;
}
function bindConnectionForm() {
  document.querySelectorAll('[data-connect-mode]').forEach(button => button.onclick = () => {
    if (state.connecting) return;
    $('#connection-error').classList.add('hidden');
    const remote = button.dataset.connectMode === 'remote';
    document.querySelectorAll('[data-connect-mode]').forEach(tab => tab.classList.toggle('active', tab === button));
    $('#local-fields').classList.toggle('hidden', remote);
    $('#remote-fields').classList.toggle('hidden', !remote);
  });
  $('#connect-project').onclick = connectProject;
  $('#connect-remote').onclick = connectRemote;
  $('#root-input').onkeydown = event => { if (event.key === 'Enter') connectProject(); };
  if (window.hexoStudio) { $('#browse-project').classList.remove('hidden'); $('#browse-project').onclick = chooseDirectory; }
}
function onboarding() {
  $('#app').classList.add('hidden');
  $('#setup-blog-screen').classList.remove('hidden');
  $('#setup-blog-screen').innerHTML = `<section class="auth-card setup-blog-card"><div class="eyebrow">HEXOSTUDIO</div><h1>连接你的博客</h1><p>管理员已就绪，连接博客后即可开始管理。</p><ol class="auth-steps" aria-label="初始化进度"><li>1 · 数据库 ✓</li><li>2 · 管理员 ✓</li><li class="active" aria-current="step">3 · 博客</li></ol>${connectionForm()}<button id="setup-logout" class="setup-exit">退出登录</button></section>`;
  bindConnectionForm();
  $('#setup-logout').onclick = () => { if (!state.connecting) $('#logout').click(); };
}
function connectionError(message) {
  const error = $('#connection-error');
  if (error) { error.textContent = message; error.classList.remove('hidden'); } else toast(message, 'error');
}
async function connectBlog(remote) {
  if (state.connecting) return;
  if (state.busy || state.gitBusy) return toast('当前操作完成后才能切换项目');
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  const button = $(remote ? '#connect-remote' : '#connect-project');
  const data = remote ? { provider: $('#remote-provider').value, repository: $('#remote-repo').value.trim(), token: $('#remote-token').value.trim(), branch: $('#remote-branch').value.trim(), blogPath: $('#remote-path').value.trim() } : { path: $('#root-input').value.trim() };
  if (remote ? !data.repository || !data.token : !data.path) {
    connectionError(remote ? '请填写仓库地址和访问 Token。' : '请先填写 Hexo 项目目录。'); return;
  }
  $('#connection-error').classList.add('hidden');
  state.connecting = true;
  const original = button.textContent;
  const controls = [...document.querySelectorAll('.connection-fields input,.connection-fields select,.connection-fields button,[data-connect-mode]')];
  controls.forEach(control => control.disabled = true); button.textContent = remote ? '正在连接仓库…' : '正在连接…';
  try {
    const result = await api(remote ? 'remote/connect' : 'project', { method: 'POST', data });
    state.root = result.root; state.site = result.site; state.connection = result.connection || { type: 'local' };
    state.git = null; state.config = null; state.configBuffer = null; state.configDirty = false;
    state.current = null; state.editorDirty = false; state.contentKind = 'post'; state.lists = {};
    state.posts = []; state.drafts = []; state.pages = []; state.commandLog = '';
    let refreshError;
    try { await refreshPosts(); } catch (error) { refreshError = error; }
    state.connecting = false; closeModal(); state.view = 'dashboard'; render();
    toast(refreshError ? `项目已连接，内容刷新失败：${refreshError.message}。请在列表中重试刷新。` : '博客已连接，可以开始创作了', refreshError ? 'error' : 'success');
  } catch (error) { connectionError(error.message); }
  finally { state.connecting = false; controls.forEach(control => { if (control.isConnected) control.disabled = false; }); if (button.isConnected) button.textContent = original; }
}
async function connectProject() { return connectBlog(false); }
async function connectRemote() { return connectBlog(true); }
function showProjectModal() {
  if (state.busy || state.gitBusy) return toast('当前操作完成后才能切换项目');
  modal(`<h2 id="modal-title">切换 Hexo 项目</h2>${connectionForm()}<div class="actions"><button class="secondary" id="cancel-modal">取消</button></div>`);
  bindConnectionForm(); $('#cancel-modal').onclick = closeModal;
}
async function chooseDirectory() { const selected = await window.hexoStudio?.selectDirectory(); if (selected && $('#root-input')) $('#root-input').value = selected; }
function localDateTime() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`; }
function showNewPost(kind = 'post') { if (state.gitBusy) return toast('Git 操作正在进行，请稍候'); if (!state.root || (state.view === 'editor' && !canLeaveEditor()) || (state.view === 'config' && !canLeaveConfig())) return; state.newKind = ['post', 'draft', 'page'].includes(kind) ? kind : 'post'; const label = state.newKind === 'draft' ? '草稿' : state.newKind === 'page' ? '页面' : '文章'; const folder = state.newKind === 'draft' ? 'source/_drafts' : state.newKind === 'page' ? 'source/页面路径/index.md' : 'source/_posts'; modal(`<h2 id="modal-title">新建${label}</h2><p>给${label}取个名字，HexoStudio 会在 ${folder} 中创建 Markdown 文件。</p><label for="new-title">${label}标题</label><input id="new-title" placeholder="写下${label}标题"><div class="actions"><button class="secondary" id="cancel-modal">取消</button><button class="primary" id="create-post">创建并编辑</button></div>`); $('#new-title').focus(); $('#cancel-modal').onclick = closeModal; $('#create-post').onclick = createPost; $('#new-title').onkeydown = event => { if (event.key === 'Enter') createPost(); }; }
async function createPost() {
  const title = $('#new-title').value.trim();
  if (!title) { toast('请填写标题'); $('#new-title').focus(); return; }
  return withButton($('#create-post'), async () => {
    const kind = state.newKind;
    const post = await api('posts', { method: 'POST', data: { title, localDate: localDateTime(), kind } });
    closeModal();
    try { await refreshPosts(); } catch (error) { toast(`内容已创建，列表刷新失败：${error.message}`, 'error'); }
    await openPost(post.path, kind, true);
  }, '正在创建…');
}
async function refreshPosts() { const root = state.root; const [posts, drafts, pages] = await Promise.all([api('posts'), api('posts', { params: { kind: 'draft' } }), api('posts', { params: { kind: 'page' } })]); if (root !== state.root) return; state.posts = posts.posts; state.drafts = drafts.posts; state.pages = pages.posts; }
async function openPost(path, kind = 'post', skipGuard = false) {
  if (!skipGuard && ((state.view === 'editor' && !canLeaveEditor()) || (state.view === 'config' && !canLeaveConfig()))) return;
  try {
    const post = await api('post', { params: { path, kind } });
    state.current = post;
    if (kind !== 'page') state.contentKind = kind;
    state.editorBuffer = post.content;
    state.editorSelection = { start: post.content.length, end: post.content.length };
    state.editorBaseModified = post.modified;
    state.metadataBase = metadataValues(post.meta);
    state.metadataValues = { ...state.metadataBase };
    state.editorDirty = false;
    state.view = 'editor'; render();
    const draft = readDraft(path, kind);
    if (typeof draft?.content === 'string' && (draft.content !== post.content || (draft.metadataValues && JSON.stringify(draft.metadataValues) !== JSON.stringify(state.metadataBase)))) {
      const stale = draft.modified !== post.modified;
      modal(`<h2 id="modal-title">发现未保存草稿</h2><p>这篇文章在本机留有未保存内容。${stale ? '磁盘文件后来发生了变化；恢复后保存时会先提示冲突。' : '可以继续编辑草稿，或使用磁盘上的版本。'}</p><div class="actions"><button class="secondary" id="discard-draft">使用磁盘版本</button><button class="primary" id="restore-draft">恢复草稿</button></div>`);
      $('#discard-draft').onclick = () => { clearDraft(path, kind); closeModal(); };
      $('#restore-draft').onclick = () => { state.editorBuffer = draft.content; state.editorBaseModified = draft.modified; state.metadataValues = { ...state.metadataBase, ...(draft.metadataValues || {}) }; state.editorDirty = true; editorPage(); closeModal(); };
    }
  } catch (error) { toast(error.message, 'error'); }
}
async function savePost() {
  if (!state.current || state.saving) return false;
  if (state.uploading) { toast('图片正在上传，完成后再保存'); return false; }
  const editor = $('#editor');
  const content = editor.value;
  const scroll = editor.scrollTop;
  const cursor = editor.selectionStart;
  const previewActive = document.querySelector('[data-editor-tab="preview"]')?.classList.contains('active');
  const metadata = metadataEdits();
  state.saving = true;
  editor.readOnly = true;
  $('#save-post').disabled = true;
  document.querySelectorAll('[data-meta]').forEach(input => input.disabled = true);
  try {
    const updated = await api('post', { method: 'PUT', params: { path: state.current.path, kind: state.current.kind }, data: { content, modified: state.editorBaseModified, metadata } });
    state.current = updated;
    state.editorBuffer = updated.content;
    state.editorBaseModified = updated.modified;
    state.metadataBase = metadataValues(updated.meta);
    state.metadataValues = { ...state.metadataBase };
    state.editorDirty = false;
    clearDraft(updated.path, updated.kind);
    let refreshError = null;
    try { await refreshPosts(); } catch (error) { refreshError = error; }
    editorPage();
    $('#editor').scrollTop = scroll;
    $('#editor').setSelectionRange(Math.min(cursor, updated.content.length), Math.min(cursor, updated.content.length));
    if (previewActive) document.querySelector('[data-editor-tab="preview"]').click();
    toast(refreshError ? `已保存，列表刷新失败：${refreshError.message}` : updated.kind === 'draft' ? '草稿已保存' : updated.kind === 'page' ? '页面已保存' : '文章已保存');
    return true;
  } catch (error) { toast(error.message, 'error'); return false; }
  finally { state.saving = false; if ($('#editor') === editor) { editor.readOnly = false; $('#save-post').disabled = false; document.querySelectorAll('[data-meta]').forEach(input => input.disabled = false); } }
}
async function requestPublish(path) {
  if (state.saving) return toast('文章正在保存，请稍候');
  if (state.view === 'editor' && state.current?.kind === 'draft' && state.current.path === path && state.editorDirty) {
    if (!await savePost()) return;
  }
  const draft = state.drafts.find(item => item.path === path);
  if (!draft) return toast('草稿不存在，请刷新列表');
  modal(`<h2 id="modal-title">发布草稿？</h2><p>将 <strong>${escapeHTML(draft.title)}</strong> 移入 source/_posts。发布后可继续编辑，再到「构建与部署」生成静态站点。</p><div class="actions"><button class="secondary" id="cancel-modal">取消</button><button class="primary" id="confirm-publish">发布为文章</button></div>`);
  $('#cancel-modal').onclick = closeModal;
  $('#confirm-publish').onclick = async () => {
    $('#confirm-publish').disabled = true;
    try {
      const result = await api('publish', { method: 'POST', data: { path, modified: draft.modified, localDate: localDateTime() } });
      clearDraft(path, 'draft');
      let refreshError;
      state.drafts = state.drafts.filter(item => item.path !== path);
      try { await refreshPosts(); } catch (error) { refreshError = error; }
      closeModal();
      state.current = null;
      state.editorDirty = false;
      state.contentKind = 'post';
      state.view = 'posts';
      render();
      toast(refreshError ? `草稿已发布，列表刷新失败：${refreshError.message}` : `草稿已发布：${result.path}`, refreshError ? 'error' : 'success');
    } catch (error) { toast(error.message, 'error'); if ($('#confirm-publish')) $('#confirm-publish').disabled = false; }
  };
}
function confirmDelete(path, kind = 'post') {
  const label = kind === 'draft' ? '草稿' : kind === 'page' ? '页面' : '文章';
  modal(`<h2 id="modal-title">删除${label}？</h2><p>这会从 Hexo 源码目录删除 <strong>${escapeHTML(path)}</strong>。此操作无法在后台撤销。</p><div class="actions"><button class="secondary" id="cancel-modal">取消</button><button class="secondary danger" id="confirm-delete">删除${label}</button></div>`);
  $('#cancel-modal').onclick = closeModal;
  $('#confirm-delete').onclick = () => withButton($('#confirm-delete'), async () => {
    await api('post', { method: 'DELETE', params: { path, kind } });
    clearDraft(path, kind);
    const key = kind === 'draft' ? 'drafts' : kind === 'page' ? 'pages' : 'posts';
    state[key] = state[key].filter(item => item.path !== path);
    closeModal();
    let refreshError;
    try { await refreshPosts(); } catch (error) { refreshError = error; }
    render();
    toast(refreshError ? `${label}已删除，列表刷新失败：${refreshError.message}` : `${label}已删除`, refreshError ? 'error' : 'success');
  }, '正在删除…');
}
function canLeaveConfig() {
  if (state.configSaving) { toast('配置正在保存，请稍候'); return false; }
  if (!state.configDirty) return true;
  if (!window.confirm('配置还有未保存的改动，确定放弃吗？')) return false;
  state.configDirty = false; state.configBuffer = state.config?.content;
  return true;
}
async function loadConfig(scope = 'site') {
  if (state.view === 'config' && !canLeaveConfig()) return false;
  const version = state.configLoad = (state.configLoad || 0) + 1;
  const root = state.root;
  state.view = 'config'; updateShell();
  $('#view').innerHTML = `${pageHead('SITE SETTINGS', '站点配置', '正在读取配置…')}`;
  try {
    const config = await api('config', { params: { scope } });
    if (version !== state.configLoad || root !== state.root || state.view !== 'config') return false;
    state.config = config; state.configBuffer = config.content; state.configDirty = false;
    render(); return true;
  } catch (error) {
    if (version === state.configLoad && state.view === 'config') viewError('站点配置', error.message, () => loadConfig(scope));
    return false;
  }
}
async function saveConfig() {
  if (state.configSaving) return;
  const button = $('#save-config'); const editor = $('#config-editor');
  if (!editor || !state.config) return;
  const config = state.config; const content = editor.value;
  state.configSaving = true; button.disabled = true; editor.readOnly = true;
  $('#scope').disabled = true; button.textContent = '正在保存…';
  try {
    const result = await api('config', { method: 'PUT', data: { scope: config.scope, content, modified: config.modified } });
    config.content = content; config.modified = result.modified;
    state.configBuffer = content; state.configDirty = false;
    toast('配置已保存');
  } catch (error) { toast(error.message, 'error'); }
  finally {
    state.configSaving = false;
    if (button.isConnected) { button.disabled = false; button.textContent = state.configDirty ? '保存配置 ●' : '保存配置'; editor.readOnly = false; $('#scope').disabled = false; }
  }
}
function appendCommandLog(text) {
  state.commandLog = ((state.commandLog || '') + text).slice(-200000);
  const terminal = $('#terminal');
  if (terminal) { terminal.textContent = state.commandLog; terminal.scrollTop = terminal.scrollHeight; }
}
async function runCommand(action) {
  if (state.busy) return toast('已有命令正在运行');
  if (state.gitBusy) return toast('Git 操作正在进行，请稍候');
  if (action === 'deploy' && !window.confirm('将按当前 Hexo 配置部署博客，确定继续？')) return;
  state.busy = true; state.commandLog = `$ hexo ${action}\n`; deployPage();
  let exitCode = null;
  try {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: JSON.stringify({ action }) });
    if (!response.ok) { const result = await response.json(); if (response.status === 401) { state.csrf = null; showAuth(true); } throw new Error(result.error || '命令运行失败'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    const consume = line => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.type === 'exit') { exitCode = item.code; appendCommandLog(`\n进程结束，退出码 ${item.code}\n`); }
      else appendCommandLog(item.text || '');
    };
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(consume);
      if (done) { if (pending) consume(pending); break; }
    }
    if (exitCode === null) throw new Error('连接已中断，未收到命令完成结果，请检查日志');
    toast(exitCode === 0 ? 'Hexo 命令执行完成' : `命令未成功，退出码 ${exitCode}，请查看日志`, exitCode === 0 ? 'success' : 'error');
  } catch (error) { appendCommandLog(`\n错误：${error.message}\n`); toast(error.message, 'error'); }
  finally { state.busy = false; if (state.view === 'deploy' && $('#terminal')) deployPage(); }
}
async function navigate(view) {
  if (state.gitBusy) { toast('Git 操作正在进行，请稍候'); return; }
  if (view === state.view && !(view === 'config' && !state.config)) return;
  if (state.view === 'editor' && view !== 'editor') { if (!canLeaveEditor()) return; state.editorDirty = false; }
  if (state.view === 'config' && view !== 'config' && !canLeaveConfig()) return;
  state.view = view;
  if (view === 'config' && !state.config) return loadConfig();
  if (view === 'git') { render(); return loadGit(); }
  render();
}
document.addEventListener('click', event => { const view = event.target.closest('[data-view]'); if (view) navigate(view.dataset.view); const open = event.target.closest('[data-open]'); if (open) openPost(open.dataset.open, open.dataset.kind || 'post'); const deletion = event.target.closest('[data-delete]'); if (deletion) confirmDelete(deletion.dataset.delete, deletion.dataset.kind || 'post'); const publish = event.target.closest('[data-publish]'); if (publish) requestPublish(publish.dataset.publish); });
$('#change-project').onclick = showProjectModal;
function storageFields(type, prefix) {
  const fields = $(`#${prefix}-storage-fields`);
  fields.replaceChildren();
  const add = (label, id, placeholder, required = true) => {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.id = `${prefix}-${id}`;
    input.placeholder = placeholder;
    input.required = required;
    input.autocomplete = 'off';
    row.append(input);
    fields.append(row);
  };
  if (type === 'postgres') add('PostgreSQL 连接地址', 'storage-url', 'postgresql://user:password@host:5432/database');
  if (type === 'mysql') add('MySQL 连接地址', 'storage-url', 'mysql://user:password@host:3306/database');
  if (type === 'mongodb') { add('MongoDB 连接地址', 'storage-url', 'mongodb://user:password@host:27017'); add('数据库名称（地址中已包含可留空）', 'storage-database', '例如 hexostudio', false); }
}
function storageValue(prefix) {
  const type = $(`#${prefix}-storage-type`).value;
  const value = { type, url: $(`#${prefix}-storage-url`).value.trim() };
  if (type === 'mongodb') value.database = $(`#${prefix}-storage-database`).value.trim();
  return value;
}
$('#auth-storage-type').onchange = () => {
  storageFields($('#auth-storage-type').value, 'auth');
  $('#auth-error').classList.add('hidden');
};
function authStep(step) {
  const setup = $('#auth-form').dataset.mode === 'setup';
  const storage = setup && step === 'storage';
  $('#auth-form').dataset.step = storage ? 'storage' : 'account';
  $('#auth-account-fields').disabled = storage;
  $('#auth-account-fields').classList.toggle('hidden', storage);
  $('#auth-storage-row').disabled = !storage;
  $('#auth-storage-row').classList.toggle('hidden', !storage);
  $('#auth-back').classList.toggle('hidden', !setup || storage);
  $('#auth-steps').classList.toggle('hidden', !setup);
  document.querySelectorAll('[data-auth-step]').forEach(item => {
    const active = item.dataset.authStep === (storage ? 'storage' : 'account');
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  });
  $('#auth-title').textContent = !setup ? '登录工作台' : storage ? '连接数据库' : '设置管理员';
  $('#auth-description').textContent = !setup ? '使用管理员账号继续管理博客。' : storage ? '先连接数据库，用于保存管理员账号。' : '数据库已连接，设置后台登录账号。';
  $('#auth-submit').textContent = !setup ? '登录' : storage ? '验证并继续' : '创建账号并继续';
  $('#auth-error').classList.add('hidden');
  $(storage ? '#auth-storage-type' : '#auth-username').focus();
}
$('#auth-back').onclick = () => authStep('storage');
function showAuth(configured) {
  $('#app').classList.add('hidden');
  $('#setup-blog-screen').classList.add('hidden');
  $('#setup-blog-screen').replaceChildren();
  $('#auth-screen').classList.remove('hidden');
  state.authReady = false;
  $('#auth-form').noValidate = false;
  $('#auth-form').reset();
  $('#auth-error').classList.add('hidden');
  $('#auth-form').classList.toggle('auth-setup', !configured);
  $('#auth-confirm-row').classList.toggle('hidden', configured);
  storageFields($('#auth-storage-type').value, 'auth');
  $('#auth-confirm').required = !configured;
  $('#auth-confirm').disabled = configured;
  $('#auth-username').pattern = configured ? '.*' : '[\\p{L}\\p{N}_\\-]{3,32}';
  $('#auth-username').title = '3–32 位字母、数字、下划线或连字符';
  $('#auth-password').minLength = configured ? 1 : 12;
  $('#auth-password').placeholder = configured ? '' : '至少 12 个字符';
  $('#auth-password').autocomplete = configured ? 'current-password' : 'new-password';
  $('#auth-form').dataset.mode = configured ? 'login' : 'setup';
  authStep(configured ? 'account' : 'storage');
}
async function loadWorkspace() {
  const status = await api('status');
  state.root = status.root;
  state.site = status.site;
  state.connection = status.connection;
  $('#connection').textContent = status.mode === 'desktop' ? '桌面工作台' : '本地工作台';
  if (state.root) await refreshPosts();
  state.view = 'dashboard';
  $('#auth-screen').classList.add('hidden');
  render();
}
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  if ($('#auth-submit').disabled) return;
  const mode = $('#auth-form').dataset.mode;
  if (state.authReady) { await withButton($('#auth-submit'), loadWorkspace, '正在加载…'); return; }
  const storageStep = mode === 'setup' && $('#auth-form').dataset.step === 'storage';
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (mode === 'setup' && !storageStep && password !== $('#auth-confirm').value) {
    $('#auth-error').textContent = '两次输入的密码不一致';
    $('#auth-error').classList.remove('hidden');
    return;
  }
  $('#auth-submit').disabled = true;
  $('#auth-back').disabled = true;
  $('#auth-error').classList.add('hidden');
  const label = $('#auth-submit').textContent;
  $('#auth-submit').textContent = storageStep ? '正在验证…' : mode === 'setup' ? '正在创建…' : '正在登录…';
  try {
    if (storageStep) {
      const storage = storageValue('auth');
      $('#auth-storage-row').disabled = true;
      await api('auth/storage/test', { method: 'POST', data: { storage } });
      authStep('account');
      return;
    }
    const result = await api(`auth/${mode}`, { method: 'POST', data: { username, password, ...(mode === 'setup' ? { storage: storageValue('auth') } : {}) } });
    state.csrf = result.csrf;
    state.authReady = true;
    $('#auth-form').noValidate = true;
    $('#auth-password').value = '';
    $('#auth-confirm').value = '';
    storageFields($('#auth-storage-type').value, 'auth');
    await loadWorkspace();
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').classList.remove('hidden');
  } finally {
    $('#auth-submit').disabled = false;
    $('#auth-back').disabled = false;
    $('#auth-storage-row').disabled = $('#auth-form').dataset.step !== 'storage';
    if (state.authReady) { $('#auth-submit').textContent = '继续进入工作台'; $('#auth-back').disabled = true; $('#auth-account-fields').disabled = true; }
    else if (!storageStep || $('#auth-form').dataset.step === 'storage') $('#auth-submit').textContent = label;
  }
};
$('#logout').onclick = async () => {
  if (state.busy || state.gitBusy) return toast('当前操作完成后再退出');
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  try { await api('auth/logout', { method: 'POST' }); }
  catch (error) { return toast(error.message, 'error'); }
  state.csrf = null;
  state.root = null;
  state.posts = [];
  state.drafts = [];
  state.pages = [];
  state.current = null;
  state.config = null;
  state.configDirty = false; state.configBuffer = null; state.commandLog = ''; state.lists = {};
  state.editorBuffer = null;
  $('#view').replaceChildren();
  showAuth(true);
};
$('#account-settings').onclick = () => {
  modal('<h2 id="modal-title">修改管理员密码</h2><p>修改后所有设备都需要重新登录。</p><form id="password-form" class="password-form"><label>当前密码<input id="old-password" type="password" autocomplete="current-password" required></label><label>新密码<input id="new-password" type="password" autocomplete="new-password" minlength="12" required></label><label>确认新密码<input id="confirm-password" type="password" autocomplete="new-password" required></label><div class="actions"><button type="button" class="secondary" id="cancel-password">取消</button><button type="submit" class="primary">保存并退出</button></div></form>');
  $('#cancel-password').onclick = closeModal;
  $('#password-form').onsubmit = async event => {
    event.preventDefault();
    if ($('#new-password').value !== $('#confirm-password').value) return toast('两次输入的新密码不一致');
    const submit = $('#password-form button[type="submit"]');
    submit.disabled = true;
    try {
      await api('auth/password', { method: 'POST', data: { oldPassword: $('#old-password').value, newPassword: $('#new-password').value } });
      closeModal();
      state.csrf = null;
      state.current = null;
      state.config = null;
      state.configDirty = false;
      $('#view').replaceChildren();
      showAuth(true);
      toast('密码已更新，请重新登录');
    } catch (error) { toast(error.message, 'error'); submit.disabled = false; }
  };
};
$('#account-storage').onclick = async () => {
  let current;
  try { current = (await api('auth/storage')).storage; }
  catch (error) { return toast(error.message, 'error'); }
  modal('<h2 id="modal-title">账号存储</h2><p id="current-storage"></p><form id="storage-form"><label>目标存储<select id="move-storage-type"><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="mongodb">MongoDB</option></select></label><div id="move-storage-fields"></div><label>当前管理员密码<input id="move-password" type="password" autocomplete="current-password" required></label><p>切换后需要重新登录。原数据库中的账号记录会保留，便于手动回退。</p><div class="actions"><button id="move-test" type="button" class="secondary">测试连接</button><button id="move-submit" type="submit" class="primary">迁移并退出</button></div></form>');
  $('#current-storage').textContent = `当前：${current.type} · ${current.label}`;
  $('#move-storage-type').value = ['postgres', 'mysql', 'mongodb'].includes(current.type) ? current.type : 'postgres';
  storageFields($('#move-storage-type').value, 'move');
  $('#move-storage-type').onchange = () => storageFields($('#move-storage-type').value, 'move');
  $('#move-test').onclick = async () => {
    $('#move-test').disabled = true;
    try { await api('auth/storage/test', { method: 'POST', data: { storage: storageValue('move') } }); toast('存储连接成功'); }
    catch (error) { toast(error.message, 'error'); }
    finally { if ($('#move-test')) $('#move-test').disabled = false; }
  };
  $('#storage-form').onsubmit = async event => {
    event.preventDefault();
    $('#move-submit').disabled = true;
    try {
      await api('auth/storage/migrate', { method: 'POST', data: { password: $('#move-password').value, storage: storageValue('move') } });
      closeModal(); state.csrf = null; $('#view').replaceChildren(); showAuth(true); toast('账号已迁移，请重新登录');
    } catch (error) { toast(error.message, 'error'); if ($('#move-submit')) $('#move-submit').disabled = false; }
  };
};
$('#top-new').onclick = () => showNewPost((state.view === 'pages' || (state.view === 'editor' && state.current?.kind === 'page')) ? 'page' : 'post');
$('#modal-close').onclick = closeModal;
$('#modal').onclick = event => { if (event.target === $('#modal')) closeModal(); };
document.addEventListener('keydown', event => {
  const modalOpen = !$('#modal').classList.contains('hidden');
  if (event.key === 'Escape' && modalOpen) closeModal();
  if (event.key === 'Tab' && modalOpen) {
    const focusable = [...$('#modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !modalOpen) {
    if (state.view === 'editor' || state.view === 'config') { event.preventDefault(); state.view === 'editor' ? savePost() : saveConfig(); }
  }
});
window.addEventListener('beforeunload', event => { if (state.editorDirty || state.configDirty || state.busy || state.uploading || state.connecting) { if (state.editorDirty) saveDraft(); event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try {
    const status = await api('auth/status');
    if (!status.authenticated) return showAuth(status.configured);
    state.csrf = status.csrf;
    await loadWorkspace();
  } catch (error) { showAuth(true); toast(error.message); }
})();
