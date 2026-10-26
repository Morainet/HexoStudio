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
  }).catch(() => { throw new Error(t("无法连接服务，请检查服务是否运行后重试")); });
  const result = await response.json().catch(() => { throw new Error(t("服务返回异常，请稍后重试")); });
  if (response.status === 401 && !name.startsWith('auth/')) { state.csrf = null; closeModal(true); showAuth(true); }
  if (!response.ok) throw Object.assign(new Error(HexoI18n.error(result.error || "请求失败")), { status: response.status });
  return result;
}
function toast(message, tone = 'success') {
  const el = $('#toast');
  el.textContent = message; el.dataset.tone = tone;
  el.classList.remove('hidden'); clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), tone === 'error' ? 7000 : 3500);
}
function modal(content) {
  if (state.modalBusy) return false;
  if ($('#modal').classList.contains('hidden')) modal.previousFocus = document.activeElement;
  state.dialogVersion = (state.dialogVersion || 0) + 1;
  $('#modal-content').innerHTML = content;
  $('#modal-feedback').textContent = '';
  $('#modal-feedback').classList.add('hidden');
  $('#modal').classList.remove('hidden');
  $('#app').inert = true; $('#setup-blog-screen').inert = true;
  const focus = $('#modal-content').querySelector('input:not([type="hidden"]):not(:disabled),textarea,select,button:not(:disabled)');
  (focus || $('#modal-close')).focus();
  return true;
}
function closeModal(force = false) {
  if (force !== true && (state.connecting || state.modalBusy)) return;
  state.dialogVersion = (state.dialogVersion || 0) + 1;
  $('#modal').classList.add('hidden'); $('#modal-content').innerHTML = '';
  $('#modal-feedback').classList.add('hidden');
  $('#app').inert = false; $('#setup-blog-screen').inert = false;
  if (force !== true && modal.previousFocus?.isConnected) modal.previousFocus.focus();
}
async function modalAction(button, action, label = t("处理中…")) {
  if (!button || button.disabled || state.modalBusy || state.connecting) return { ok: false };
  const version = state.dialogVersion;
  const content = $('#modal-content'), feedback = $('#modal-feedback');
  const controls = [...content.querySelectorAll('button,input,select,textarea'), $('#modal-close')];
  const disabled = controls.map(control => control.disabled);
  const original = button.textContent;
  state.modalBusy = true;
  controls.forEach(control => control.disabled = true);
  content.setAttribute('aria-busy', 'true'); button.textContent = label;
  feedback.dataset.tone = 'pending'; feedback.setAttribute('role', 'status');
  feedback.textContent = label; feedback.classList.remove('hidden'); feedback.focus();
  try {
    const value = await action();
    if (version !== state.dialogVersion) return { ok: false };
    feedback.classList.add('hidden');
    return { ok: true, value };
  } catch (error) {
    if (version === state.dialogVersion) {
      feedback.dataset.tone = 'error'; feedback.setAttribute('role', 'alert'); feedback.textContent = error.message;
    }
    return { ok: false };
  } finally {
    state.modalBusy = false;
    content.removeAttribute('aria-busy');
    controls.forEach((control, i) => { if (control.isConnected) control.disabled = disabled[i]; });
    if (button.isConnected) {
      button.textContent = original;
      if (version === state.dialogVersion) button.focus();
    }
  }
}
async function withButton(button, action, label = t("处理中…")) {
  if (!button || button.disabled) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = label;
  try { return await action(); }
  catch (error) { toast(error.message, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = original; } }
}
function viewError(title, message, retry) {
  $('#view').innerHTML = `${pageHead('WORKSPACE', title, '')}<section class="panel empty"><div class="symbol">${icon('folder')}</div><h2>${t("暂时无法加载")}</h2><p>${escapeHTML(message)}</p><button id="retry-view" class="secondary">${t("重新加载")}</button></section>`;
  $('#retry-view').onclick = retry;
}
function date(value) { return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : t("未设置日期"); }
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
  catch { if ($('#editor-status')) $('#editor-status').textContent = t("本机草稿未备份，请及时保存"); }
}
function canLeaveEditor() { if (state.uploading) { toast(t("图片正在上传，请稍候")); return false; } if (state.saving) { toast(t("文章正在保存，请稍候")); return false; } if (!state.editorDirty) return true; saveDraft(); return window.confirm(t("文章还有未保存的改动，确定离开吗？建议先保存到博客。")); }
function setEditorDirty() {
  state.editorBuffer = $('#editor').value;
  if (document.activeElement === $('#editor')) rememberEditorSelection();
  document.querySelectorAll('[data-meta]').forEach(input => { state.metadataValues[input.dataset.meta] = input.value; });
  state.editorDirty = state.editorBuffer !== state.current.content || Object.keys(metadataEdits()).length > 0;
  $('#save-post').textContent = state.editorDirty ? t("保存更改 ●") : t`保存${state.current.kind === 'draft' ? t("草稿") : state.current.kind === 'page' ? t("页面") : t("文章")}`;
  $('#editor-status').textContent = state.editorDirty ? t("未保存更改") : t("所有更改已保存");
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
    } catch (error) { if (version === state.previewVersion && $('#preview')) $('#preview').textContent = t`预览失败：${error.message}`; }
  }, delay);
}
function updateShell() {
  $('#project-name').textContent = state.root ? (state.site?.title || fullName(state.root)) : t("尚未连接项目");
  $('#project-path').textContent = state.connection?.type === 'remote' ? `${state.connection.provider} · ${state.connection.repository}` : state.root || t("请选择 Hexo 目录");
  $('#top-new').disabled = !state.root;
  $('#top-new span').textContent = (state.view === 'pages' || (state.view === 'editor' && state.current?.kind === 'page')) ? t("新建页面") : t("新建文章");
  document.querySelectorAll('.nav button').forEach(button => {
    const active = button.dataset.view === (state.view === 'editor' ? state.current?.kind === 'page' ? 'pages' : 'posts' : state.view);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const title = { dashboard: t("概览"), posts: t("文章管理"), pages: t("页面管理"), editor: state.current?.kind === 'draft' ? t("编辑草稿") : state.current?.kind === 'page' ? t("编辑页面") : t("编辑文章"), config: t("站点配置"), git: t("Git 仓库"), deploy: t("构建与部署") }[state.view];
  $('#breadcrumb').textContent = t`工作空间 / ${title}`;
}
function pageHead(kicker, title, subtitle, actions = '') { return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p>${state.cloud ? `<p class="cloud-note">${t("云端模式：保存、上传和删除会直接提交到远端仓库。")}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`; }
function row(post, compact = false) {
  const identity = `data-kind="${post.kind}" data-open="${escapeHTML(post.path)}"`;
  if (compact) return `<div class="post-row"><div class="post-avatar">${icon('post')}</div><div class="post-summary"><div class="post-title">${escapeHTML(post.title)}</div><div class="post-meta">${escapeHTML(date(post.date || post.modified))} · ${post.words} ${t("字 ·")} ${escapeHTML(post.path)}</div></div><button ${identity}>${t("编辑")} ${icon('arrow')}</button></div>`;
  return `<div class="article-row"><div><span class="title">${escapeHTML(post.title)}</span><div class="excerpt">${escapeHTML(post.excerpt || post.path)}</div></div><span>${post.tags.length ? post.tags.slice(0, 2).map(tag => `<span class="pill">${escapeHTML(tag)}</span>`).join('') : `<span class="muted">${t("无标签")}</span>`}</span><span class="muted">${escapeHTML(date(post.date || post.modified))}</span><div class="row-actions"><button ${identity}>${t("编辑")}</button>${post.kind === 'draft' ? `<button data-publish="${escapeHTML(post.path)}">${t("发布")}</button>` : ''}<button data-kind="${post.kind}" data-delete="${escapeHTML(post.path)}">${t("删除")}</button></div></div>`;
}
function dashboard() {
  const count = state.posts.length;
  const recent = state.posts.slice(0, 5);
  $('#view').innerHTML = `${pageHead('WORKSPACE', t("工作台"), state.site?.title ? t`${escapeHTML(state.site.title)} · 内容概览` : t("查看博客内容，继续你的创作。"), `<button id="hero-new" class="primary">${icon('plus')} ${t("新建草稿")}</button>`)}
    <div class="stats"><div class="stat-card"><span class="stat-icon">${icon('post')}</span><div><small>${t("文章总数")}</small><strong>${count}</strong></div><span class="stat-tail">${t("已发布")}</span></div><div class="stat-card"><span class="stat-icon">${icon('pages')}</span><div><small>${t("页面总数")}</small><strong>${state.pages.length}</strong></div><span class="stat-tail">${t("独立页面")}</span></div><div class="stat-card"><span class="stat-icon">${icon('pen')}</span><div><small>${t("草稿数量")}</small><strong>${state.drafts.length}</strong></div><span class="stat-tail">${t("待完成")}</span></div></div>
    <div class="columns"><section class="panel"><div class="panel-title"><h3>${t("最近的文章")}</h3><button data-view="posts">${t("查看全部")} ${icon('arrow')}</button></div><div class="post-list">${recent.length ? recent.map(post => row(post, true)).join('') : `<div class="empty"><div class="symbol">${icon('post')}</div>${t("还没有文章，创建第一篇吧。")}</div>`}</div></section><section class="panel"><div class="panel-title"><h3>${t("常用操作")}</h3></div><div class="quick-actions"><button class="quick-action" id="quick-new"><span class="q-icon">${icon('pen')}</span><span><strong>${t("新建草稿")}</strong><small>${t("记录想法，稍后发布")}</small></span>${icon('arrow', 'icon quick-arrow')}</button><button class="quick-action" data-view="pages"><span class="q-icon">${icon('pages')}</span><span><strong>${t("管理页面")}</strong><small>${t("编辑关于、友链等独立页面")}</small></span>${icon('arrow', 'icon quick-arrow')}</button><button class="quick-action" data-view="config"><span class="q-icon">${icon('settings')}</span><span><strong>${t("编辑站点配置")}</strong><small>${t("调整 Hexo 与主题设置")}</small></span>${icon('arrow', 'icon quick-arrow')}</button></div><div class="hint-card">${t("草稿不会展示在博客中。准备好后发布，再构建站点。")}</div></section></div>`;
  $('#hero-new').onclick = () => showNewPost('draft');
  $('#quick-new').onclick = () => showNewPost('draft');
}
function listPreferences(kind) {
  state.lists ||= {};
  return state.lists[kind] ||= { query: '', tag: 'all', sort: 'recent', page: 1, timeKey: kind === 'page' ? 'modified' : 'date' };
}
function listPage(items, prefs) {
  const sorted = [...items].sort((a, b) => prefs.sort === 'title'
    ? a.title.localeCompare(b.title, HexoI18n.language)
    : String(b[prefs.timeKey || 'date'] || b.modified || '').localeCompare(String(a[prefs.timeKey || 'date'] || a.modified || '')));
  const pages = Math.max(1, Math.ceil(sorted.length / 20));
  prefs.page = Math.min(Math.max(prefs.page, 1), pages);
  return { items: sorted.slice((prefs.page - 1) * 20, prefs.page * 20), pages, total: sorted.length };
}
function listFooter(page, prefs) {
  return `<footer class="list-footer"><span role="status">${t("共")} ${page.total} ${t("项")}${page.total ? t` · 第 ${(prefs.page - 1) * 20 + 1}–${Math.min(prefs.page * 20, page.total)} 项` : ''}</span><div><button id="list-prev" class="secondary" ${prefs.page <= 1 ? 'disabled' : ''} aria-label="${t("上一页")}">${t("上一页")}</button><span>${prefs.page} / ${page.pages}</span><button id="list-next" class="secondary" ${prefs.page >= page.pages ? 'disabled' : ''} aria-label="${t("下一页")}">${t("下一页")}</button></div></footer>`;
}
function listSort(prefs) {
  return `<select id="list-sort" class="filter" aria-label="${t("排序方式")}"><option value="recent" ${prefs.sort === 'recent' ? 'selected' : ''}>${t("最新优先")}</option><option value="title" ${prefs.sort === 'title' ? 'selected' : ''}>${t("标题排序")}</option></select>`;
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
  }, t("刷新中…"));
}
function postsPage() {
  const items = state.contentKind === 'draft' ? state.drafts : state.posts;
  const prefs = listPreferences(state.contentKind);
  const query = prefs.query.trim().toLowerCase();
  const tags = [...new Set(items.flatMap(post => post.tags))].sort();
  if (prefs.tag !== 'all' && !tags.includes(prefs.tag)) prefs.tag = 'all';
  const page = listPage(items.filter(post => (post.title + post.path + post.tags.join(' ')).toLowerCase().includes(query) && (prefs.tag === 'all' || post.tags.includes(prefs.tag))), prefs);
  const filtered = query || prefs.tag !== 'all';
  $('#view').innerHTML = `${pageHead('CONTENT LIBRARY', t("文章管理"), t`已发布 ${state.posts.length} 篇文章 · ${state.drafts.length} 篇草稿。`, `<button id="refresh-list" class="secondary">${t("刷新")}</button><button id="new-draft" class="secondary">${t("＋ 新建草稿")}</button><button id="new-post" class="primary">${t("＋ 新建文章")}</button>`)}
  <div class="content-tabs"><button data-content-kind="post" class="${state.contentKind === 'post' ? 'active' : ''}">${t("已发布文章")} <span>${state.posts.length}</span></button><button data-content-kind="draft" class="${state.contentKind === 'draft' ? 'active' : ''}">${t("草稿箱")} <span>${state.drafts.length}</span></button></div>
  <div class="toolbar"><label class="search">${icon('search')}<input id="search" type="search" aria-label="${t("搜索文章")}" placeholder="${t("搜索标题、路径或标签")}" value="${escapeHTML(prefs.query)}"></label><div class="list-filters"><select id="filter" class="filter" aria-label="${t("按标签筛选")}"><option value="all">${t("全部标签")}</option>${tags.map(tag => `<option value="${escapeHTML(tag)}" ${tag === prefs.tag ? 'selected' : ''}>${escapeHTML(tag)}</option>`).join('')}</select>${listSort(prefs)}</div></div>
  <section class="panel table-panel"><div class="table-head"><span>${t("文章")}</span><span>${t("标签")}</span><span>${t("日期")}</span><span>${t("操作")}</span></div>${page.total ? page.items.map(post => row(post)).join('') : `<div class="empty"><div class="symbol">${icon('post')}</div><h2>${filtered ? t("没有匹配的文章") : state.contentKind === 'draft' ? t("开始记录新的想法") : t("还没有文章")}</h2><p>${filtered ? t("试试其他关键词，或清除筛选。") : t("点击上方按钮，创建你的第一篇内容。")}</p>${filtered ? `<button id="clear-filter" class="secondary">${t("清除筛选")}</button>` : ''}</div>`}${listFooter(page, prefs)}</section>`;
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
  $('#view').innerHTML = `${pageHead('INDEPENDENT PAGES', t("页面管理"), t`共 ${state.pages.length} 个独立页面，位于 Hexo 的 source 目录。`, `<button id="refresh-list" class="secondary">${t("刷新")}</button><button id="new-page" class="primary">${t("＋ 新建页面")}</button>`)}
    <div class="toolbar"><label class="search">${icon('search')}<input id="page-search" type="search" aria-label="${t("搜索页面")}" placeholder="${t("搜索页面标题或路径")}" value="${escapeHTML(prefs.query)}"></label>${listSort(prefs)}</div>
    <section class="panel table-panel"><div class="table-head page-table"><span>${t("页面")}</span><span>${t("文件路径")}</span><span>${t("最近修改")}</span><span>${t("操作")}</span></div>${page.total ? page.items.map(item => `<div class="article-row page-table"><div><span class="title">${escapeHTML(item.title)}</span><div class="excerpt">${escapeHTML(item.excerpt || t("独立页面"))}</div></div><span class="muted page-path" title="${escapeHTML(item.path)}">${escapeHTML(item.path)}</span><span class="muted">${escapeHTML(date(item.modified))}</span><div class="row-actions"><button data-kind="page" data-open="${escapeHTML(item.path)}">${t("编辑")}</button><button data-kind="page" data-delete="${escapeHTML(item.path)}">${t("删除")}</button></div></div>`).join('') : `<div class="empty"><div class="symbol">${icon('pages')}</div><h2>${query ? t("没有匹配的页面") : t("创建你的第一个页面")}</h2><p>${query ? t("换个关键词试试。") : t("关于、友链等独立内容都可以在这里管理。")}</p>${query ? `<button id="clear-filter" class="secondary">${t("清除搜索")}</button>` : ''}</div>`}${listFooter(page, prefs)}</section>`;
  $('#new-page').onclick = () => showNewPost('page');
  bindList(prefs, pagesPage, '#page-search');
}
function editorPage() {
  const post = state.current;
  if (!post) return navigate('posts');
  const label = post.kind === 'draft' ? t("草稿") : post.kind === 'page' ? t("页面") : t("文章");
  $('#view').innerHTML = `${pageHead(post.kind === 'draft' ? 'DRAFT EDITOR' : post.kind === 'page' ? 'PAGE EDITOR' : 'EDITOR', escapeHTML(state.metadataValues.title || fullName(post.path)), `${label} · ${escapeHTML(post.path)}`, `<span id="editor-status" class="editor-status">${t("所有更改已保存")}</span><button id="back-posts" class="secondary">${t("返回列表")}</button>${post.kind === 'draft' ? `<button id="publish-draft" class="secondary">${t("发布草稿")}</button>` : ''}<button id="save-post" class="primary">${t`保存${label}`}</button>`)}
    <div class="editor-layout"><section class="panel editor-panel"><div class="editor-tabs"><button class="active" data-editor-tab="write">Markdown</button><button data-editor-tab="preview">${t("实时预览")}</button></div><div class="editor-toolbar" aria-label="${t("编辑工具")}"><button type="button" data-insert="bold" title="${t("加粗")}">B</button><button type="button" data-insert="italic" title="${t("斜体")}"><i>I</i></button><button type="button" data-insert="heading" title="${t("二级标题")}">H₂</button><button type="button" data-insert="link" title="${t("链接")}">${icon('link')}</button><span class="toolbar-separator"></span><button type="button" id="upload-image" title="${t("上传图片到博客")}">${icon('upload')} ${t("上传图片")}</button><button type="button" id="media-toggle" title="${t("选择已上传的图片")}">${icon('image')} ${t("图片库")}</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden><small>${t("可粘贴或拖入图片")}</small></div><div id="media-library" class="media-library hidden"><div class="media-head"><strong>${t("已上传图片")}</strong><span>${t`点击图片插入${label}`}</span></div><div id="media-list" class="media-grid">${t("加载中…")}</div></div><textarea id="editor" class="editor-textarea" spellcheck="false" aria-label="${t`Markdown ${label}内容`}"></textarea><div id="preview" class="preview hidden">${t("正在生成预览…")}</div></section>
    <aside class="panel meta-panel"><h3>${t`${label}信息`}</h3><label for="meta-title">${t("标题")}</label><input id="meta-title" data-meta="title" value="${escapeHTML(state.metadataValues.title)}" maxlength="300"><label for="meta-date">${t("日期")}</label><input id="meta-date" data-meta="date" value="${escapeHTML(state.metadataValues.date)}" placeholder="YYYY-MM-DD HH:mm:ss">${post.kind === 'page' ? '' : `<label for="meta-tags">${t("标签")}</label><input id="meta-tags" data-meta="tags" value="${escapeHTML(state.metadataValues.tags)}" placeholder="${t("用逗号分隔")}"><label for="meta-categories">${t("分类")}</label><input id="meta-categories" data-meta="categories" value="${escapeHTML(state.metadataValues.categories)}" placeholder="${t("用逗号分隔")}">`}<label>${t("文件路径")}</label><div class="meta-value">${escapeHTML(post.path)}</div><div class="hint-card">${t`修改${label}信息时只更新对应字段；主题自定义字段保持原样。也可以直接编辑文首的 YAML。`}</div></aside></div>`;
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
  $('#save-post').textContent = state.editorDirty ? t("保存更改 ●") : t`保存${label}`;
  $('#editor-status').textContent = state.editorDirty ? t("未保存更改") : t("所有更改已保存");
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
    container.innerHTML = result.images.length ? result.images.map(item => `<button class="media-card" type="button" data-media-url="${escapeHTML(item.url)}" data-media-name="${escapeHTML(item.name)}"><img src="${escapeHTML(item.url)}" alt=""><span>${escapeHTML(item.name)}</span></button>`).join('') : `<p class="media-empty">${t("还没有上传图片。可用上方按钮选择图片，或粘贴、拖入图片。")}</p>`;
    container.querySelectorAll('[data-media-url]').forEach(button => button.onclick = () => {
      const name = button.dataset.mediaName.replace(/[\[\]\\]/g, '\\$&');
      insertAtCursor(`![${name}](${button.dataset.mediaUrl})\n`);
      $('#media-library').classList.add('hidden');
    });
  } catch (error) { container.textContent = t`图片库加载失败：${error.message}`; }
}
function insertMarkup(kind) {
  const editor = $('#editor');
  const selected = editor.value.slice(state.editorSelection?.start ?? editor.value.length, state.editorSelection?.end ?? editor.value.length);
  if (kind === 'bold') insertAtCursor(`**${selected || t("加粗文字")}**`, 2, 2 + (selected || t("加粗文字")).length);
  if (kind === 'italic') insertAtCursor(`*${selected || t("斜体文字")}*`, 1, 1 + (selected || t("斜体文字")).length);
  if (kind === 'heading') insertAtCursor(`\n## ${selected || t("小标题")}\n`, 4, 4 + (selected || t("小标题")).length);
  if (kind === 'link') insertAtCursor(`[${selected || t("链接文字")}](https://)`, 1, 1 + (selected || t("链接文字")).length);
}
function imageBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(t("读取图片失败")));
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
      if (state.cloud && file.size > 3_000_000) throw new Error(t("云端图片不能超过 3 MB"));
      if (file.size > 8_000_000) throw new Error(t`${file.name} 超过 8 MB`);
      $('#editor-status').textContent = t`正在上传 ${file.name}…`;
      const result = await api('assets', { method: 'POST', data: { name: file.name, data: await imageBase64(file) } });
      if (state.current?.path !== currentPath || state.root !== currentRoot || !$('#editor')) return;
      insertAtCursor(`![${result.name}](${result.url})\n`);
      toast(t`图片已插入：${result.name}`);
    }
    if (!$('#media-library')?.classList.contains('hidden')) loadMediaLibrary();
  } catch (error) { toast(t`上传失败：${error.message}`); }
  finally { state.uploading = false; button.disabled = false; if ($('#editor-status')) $('#editor-status').textContent = state.editorDirty ? t("未保存更改") : t("所有更改已保存"); }
}
function configPage() {
  if (!state.config) return;
  const config = state.config;
  const format = config.scope.endsWith('.json') ? 'JSON' : 'YAML';
  const options = [`<option value="site">${t("Hexo 站点配置 · _config.yml")}</option>`, ...(config.overrides || []).map(filename => `<option value="override:${escapeHTML(filename)}">${escapeHTML(filename)} ${t("· 主题覆盖配置")}</option>`), ...config.themes.map(theme => `<option value="theme:${escapeHTML(theme)}">${escapeHTML(theme)} ${t("· 主题目录配置")}${theme === state.site?.theme ? t("（当前）") : ''}</option>`)].join('');
  $('#view').innerHTML = `${pageHead('SITE SETTINGS', t("站点配置"), t("直接查看并编辑 Hexo 与主题的配置文件。"), `<span id="config-status" class="editor-status" role="status"></span><button id="reload-config" class="secondary">${t("重新读取")}</button><button id="save-config" class="primary">${t("保存配置")}</button>`)}
    <div class="toolbar"><select id="scope" class="scope-select">${options}</select></div><section class="panel editor-panel"><textarea id="config-editor" class="code-area" spellcheck="false" aria-label="${format} ${t("配置")}"></textarea></section><div class="hint-card">${t("保存前请确认")} ${format} ${t("语法正确。HexoStudio 会保留原有注释和字段，不会重新格式化配置。")}</div>`;
  $('#scope').value = config.scope;
  $('#scope').onchange = async event => { const selected = event.target.value; if (!await loadConfig(selected)) event.target.value = config.scope; };
  $('#config-editor').value = state.configBuffer ?? config.content;
  $('#config-editor').oninput = () => { state.configBuffer = $('#config-editor').value; state.configDirty = state.configBuffer !== state.config.content; state.configSaveError = false; updateConfigStatus(); };
  updateConfigStatus();
  $('#reload-config').onclick = () => loadConfig(config.scope);
  $('#save-config').onclick = saveConfig;
}
function cloudRepositoryPage(deploy = false) {
  const connection = state.connection;
  const host = connection.provider === 'github' ? 'github.com' : 'gitlab.com';
  const url = `https://${host}/${connection.repository.split('/').map(encodeURIComponent).join('/')}`;
  const pipeline = url + (connection.provider === 'github' ? '/actions' : '/-/pipelines');
  $('#view').innerHTML = `${pageHead('CLOUD', deploy ? t("构建与部署") : t("Git 仓库"), escapeHTML(`${connection.repository} · ${connection.branch}`))}<section class="panel"><h3>${t("保存即提交")}</h3><p>${t("每次内容变更都会生成仓库提交，无需暂存或推送。请在博客仓库配置自动构建，提交后由流水线更新站点。")}</p><div class="actions"><a class="secondary" href="${url}" target="_blank" rel="noopener noreferrer">${t("打开仓库")}</a><a class="primary" href="${pipeline}" target="_blank" rel="noopener noreferrer">${t("查看部署流水线")}</a></div></section>`;
}
function deployPage() {
  if (state.cloud) return cloudRepositoryPage(true);
  $('#view').innerHTML = `${pageHead('PUBLISH WORKFLOW', t("构建与部署"), t("运行当前 Hexo 项目中已安装的本地命令。"))}
    <div class="command-grid"><button class="command-card" data-command="clean"><span class="command-icon">${icon('settings')}</span><strong>${t("清理缓存")}</strong><small>${t("hexo clean · 清理生成文件与缓存")}</small></button><button class="command-card" data-command="generate"><span class="command-icon">${icon('pages')}</span><strong>${t("生成静态站点")}</strong><small>${t("hexo generate · 输出到 public 目录")}</small></button><button class="command-card" data-command="deploy"><span class="command-icon">${icon('rocket')}</span><strong>${t("部署博客")}</strong><small>${t("hexo deploy · 使用项目当前部署配置")}</small></button></div>
    <section class="panel"><div class="panel-title"><h3>${t("运行日志")}</h3><button id="clear-log">${t("清空日志")}</button></div><div id="terminal" class="terminal" role="log" aria-label="${t("构建日志")}">${escapeHTML(state.commandLog || t("准备就绪。选择上方操作以运行 Hexo 命令。"))}</div></section>`;
  document.querySelectorAll('[data-command]').forEach(button => { button.disabled = Boolean(state.busy); button.onclick = () => runCommand(button.dataset.command); });
  $('#clear-log').disabled = Boolean(state.busy);
  $('#clear-log').onclick = () => { state.commandLog = ''; $('#terminal').textContent = t("日志已清空。"); };
}
function gitPage() {
  if (state.cloud) return cloudRepositoryPage();
  const git = state.git;
  if (!git) { $('#view').innerHTML = `${pageHead('GIT WORKSPACE', t("Git 仓库"), t("正在读取仓库状态…"))}`; return; }
  if (!git.isRepository) { $('#view').innerHTML = `${pageHead('GIT WORKSPACE', t("Git 仓库"), t("当前 Hexo 项目不是 Git 仓库。"))}<section class="panel"><p class="muted">${t("可以切换到 GitHub 或 GitLab 远端仓库，或连接已有的本机 Git 仓库。")}</p><button id="git-connect" class="primary">${t("连接仓库")}</button></section>`; $('#git-connect').onclick = showProjectModal; return; }
  const changed = git.changes.length;
  const staged = git.changes.filter(item => item.staged).length;
  $('#view').innerHTML = `${pageHead('GIT WORKSPACE', t("Git 仓库"), t`${escapeHTML(git.branch || t("分离的 HEAD"))} · ${changed} 个变更 · 领先 ${git.ahead} / 落后 ${git.behind}`, `<button id="git-refresh" class="secondary">${t("刷新本机")}</button><button id="git-fetch" class="secondary" ${git.remote ? '' : 'disabled'}>${t("检查远端")}</button><button id="git-pull" class="secondary" ${git.remote ? '' : 'disabled'}>${t("拉取更新")}</button><button id="git-push" class="primary" ${git.remote ? '' : 'disabled'}>${t("推送提交")}</button>`)}
    <section class="panel git-summary"><div><small>${t("远端仓库")}</small><strong>${escapeHTML(git.remote || t("未配置 origin"))}</strong></div><div><small>${t("连接方式")}</small><strong>${git.managed ? t("Token 连接") : t("本机 Git 仓库")}</strong></div></section>
    <section class="panel git-files"><div class="panel-title"><h3>${t("文件变更")}</h3><span class="muted">${staged} ${t("个已暂存")}</span></div>${changed ? git.changes.map(item => `<div class="git-file"><input type="checkbox" data-git-path="${escapeHTML(item.path)}" aria-label="${t("暂存")} ${escapeHTML(item.path)}" ${item.unstaged ? '' : 'disabled'}><span class="git-badge ${item.staged ? 'staged' : ''}">${escapeHTML(item.index)}</span><span class="git-file-name">${escapeHTML(item.path)}${item.staged && item.unstaged ? `<small>${t("暂存后又有修改")}</small>` : ''}</span><div class="git-file-actions">${item.unstaged ? `<button data-git-diff="working" data-git-file="${escapeHTML(item.path)}">${t("工作区差异")}</button>` : ''}${item.staged ? `<button data-git-diff="staged" data-git-file="${escapeHTML(item.path)}">${t("暂存差异")}</button><button data-git-unstage="${escapeHTML(item.path)}">${t("取消暂存")}</button>` : ''}</div></div>`).join('') : `<div class="empty">${t("工作区没有变更")}</div>`}<div class="git-actions"><button id="git-stage" class="secondary" ${git.changes.some(item => item.unstaged) ? '' : 'disabled'}>${t("暂存所选文件")}</button></div></section>
    <section class="panel git-commit"><h3>${t("提交已暂存变更")}</h3><p>${t("只提交已暂存的版本。若文件在暂存后又被修改，工作区差异不会进入本次提交。")}</p><div class="git-commit-row"><input id="git-message" placeholder="${t("填写本次提交说明")}" maxlength="300" value="${escapeHTML(state.gitMessage)}"><button id="git-commit" class="primary" ${staged ? '' : 'disabled'}>${t("创建提交")}</button></div></section>`;
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
  catch (error) { if (state.view === 'git' && root === state.root) viewError(t("Git 仓库"), error.message, loadGit); }
}
async function gitAction(action, data, message) {
  if (state.gitBusy) return;
  if (state.busy) return toast(t("Hexo 命令正在运行，请稍候"));
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
  if (!paths.length) return toast(t("请先选择文件"));
  return gitAction('stage', { paths }, t("所选文件已暂存"));
}
async function gitUnstage(path) { return gitAction('unstage', { path }, t("已取消暂存，文件修改仍保留")); }
async function showGitDiff(path, area) {
  modal(`<h2 id="modal-title">${area === 'staged' ? t("暂存差异") : t("工作区差异")}</h2><p>${escapeHTML(path)}</p><pre id="git-diff-content" class="git-diff-content">${t("正在读取差异…")}</pre><div class="actions"><button id="close-diff" class="secondary">${t("关闭")}</button></div>`);
  $('#close-diff').onclick = closeModal;
  const target = $('#git-diff-content');
  try {
    const result = await api('git/diff', { params: { path, area } });
    if (target.isConnected && $('#git-diff-content') === target) {
      const content = result.content + (result.truncated ? t("\n…差异过长，已截断") : '');
      target.innerHTML = content.split('\n').map(line => {
        const style = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : '';
        return `<span class="${style}">${escapeHTML(line)}</span>`;
      }).join('\n');
    }
  } catch (error) { if (target.isConnected && $('#git-diff-content') === target) target.textContent = error.message; }
}
async function gitCommit() {
  const message = $('#git-message').value.trim();
  if (!message) { toast(t("请填写提交说明")); $('#git-message').focus(); return; }
  return gitAction('commit', { message }, t("提交已创建，可以推送到远端"));
}
async function gitSync(action) {
  return gitAction(action, undefined, { fetch: t("远端状态已更新"), pull: t("已拉取远端更新"), push: t("提交已推送到远端") }[action]);
}
function render() { if (!$('#auth-screen').classList.contains('hidden')) return; updateShell(); if (!state.root) return onboarding(); $('#setup-blog-screen').classList.add('hidden'); $('#setup-blog-screen').replaceChildren(); $('#app').classList.remove('hidden'); ({ dashboard, posts: postsPage, pages: pagesPage, editor: editorPage, config: configPage, git: gitPage, deploy: deployPage })[state.view](); DisplayPreferences.place(); }
function connectionForm() {
  return `<div class="connection-choices" role="group" aria-label="${t("博客来源")}"><button type="button" data-connect-mode="local" class="active" aria-pressed="true">${icon("folder")}<span><strong>${t("本机目录")}</strong><small>${t("管理已有的 Hexo 项目")}</small></span></button><button type="button" data-connect-mode="remote" aria-pressed="false">${icon("git")}<span><strong>GitHub / GitLab</strong><small>${t("使用仓库地址与 Token")}</small></span></button></div>
    <div id="local-fields" class="connection-fields"><p>${t("输入包含")} <code>_config.yml</code> ${t("与")} <code>source/_posts</code> ${t("的项目目录。")}</p><label for="root-input">${t("Hexo 项目目录")}</label><input id="root-input" placeholder="${t("/Users/name/blog 或 C:\\Users\\name\\blog")}"><div class="connect-actions"><button id="connect-project" class="primary">${t("连接本机项目")}</button><button id="browse-project" class="secondary hidden">${t("浏览目录…")}</button></div></div>
    <div id="remote-fields" class="connection-fields hidden"><p>${t(state.cloud ? "通过仓库 API 管理内容，保存后直接提交到所选分支。" : "用 HTTPS 仓库地址和 Token 连接，项目会克隆到本机工作目录。")}</p><div class="connection-grid"><div><label for="remote-provider">${t("服务商")}</label><select id="remote-provider"><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></div><div><label for="remote-repo">${t("仓库")}</label><input id="remote-repo" placeholder="${t("username/repo 或 HTTPS 地址")}" autocomplete="off"></div><div class="full"><label for="remote-token">${t("访问 Token")}</label><input id="remote-token" type="password" placeholder="${t("有仓库读写权限的 Token")}" autocomplete="off"></div><div class="full"><details class="advanced-options"><summary>${t("更多选项 · 分支与博客路径")}</summary><div><label for="remote-branch">${t("项目分支")}</label><input id="remote-branch" placeholder="${t("留空使用默认分支")}" autocomplete="off"></div><div class="full"><label for="remote-path">${t("博客路径")}</label><input id="remote-path" placeholder="${t("留空为仓库根目录；例如 blog")}" autocomplete="off"></div></details></div></div><button id="connect-remote" class="primary">${t("连接远端仓库")}</button><p class="secret-note">${t(state.cloud ? "Token 加密保存在云端数据库中。" : "Token 保存在本机设置文件中，不写入 Git 远端地址。")}</p></div><p id="connection-error" class="form-error hidden" role="alert"></p>`;
}
function bindConnectionForm() {
  document.querySelectorAll('[data-connect-mode]').forEach(button => button.onclick = () => {
    if (state.connecting) return;
    $('#connection-error').classList.add('hidden');
    const remote = button.dataset.connectMode === 'remote';
    document.querySelectorAll('[data-connect-mode]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    $('#local-fields').classList.toggle('hidden', remote);
    $('#remote-fields').classList.toggle('hidden', !remote);
  });
  if (state.cloud) {
    document.querySelector('[data-connect-mode="remote"]').click();
    document.querySelector('.connection-choices').classList.add('hidden');
  }
  $('#connect-project').onclick = connectProject;
  $('#connect-remote').onclick = connectRemote;
  $('#root-input').onkeydown = event => { if (event.key === 'Enter') connectProject(); };
  if (window.hexoStudio) { $('#browse-project').classList.remove('hidden'); $('#browse-project').onclick = chooseDirectory; }
}
function onboarding() {
  $('#app').classList.add('hidden');
  $('#setup-blog-screen').classList.remove('hidden');
  $('#setup-blog-screen').innerHTML = `<section class="auth-card setup-blog-card"><div class="setup-progress" data-step="3" role="progressbar" aria-valuemin="1" aria-valuemax="${state.cloud ? 2 : 3}" aria-valuenow="${state.cloud ? 2 : 3}" aria-label="${t("初始化进度")}"><div class="setup-progress-caption"><span>${t("首次设置")}</span><span>${state.cloud ? "2 / 2" : "3 / 3"}</span></div><div class="setup-progress-track" aria-hidden="true"><span></span></div></div><div class="auth-heading"><div class="auth-brand" aria-hidden="true">H</div><div><div class="eyebrow">HEXOSTUDIO</div><h1>${t("连接你的博客")}</h1></div></div><p>${t("管理员已就绪，连接博客后即可开始管理。")}</p>${connectionForm()}<button id="setup-logout" class="setup-exit">${t("退出登录")}</button></section>`;
  bindConnectionForm();
  DisplayPreferences.place();
  $('#setup-logout').onclick = () => { if (!state.connecting) $('#logout').click(); };
}
function connectionError(message) {
  const error = $('#connection-error');
  if (error) { error.textContent = message; error.classList.remove('hidden'); } else toast(message, 'error');
}
async function connectBlog(remote) {
  if (state.connecting) return;
  if (state.cloud && !remote) return;
  if (state.busy || state.gitBusy) return toast(t("当前操作完成后才能切换项目"));
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  const button = $(remote ? '#connect-remote' : '#connect-project');
  const data = remote ? { provider: $('#remote-provider').value, repository: $('#remote-repo').value.trim(), token: $('#remote-token').value.trim(), branch: $('#remote-branch').value.trim(), blogPath: $('#remote-path').value.trim() } : { path: $('#root-input').value.trim() };
  if (remote ? !data.repository || !data.token : !data.path) {
    connectionError(remote ? t("请填写仓库地址和访问 Token。") : t("请先填写 Hexo 项目目录。")); return;
  }
  $('#connection-error').classList.add('hidden');
  state.contentRequest = null;
  state.connecting = true;
  const original = button.textContent;
  const controls = [...document.querySelectorAll('.connection-fields input,.connection-fields select,.connection-fields button,[data-connect-mode]')];
  controls.forEach(control => control.disabled = true); button.textContent = remote ? t("正在连接仓库…") : t("正在连接…");
  try {
    const result = await api(remote ? 'remote/connect' : 'project', { method: 'POST', data });
    state.root = result.root; state.site = result.site; state.connection = result.connection || { type: 'local' };
    state.git = null; state.config = null; state.configBuffer = null; state.configDirty = false; state.configSaveError = false;
    state.current = null; state.editorDirty = false; state.contentKind = 'post'; state.lists = {};
    state.posts = []; state.drafts = []; state.pages = []; state.commandLog = '';
    let refreshError;
    try { await refreshPosts(); } catch (error) { refreshError = error; }
    state.connecting = false; closeModal(); state.view = 'dashboard'; render();
    toast(refreshError ? t`项目已连接，内容刷新失败：${refreshError.message}。请在列表中重试刷新。` : t("博客已连接，可以开始创作了"), refreshError ? 'error' : 'success');
  } catch (error) { connectionError(error.message); }
  finally { state.connecting = false; controls.forEach(control => { if (control.isConnected) control.disabled = false; }); if (button.isConnected) button.textContent = original; }
}
async function connectProject() { return connectBlog(false); }
async function connectRemote() { return connectBlog(true); }
function showProjectModal() {
  if (state.busy || state.gitBusy) return toast(t("当前操作完成后才能切换项目"));
  modal(`<h2 id="modal-title">${t("切换 Hexo 项目")}</h2>${connectionForm()}<div class="actions"><button class="secondary" id="cancel-modal">${t("取消")}</button></div>`);
  bindConnectionForm(); $('#cancel-modal').onclick = closeModal;
}
async function chooseDirectory() { const selected = await window.hexoStudio?.selectDirectory(); if (selected && $('#root-input')) $('#root-input').value = selected; }
function localDateTime() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`; }
function showNewPost(kind = 'post') { if (state.gitBusy) return toast(t("Git 操作正在进行，请稍候")); if (!state.root || (state.view === 'editor' && !canLeaveEditor()) || (state.view === 'config' && !canLeaveConfig())) return; state.newKind = ['post', 'draft', 'page'].includes(kind) ? kind : 'post'; const label = state.newKind === 'draft' ? t("草稿") : state.newKind === 'page' ? t("页面") : t("文章"); const folder = state.newKind === 'draft' ? 'source/_drafts' : state.newKind === 'page' ? t("source/页面路径/index.md") : 'source/_posts'; modal(`<h2 id="modal-title">${t`新建${label}`}</h2><p>${t`给${label}取个名字，HexoStudio 会在 ${folder} 中创建 Markdown 文件。`}</p><label for="new-title">${t`${label}标题`}</label><input id="new-title" placeholder="${t`写下${label}标题`}"><div class="actions"><button class="secondary" id="cancel-modal">${t("取消")}</button><button class="primary" id="create-post">${t("创建并编辑")}</button></div>`); $('#new-title').focus(); $('#cancel-modal').onclick = closeModal; $('#create-post').onclick = createPost; $('#new-title').onkeydown = event => { if (event.key === 'Enter') createPost(); }; }
async function createPost() {
  if (state.modalBusy) return;
  const title = $('#new-title').value.trim();
  if (!title) { toast(t("请填写标题")); $('#new-title').focus(); return; }
  const kind = state.newKind;
  const result = await modalAction($('#create-post'), async () => {
    const post = await api('posts', { method: 'POST', data: { title, localDate: localDateTime(), kind } });
    try { await refreshPosts(); } catch (error) { toast(t`内容已创建，列表刷新失败：${error.message}`, 'error'); }
    return post;
  }, t("正在创建…"));
  if (!result.ok) return;
  closeModal();
  await openPost(result.value.path, kind, true);
}
async function refreshPosts() { const root = state.root; const [posts, drafts, pages] = await Promise.all([api('posts'), api('posts', { params: { kind: 'draft' } }), api('posts', { params: { kind: 'page' } })]); if (root !== state.root) return; state.posts = posts.posts; state.drafts = drafts.posts; state.pages = pages.posts; }
async function openPost(path, kind = 'post', skipGuard = false) {
  if (!skipGuard && ((state.view === 'editor' && !canLeaveEditor()) || (state.view === 'config' && !canLeaveConfig()))) return;
  const request = state.contentRequest = {};
  const root = state.root, view = state.view, dialogVersion = state.dialogVersion;
  const buffer = state.editorBuffer, metadata = JSON.stringify(state.metadataValues), configBuffer = state.configBuffer;
  const active = () => state.contentRequest === request && state.root === root && state.view === view && state.dialogVersion === dialogVersion;
  try {
    const post = await api('post', { params: { path, kind } });
    if (!active()) return;
    // The previous editor stays usable while the request is in flight.
    if (state.saving || state.configSaving || state.uploading || buffer !== state.editorBuffer || metadata !== JSON.stringify(state.metadataValues) || configBuffer !== state.configBuffer) {
      toast(t("编辑内容已变化，请重新打开目标文章")); return;
    }
    state.configDirty = false; state.configBuffer = state.config?.content; state.configSaveError = false;
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
      modal(`<h2 id="modal-title">${t("发现未保存草稿")}</h2><p>${t("这篇文章在本机留有未保存内容。")}${stale ? t("磁盘文件后来发生了变化；恢复后保存时会先提示冲突。") : t("可以继续编辑草稿，或使用磁盘上的版本。")}</p><div class="actions"><button class="secondary" id="discard-draft">${t("使用磁盘版本")}</button><button class="primary" id="restore-draft">${t("恢复草稿")}</button></div>`);
      $('#discard-draft').onclick = () => { clearDraft(path, kind); closeModal(); };
      $('#restore-draft').onclick = () => { state.editorBuffer = draft.content; state.editorBaseModified = draft.modified; state.metadataValues = { ...state.metadataBase, ...(draft.metadataValues || {}) }; state.editorDirty = true; editorPage(); closeModal(); };
    }
  } catch (error) { if (active()) toast(error.message, 'error'); }
  finally { if (state.contentRequest === request) state.contentRequest = null; }
}
async function savePost() {
  if (!state.current || state.saving) return false;
  if (state.uploading) { toast(t("图片正在上传，完成后再保存")); return false; }
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
    toast(refreshError ? t`已保存，列表刷新失败：${refreshError.message}` : updated.kind === 'draft' ? t("草稿已保存") : updated.kind === 'page' ? t("页面已保存") : t("文章已保存"));
    return true;
  } catch (error) { toast(error.message, 'error'); return false; }
  finally { state.saving = false; if ($('#editor') === editor) { editor.readOnly = false; $('#save-post').disabled = false; document.querySelectorAll('[data-meta]').forEach(input => input.disabled = false); } }
}
async function requestPublish(path) {
  if (state.saving) return toast(t("文章正在保存，请稍候"));
  if (state.view === 'editor' && state.current?.kind === 'draft' && state.current.path === path && state.editorDirty) {
    if (!await savePost()) return;
  }
  const draft = state.drafts.find(item => item.path === path);
  if (!draft) return toast(t("草稿不存在，请刷新列表"));
  modal(`<h2 id="modal-title">${t("发布草稿？")}</h2><p>${t("将")} <strong>${escapeHTML(draft.title)}</strong> ${t(state.cloud ? "移入 source/_posts 并提交到远端分支。博客是否更新取决于仓库的自动部署配置。" : "移入 source/_posts。发布后可继续编辑，再到「构建与部署」生成静态站点。")}</p><div class="actions"><button class="secondary" id="cancel-modal">${t("取消")}</button><button class="primary" id="confirm-publish">${t("发布为文章")}</button></div>`);
  $('#cancel-modal').onclick = closeModal;
  $('#confirm-publish').onclick = async () => {
    const outcome = await modalAction($('#confirm-publish'), async () => {
      const result = await api('publish', { method: 'POST', data: { path, modified: draft.modified, localDate: localDateTime() } });
      clearDraft(path, 'draft');
      let refreshError;
      state.drafts = state.drafts.filter(item => item.path !== path);
      try { await refreshPosts(); } catch (error) { refreshError = error; }
      return { result, refreshError };
    }, t("正在发布…"));
    if (!outcome.ok) return;
    const { result, refreshError } = outcome.value;
    closeModal();
    state.current = null; state.editorDirty = false; state.contentKind = 'post'; state.view = 'posts';
    render();
    toast(refreshError ? t`草稿已发布，列表刷新失败：${refreshError.message}` : t`草稿已发布：${result.path}`, refreshError ? 'error' : 'success');
  };
}
function confirmDelete(path, kind = 'post') {
  const label = kind === 'draft' ? t("草稿") : kind === 'page' ? t("页面") : t("文章");
  modal(`<h2 id="modal-title">${t("删除")}${label}？</h2><p>${t("这会从 Hexo 源码目录删除")} <strong>${escapeHTML(path)}</strong>${t("。此操作无法在后台撤销。")}</p><div class="actions"><button class="secondary" id="cancel-modal">${t("取消")}</button><button class="secondary danger" id="confirm-delete">${t("删除")}${label}</button></div>`);
  $('#cancel-modal').onclick = closeModal;
  $('#confirm-delete').onclick = async () => {
    const outcome = await modalAction($('#confirm-delete'), async () => {
      await api('post', { method: 'DELETE', params: { path, kind, ...(state.cloud ? { modified: state[kind === 'draft' ? 'drafts' : kind === 'page' ? 'pages' : 'posts'].find(item => item.path === path)?.modified || '' } : {}) } });
      clearDraft(path, kind);
      const key = kind === 'draft' ? 'drafts' : kind === 'page' ? 'pages' : 'posts';
      state[key] = state[key].filter(item => item.path !== path);
      let refreshError;
      try { await refreshPosts(); } catch (error) { refreshError = error; }
      return refreshError;
    }, t("正在删除…"));
    if (!outcome.ok) return;
    closeModal(); render();
    const refreshError = outcome.value;
    toast(refreshError ? t`${label}已删除，列表刷新失败：${refreshError.message}` : t`${label}已删除`, refreshError ? 'error' : 'success');
  };
}
function updateConfigStatus() {
  const status = $('#config-status');
  if (status) status.textContent = state.configSaving ? t("正在保存…") : state.configSaveError ? t("保存失败，修改仍保留") : state.configDirty ? t("未保存更改") : t("所有更改已保存");
  const button = $('#save-config');
  if (button) button.textContent = state.configSaving ? t("正在保存…") : state.configDirty ? t("保存配置 ●") : t("保存配置");
}
function canLeaveConfig() {
  if (state.configSaving) { toast(t("配置正在保存，请稍候")); return false; }
  return !state.configDirty || window.confirm(t("配置还有未保存的改动，确定放弃吗？"));
}
async function loadConfig(scope = 'site') {
  if (state.view === 'config' && !canLeaveConfig()) return false;
  const request = state.contentRequest = {};
  const root = state.root;
  const active = () => state.contentRequest === request && root === state.root && state.view === 'config';
  state.view = 'config'; updateShell();
  $('#view').innerHTML = `${pageHead('SITE SETTINGS', t("站点配置"), t("正在读取配置…"))}`;
  try {
    const config = await api('config', { params: { scope } });
    if (!active()) return false;
    state.config = config; state.configBuffer = config.content; state.configDirty = false; state.configSaveError = false;
    render(); return true;
  } catch (error) {
    if (active()) {
      // Keep the previous buffer until its replacement has loaded successfully.
      if (state.config) { render(); toast(error.message, 'error'); }
      else viewError(t("站点配置"), error.message, () => loadConfig(scope));
    }
    return false;
  } finally { if (state.contentRequest === request) state.contentRequest = null; }
}
async function saveConfig() {
  if (state.configSaving) return;
  const button = $('#save-config'); const editor = $('#config-editor');
  if (!editor || !state.config) return;
  const config = state.config; const content = editor.value;
  state.configSaving = true; state.configSaveError = false; button.disabled = true; editor.readOnly = true;
  $('#reload-config').disabled = true; updateConfigStatus();
  $('#scope').disabled = true; button.textContent = t("正在保存…");
  try {
    const result = await api('config', { method: 'PUT', data: { scope: config.scope, content, modified: config.modified } });
    config.content = content; config.modified = result.modified;
    state.configBuffer = content; state.configDirty = false;
    toast(t("配置已保存"));
  } catch (error) { state.configSaveError = true; toast(error.message, 'error'); }
  finally {
    state.configSaving = false;
    if (button.isConnected) { button.disabled = false; editor.readOnly = false; $('#scope').disabled = false; $('#reload-config').disabled = false; updateConfigStatus(); }
  }
}
function appendCommandLog(text) {
  state.commandLog = ((state.commandLog || '') + text).slice(-200000);
  const terminal = $('#terminal');
  if (terminal) { terminal.textContent = state.commandLog; terminal.scrollTop = terminal.scrollHeight; }
}
async function runCommand(action) {
  if (state.busy) return toast(t("已有命令正在运行"));
  if (state.gitBusy) return toast(t("Git 操作正在进行，请稍候"));
  if (action === 'deploy' && !window.confirm(t("将按当前 Hexo 配置部署博客，确定继续？"))) return;
  state.busy = true; state.commandLog = `$ hexo ${action}\n`; deployPage();
  let exitCode = null;
  try {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: JSON.stringify({ action }) });
    if (!response.ok) { const result = await response.json(); if (response.status === 401) { state.csrf = null; showAuth(true); } throw new Error(result.error || t("命令运行失败")); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    const consume = line => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.type === 'exit') { exitCode = item.code; appendCommandLog(t`\n进程结束，退出码 ${item.code}\n`); }
      else appendCommandLog(item.text || '');
    };
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(consume);
      if (done) { if (pending) consume(pending); break; }
    }
    if (exitCode === null) throw new Error(t("连接已中断，未收到命令完成结果，请检查日志"));
    toast(exitCode === 0 ? t("Hexo 命令执行完成") : t`命令未成功，退出码 ${exitCode}，请查看日志`, exitCode === 0 ? 'success' : 'error');
  } catch (error) { appendCommandLog(t`\n错误：${error.message}\n`); toast(error.message, 'error'); }
  finally { state.busy = false; if (state.view === 'deploy' && $('#terminal')) deployPage(); }
}
async function navigate(view) {
  if (state.gitBusy) { toast(t("Git 操作正在进行，请稍候")); return; }
  if (view === state.view && !state.contentRequest && !(view === 'config' && !state.config)) return;
  if (state.view === 'editor' && view !== 'editor') { if (!canLeaveEditor()) return; state.editorDirty = false; }
  if (state.view === 'config' && view !== 'config' && !canLeaveConfig()) return;
  state.contentRequest = null;
  if (state.view === 'config' && view !== 'config') { state.configDirty = false; state.configBuffer = state.config?.content; state.configSaveError = false; }
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
    const caption = document.createElement('span');
    caption.dataset.i18n = label; caption.textContent = t(label); row.append(caption);
    const input = document.createElement('input');
    input.id = `${prefix}-${id}`;
    input.placeholder = t(placeholder);
    input.dataset.i18nPlaceholder = placeholder;
    input.required = required;
    input.autocomplete = 'off';
    row.append(input);
    fields.append(row);
  };
  if (type === 'postgres') add("PostgreSQL 连接地址", 'storage-url', 'postgresql://user:password@host:5432/database');
  if (type === 'mysql') add("MySQL 连接地址", 'storage-url', 'mysql://user:password@host:3306/database');
  if (type === 'mongodb') { add("MongoDB 连接地址", 'storage-url', 'mongodb://user:password@host:27017'); add("数据库名称（地址中已包含可留空）", 'storage-database', "例如 hexostudio", false); }
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
  const storage = setup && step === 'storage' && !state.cloud;
  $('#auth-form').dataset.step = storage ? 'storage' : 'account';
  $('#auth-account-fields').disabled = storage;
  $('#auth-account-fields').classList.toggle('hidden', storage);
  $('#auth-storage-row').disabled = !storage;
  $('#auth-storage-row').classList.toggle('hidden', !storage);
  $('#auth-back').classList.toggle('hidden', !setup || storage || Boolean(state.cloud));
  $('#auth-steps').classList.toggle('hidden', !setup);
  $('#auth-steps').dataset.step = storage ? '1' : '2';
  $('#auth-steps').setAttribute('aria-valuemax', state.cloud ? '2' : '3');
  $('#auth-steps').setAttribute('aria-valuenow', state.cloud || storage ? '1' : '2');
  $('#auth-steps').classList.toggle('cloud-setup', Boolean(state.cloud));
  $('#auth-step-count').textContent = state.cloud ? '1 / 2' : storage ? '1 / 3' : '2 / 3';
  $('#auth-title').textContent = !setup ? t("登录工作台") : storage ? t("连接数据库") : t("设置管理员");
  $('#auth-description').textContent = !setup ? t("使用管理员账号继续管理博客。") : storage ? t("先连接数据库，用于保存管理员账号。") : t(state.cloud ? "数据库已就绪，输入部署时设置的初始化密钥并创建管理员。" : "数据库已连接，设置后台登录账号。");
  $('#auth-submit').textContent = !setup ? t("登录") : storage ? t("验证并继续") : t("创建账号并继续");
  $('#auth-error').classList.add('hidden');
  $(storage ? '#auth-storage-type' : '#auth-username').focus();
}
$('#auth-back').onclick = () => authStep('storage');
function showAuth(configured) {
  state.contentRequest = null;
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
  $('#auth-setup-key-row').classList.toggle('hidden', !state.cloud || configured);
  $('#auth-setup-key').disabled = !state.cloud || configured;
  $('#auth-setup-key').required = Boolean(state.cloud && !configured);
  $('#auth-username').pattern = configured ? '.*' : '[\\p{L}\\p{N}_\\-]{3,32}';
  $('#auth-username').title = t("3–32 位字母、数字、下划线或连字符");
  $('#auth-password').minLength = configured ? 1 : 12;
  $('#auth-password').placeholder = configured ? '' : t("至少 12 个字符");
  $('#auth-password').autocomplete = configured ? 'current-password' : 'new-password';
  $('#auth-form').dataset.mode = configured ? 'login' : 'setup';
  authStep(configured || state.cloud ? 'account' : 'storage');
  DisplayPreferences.place();
}
async function loadWorkspace() {
  const status = await api('status');
  state.root = status.root;
  state.site = status.site;
  state.connection = status.connection;
  state.mode = status.mode; state.cloud = status.mode === 'cloud';
  $('#account-storage').classList.toggle('hidden', state.cloud);
  $('#connection').textContent = status.mode === 'cloud' ? t("云端工作台") : status.mode === 'desktop' ? t("桌面工作台") : t("本地工作台");
  if (state.root) await refreshPosts();
  state.view = 'dashboard';
  $('#auth-screen').classList.add('hidden');
  render();
}
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  if ($('#auth-submit').disabled) return;
  const mode = $('#auth-form').dataset.mode;
  if (state.authReady) { await withButton($('#auth-submit'), loadWorkspace, t("正在加载…")); return; }
  const storageStep = mode === 'setup' && $('#auth-form').dataset.step === 'storage';
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (mode === 'setup' && !storageStep && password !== $('#auth-confirm').value) {
    $('#auth-error').textContent = t("两次输入的密码不一致");
    $('#auth-error').classList.remove('hidden');
    return;
  }
  $('#auth-submit').disabled = true;
  $('#auth-back').disabled = true;
  $('#auth-error').classList.add('hidden');
  const label = $('#auth-submit').textContent;
  $('#auth-submit').textContent = storageStep ? t("正在验证…") : mode === 'setup' ? t("正在创建…") : t("正在登录…");
  try {
    if (storageStep) {
      const storage = storageValue('auth');
      $('#auth-storage-row').disabled = true;
      await api('auth/storage/test', { method: 'POST', data: { storage } });
      authStep('account');
      return;
    }
    const result = await api(`auth/${mode}`, { method: 'POST', data: { username, password, ...(mode === 'setup' ? state.cloud ? { setupKey: $('#auth-setup-key').value } : { storage: storageValue('auth') } : {}) } });
    state.csrf = result.csrf;
    state.authReady = true;
    $('#auth-form').noValidate = true;
    $('#auth-password').value = '';
    $('#auth-confirm').value = '';
    $('#auth-setup-key').value = '';
    storageFields($('#auth-storage-type').value, 'auth');
    await loadWorkspace();
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').classList.remove('hidden');
  } finally {
    $('#auth-submit').disabled = false;
    $('#auth-back').disabled = false;
    $('#auth-storage-row').disabled = $('#auth-form').dataset.step !== 'storage';
    if (state.authReady) { $('#auth-submit').textContent = t("继续进入工作台"); $('#auth-back').disabled = true; $('#auth-account-fields').disabled = true; }
    else if (!storageStep || $('#auth-form').dataset.step === 'storage') $('#auth-submit').textContent = label;
  }
};
$('#logout').onclick = async () => {
  if (state.busy || state.gitBusy) return toast(t("当前操作完成后再退出"));
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
  modal(`<h2 id="modal-title">${t("修改管理员密码")}</h2><p>${t("修改后所有设备都需要重新登录。")}</p><form id="password-form" class="password-form"><label>${t("当前密码")}<input id="old-password" type="password" autocomplete="current-password" required></label><label>${t("新密码")}<input id="new-password" type="password" autocomplete="new-password" minlength="12" required></label><label>${t("确认新密码")}<input id="confirm-password" type="password" autocomplete="new-password" required></label><div class="actions"><button type="button" class="secondary" id="cancel-password">${t("取消")}</button><button type="submit" class="primary">${t("保存并退出")}</button></div></form>`);
  $('#cancel-password').onclick = closeModal;
  $('#password-form').onsubmit = async event => {
    event.preventDefault();
    if (state.modalBusy) return;
    if ($('#new-password').value !== $('#confirm-password').value) return toast(t("两次输入的新密码不一致"));
    if (!canLeaveEditor() || !canLeaveConfig()) return;
    const data = { oldPassword: $('#old-password').value, newPassword: $('#new-password').value };
    const outcome = await modalAction($('#password-form button[type="submit"]'), () => api('auth/password', { method: 'POST', data }), t("正在保存…"));
    if (!outcome.ok) return;
    closeModal();
    state.csrf = null; state.current = null; state.config = null; state.configDirty = false;
    $('#view').replaceChildren(); showAuth(true);
    toast(t("密码已更新，请重新登录"));
  };
};
$('#account-storage').onclick = async () => {
  if (modal(`<h2 id="modal-title">${t("账号存储")}</h2><p>${t("正在读取账号存储…")}</p>`) === false) return;
  const version = state.dialogVersion;
  let current;
  try { current = (await api('auth/storage')).storage; }
  catch (error) { if (version === state.dialogVersion) { closeModal(); toast(error.message, 'error'); } return; }
  if (version !== state.dialogVersion) return;
  modal(`<h2 id="modal-title">${t("账号存储")}</h2><p id="current-storage"></p><form id="storage-form"><label>${t("目标存储")}<select id="move-storage-type"><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="mongodb">MongoDB</option></select></label><div id="move-storage-fields"></div><label>${t("当前管理员密码")}<input id="move-password" type="password" autocomplete="current-password" required></label><p>${t("切换后需要重新登录。原数据库中的账号记录会保留，便于手动回退。")}</p><div class="actions"><button id="move-test" type="button" class="secondary">${t("测试连接")}</button><button id="move-submit" type="submit" class="primary">${t("迁移并退出")}</button></div></form>`);
  $('#current-storage').textContent = t`当前：${current.type} · ${current.label}`;
  $('#move-storage-type').value = ['postgres', 'mysql', 'mongodb'].includes(current.type) ? current.type : 'postgres';
  storageFields($('#move-storage-type').value, 'move');
  $('#move-storage-type').onchange = () => storageFields($('#move-storage-type').value, 'move');
  $('#move-test').onclick = async () => {
    const storage = storageValue('move');
    const outcome = await modalAction($('#move-test'), () => api('auth/storage/test', { method: 'POST', data: { storage } }), t("正在验证…"));
    if (outcome.ok) toast(t("存储连接成功"));
  };
  $('#storage-form').onsubmit = async event => {
    event.preventDefault();
    if (state.modalBusy || !canLeaveEditor() || !canLeaveConfig()) return;
    const data = { password: $('#move-password').value, storage: storageValue('move') };
    const outcome = await modalAction($('#move-submit'), () => api('auth/storage/migrate', { method: 'POST', data }), t("正在迁移…"));
    if (!outcome.ok) return;
    closeModal(); state.csrf = null; $('#view').replaceChildren(); showAuth(true); toast(t("账号已迁移，请重新登录"));
  };
};
$('#top-new').onclick = () => showNewPost((state.view === 'pages' || (state.view === 'editor' && state.current?.kind === 'page')) ? 'page' : 'post');
$('#modal-close').onclick = closeModal;
$('#modal').onclick = event => { if (event.target === $('#modal')) closeModal(); };
document.addEventListener('keydown', event => {
  const modalOpen = !$('#modal').classList.contains('hidden');
  if (event.key === 'Escape' && modalOpen) closeModal();
  if (event.key === 'Tab' && modalOpen) {
    if (state.modalBusy) { event.preventDefault(); $('#modal-feedback').focus(); return; }
    const focusable = [...$('#modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !modalOpen) {
    if (state.view === 'editor' || state.view === 'config') { event.preventDefault(); state.view === 'editor' ? savePost() : saveConfig(); }
  }
});

document.addEventListener('hexostudio:before-language', event => {
  if (state.busy || state.gitBusy || state.saving || state.configSaving || state.uploading || state.connecting || $('#auth-submit').disabled || !$('#modal').classList.contains('hidden')) {
    event.preventDefault(); toast(t('当前操作完成后再切换语言'));
  }
});
document.addEventListener('hexostudio:language', () => {
  const active = document.activeElement?.id;
  const editorSelection = state.editorSelection;
  const stagedSelection = new Set([...document.querySelectorAll('[data-git-path]:checked')].map(el => el.dataset.gitPath));
  const preview = $('#preview') && !$('#preview').classList.contains('hidden');
  const library = $('#media-library') && !$('#media-library').classList.contains('hidden');
  const remote = $('#remote-fields') && !$('#remote-fields').classList.contains('hidden');
  const fields = [...document.querySelectorAll('#view input[id], #view textarea[id], #setup-blog-screen input[id], #setup-blog-screen select[id]')]
    .filter(el => el.type !== 'file').map(el => ({ id: el.id, value: el.value, start: el.selectionStart, end: el.selectionEnd, scroll: el.scrollTop }));
  const details = [...document.querySelectorAll('#setup-blog-screen details')].map(el => el.open);
  if (!$('#auth-screen').classList.contains('hidden')) {
    const error = $('#auth-error').textContent;
    const errorVisible = !$('#auth-error').classList.contains('hidden');
    authStep($('#auth-form').dataset.step);
    if (state.authReady) { $('#auth-submit').textContent = t('继续进入工作台'); $('#auth-back').disabled = true; $('#auth-account-fields').disabled = true; }
    $('#auth-username').title = t('3–32 位字母、数字、下划线或连字符');
    if ($('#auth-form').dataset.mode === 'setup') $('#auth-password').placeholder = t('至少 12 个字符');
    if (errorVisible) { $('#auth-error').textContent = t(error); $('#auth-error').classList.remove('hidden'); }
  } else {
    render();
    $('#connection').textContent = state.cloud ? t('云端工作台') : state.mode === 'desktop' ? t('桌面工作台') : t('本地工作台');
    if (remote) document.querySelector('[data-connect-mode="remote"]')?.click();
    for (const field of fields) {
      const el = document.getElementById(field.id);
      if (!el) continue;
      el.value = field.value;
      if (field.start !== null) el.setSelectionRange?.(field.start, field.end);
      el.scrollTop = field.scroll;
    }
    document.querySelectorAll('#setup-blog-screen details').forEach((el, i) => { el.open = details[i] || false; });
    if (preview) document.querySelector('[data-editor-tab="preview"]')?.click();
    if (library) toggleMediaLibrary();
    state.editorSelection = editorSelection;
    document.querySelectorAll('[data-git-path]').forEach(el => { el.checked = stagedSelection.has(el.dataset.gitPath); });
  }
  // Re-apply static labels only. Blog content, editor values and logs are never translated.
  HexoI18n.translateDocument();
  document.getElementById(active)?.focus({ preventScroll: true });
});

window.addEventListener('beforeunload', event => { if (state.editorDirty || state.configDirty || state.saving || state.configSaving || state.modalBusy || state.busy || state.gitBusy || state.uploading || state.connecting) { if (state.editorDirty) saveDraft(); event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try {
    const status = await api('auth/status');
    state.cloud = Boolean(status.cloud);
    if (!status.authenticated) return showAuth(status.configured);
    state.csrf = status.csrf;
    await loadWorkspace();
  } catch (error) { showAuth(true); toast(error.message); }
})();
