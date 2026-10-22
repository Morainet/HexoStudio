const state = { csrf: null, root: null, site: null, connection: { type: 'local' }, git: null, gitMessage: '', posts: [], drafts: [], pages: [], contentKind: 'post', view: 'dashboard', current: null, config: null, configDirty: false, search: '', filter: 'all', busy: false, saving: false, editorDirty: false, editorBuffer: null, editorBaseModified: null, metadataValues: {}, metadataBase: {}, previewVersion: 0 };
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const endpoint = (name, params = {}) => `/api/${name}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}`;
async function api(name, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(endpoint(name, options.params), {
    method,
    headers: { ...(options.data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  const result = await response.json();
  if (response.status === 401 && !name.startsWith('auth/')) { state.csrf = null; showAuth(true); }
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 3200); }
function modal(content) { $('#modal-content').innerHTML = content; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-content').innerHTML = ''; }
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
  catch { $('#editor-status').textContent = '本机草稿空间不足，请及时保存'; }
}
function canLeaveEditor() { if (state.saving) { toast('文章正在保存，请稍候'); return false; } if (!state.editorDirty) return true; saveDraft(); return window.confirm('文章还有未保存的改动。离开后可从本机草稿恢复，确定离开吗？'); }
function setEditorDirty() {
  state.editorBuffer = $('#editor').value;
  if (document.activeElement === $('#editor')) rememberEditorSelection();
  document.querySelectorAll('[data-meta]').forEach(input => { state.metadataValues[input.dataset.meta] = input.value; });
  state.editorDirty = state.editorBuffer !== state.current.content || Object.keys(metadataEdits()).length > 0;
  $('#save-post').textContent = state.editorDirty ? '保存更改 ●' : `保存${state.current.kind === 'draft' ? '草稿' : state.current.kind === 'page' ? '页面' : '文章'}`;
  $('#editor-status').textContent = state.editorDirty ? '未保存 · 已备份本机草稿' : '所有更改已保存';
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
  $('#top-new').textContent = state.view === 'pages' ? '＋ 新建页面' : '＋ 新建文章';
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  const title = { dashboard: '概览', posts: '文章管理', pages: '页面管理', editor: state.current?.kind === 'draft' ? '编辑草稿' : state.current?.kind === 'page' ? '编辑页面' : '编辑文章', config: '站点配置', git: 'Git 仓库', deploy: '构建与部署' }[state.view];
  $('#breadcrumb').textContent = `工作空间 / ${title}`;
}
function pageHead(kicker, title, subtitle, actions = '') { return `<div class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></div>`; }
function row(post, compact = false) {
  const identity = `data-kind="${post.kind}" data-open="${escapeHTML(post.path)}"`;
  if (compact) return `<div class="post-row"><div class="post-avatar">✎</div><div class="post-summary"><div class="post-title">${escapeHTML(post.title)}</div><div class="post-meta">${escapeHTML(date(post.date || post.modified))} · ${post.words} 字 · ${escapeHTML(post.path)}</div></div><button ${identity}>编辑 ↗</button></div>`;
  return `<div class="article-row"><div><span class="title">${escapeHTML(post.title)}</span><div class="excerpt">${escapeHTML(post.excerpt || post.path)}</div></div><span>${post.tags.length ? post.tags.slice(0, 2).map(tag => `<span class="pill">${escapeHTML(tag)}</span>`).join('') : '<span class="muted">无标签</span>'}</span><span class="muted">${escapeHTML(date(post.date || post.modified))}</span><div class="row-actions"><button ${identity}>编辑</button>${post.kind === 'draft' ? `<button data-publish="${escapeHTML(post.path)}">发布</button>` : ''}<button data-kind="${post.kind}" data-delete="${escapeHTML(post.path)}">删除</button></div></div>`;
}
function dashboard() {
  const count = state.posts.length;
  const recent = state.posts.slice(0, 5);
  $('#view').innerHTML = `${pageHead('GOOD DAY', '欢迎回到创作空间', state.site?.theme ? `正在管理 ${escapeHTML(state.site.title || 'Hexo 博客')} · ${escapeHTML(state.site.theme)} 主题` : '在这里整理你的想法，轻松管理 Hexo 博客。')}
    <section class="hero"><div><div class="eyebrow" style="color:#d8d9ff">YOUR WRITING SPACE</div><h2>下一篇好文章，从这里开始。</h2><p>写作、整理、构建与发布，都在一个清爽的工作台里完成。</p><button id="hero-new">开始写作 ↗</button></div><div class="hero-art">✦</div></section>
    <div class="stats"><div class="stat-card"><span class="stat-icon">▤</span><div><small>文章总数</small><strong>${count}</strong></div></div><div class="stat-card"><span class="stat-icon">◇</span><div><small>页面总数</small><strong>${state.pages.length}</strong></div></div><div class="stat-card"><span class="stat-icon">✎</span><div><small>草稿数量</small><strong>${state.drafts.length}</strong></div></div></div>
    <div class="columns"><section class="panel"><div class="panel-title"><h3>最近的文章</h3><button data-view="posts">查看全部 →</button></div><div class="post-list">${recent.length ? recent.map(post => row(post, true)).join('') : '<div class="empty"><div class="symbol">✎</div>还没有文章，创建第一篇吧。</div>'}</div></section><section class="panel"><div class="panel-title"><h3>快捷操作</h3></div><div class="quick-actions"><button class="quick-action" id="quick-new"><span class="q-icon">＋</span><span><strong>新建草稿</strong><small>先写好再发布</small></span></button><button class="quick-action" data-view="pages"><span class="q-icon">◇</span><span><strong>管理页面</strong><small>编辑关于、友链等独立页面</small></span></button><button class="quick-action" data-view="config"><span class="q-icon">⚙</span><span><strong>编辑站点配置</strong><small>调整 Hexo 与主题设置</small></span></button></div><div class="hint-card">草稿保存在 Hexo 的 source/_drafts，发布时移入 source/_posts。</div></section></div>`;
  $('#hero-new').onclick = () => showNewPost('draft');
  $('#quick-new').onclick = () => showNewPost('draft');
}
function postsPage() {
  const items = state.contentKind === 'draft' ? state.drafts : state.posts;
  const query = state.search.toLowerCase();
  const shown = items.filter(post => (post.title + post.path + post.tags.join(' ')).toLowerCase().includes(query) && (state.filter === 'all' || post.tags.includes(state.filter)));
  const tags = [...new Set(items.flatMap(post => post.tags))].sort();
  $('#view').innerHTML = `${pageHead('CONTENT LIBRARY', '文章管理', `已发布 ${state.posts.length} 篇文章 · ${state.drafts.length} 篇草稿。`, '<button id="new-draft" class="secondary">＋ 新建草稿</button><button id="new-post" class="primary">＋ 新建文章</button>')}
  <div class="content-tabs"><button data-content-kind="post" class="${state.contentKind === 'post' ? 'active' : ''}">已发布文章 <span>${state.posts.length}</span></button><button data-content-kind="draft" class="${state.contentKind === 'draft' ? 'active' : ''}">草稿箱 <span>${state.drafts.length}</span></button></div>
  <div class="toolbar"><label class="search"><span>⌕</span><input id="search" type="search" placeholder="搜索标题、路径或标签" value="${escapeHTML(state.search)}"></label><select id="filter" class="filter"><option value="all">全部标签</option>${tags.map(tag => `<option value="${escapeHTML(tag)}" ${tag === state.filter ? 'selected' : ''}>${escapeHTML(tag)}</option>`).join('')}</select></div>
  <section class="panel table-panel"><div class="table-head"><span>文章</span><span>标签</span><span>日期</span><span>操作</span></div>${shown.length ? shown.map(post => row(post)).join('') : `<div class="empty"><div class="symbol">▤</div>${state.contentKind === 'draft' ? '草稿箱是空的' : '没有找到文章'}</div>`}</section>`;
  $('#new-post').onclick = () => showNewPost('post');
  $('#new-draft').onclick = () => showNewPost('draft');
  document.querySelectorAll('[data-content-kind]').forEach(button => button.onclick = () => { state.contentKind = button.dataset.contentKind; state.filter = 'all'; state.search = ''; postsPage(); });
  $('#search').oninput = event => { state.search = event.target.value; const start = event.target.selectionStart; postsPage(); const input = $('#search'); input.focus(); input.setSelectionRange(start, start); };
  $('#filter').onchange = event => { state.filter = event.target.value; postsPage(); };
}
function pagesPage() {
  const query = state.search.toLowerCase();
  const shown = state.pages.filter(page => `${page.title} ${page.path}`.toLowerCase().includes(query));
  $('#view').innerHTML = `${pageHead('INDEPENDENT PAGES', '页面管理', `共 ${state.pages.length} 个独立页面，位于 Hexo 的 source 目录。`, '<button id="new-page" class="primary">＋ 新建页面</button>')}
    <div class="toolbar"><label class="search"><span>⌕</span><input id="page-search" type="search" placeholder="搜索页面标题或路径" value="${escapeHTML(state.search)}"></label></div>
    <section class="panel table-panel"><div class="table-head page-table"><span>页面</span><span>文件路径</span><span>最近修改</span><span>操作</span></div>${shown.length ? shown.map(page => `<div class="article-row page-table"><div><span class="title">${escapeHTML(page.title)}</span><div class="excerpt">${escapeHTML(page.excerpt || '独立页面')}</div></div><span class="muted page-path">${escapeHTML(page.path)}</span><span class="muted">${escapeHTML(date(page.modified))}</span><div class="row-actions"><button data-kind="page" data-open="${escapeHTML(page.path)}">编辑</button><button data-kind="page" data-delete="${escapeHTML(page.path)}">删除</button></div></div>`).join('') : '<div class="empty"><div class="symbol">◇</div>还没有找到页面</div>'}</section>`;
  $('#new-page').onclick = () => showNewPost('page');
  $('#page-search').oninput = event => { state.search = event.target.value; const start = event.target.selectionStart; pagesPage(); const input = $('#page-search'); input.focus(); input.setSelectionRange(start, start); };
}
function editorPage() {
  const post = state.current;
  if (!post) return navigate('posts');
  const label = post.kind === 'draft' ? '草稿' : post.kind === 'page' ? '页面' : '文章';
  $('#view').innerHTML = `${pageHead(post.kind === 'draft' ? 'DRAFT EDITOR' : post.kind === 'page' ? 'PAGE EDITOR' : 'EDITOR', escapeHTML(state.metadataValues.title || fullName(post.path)), `${label} · ${escapeHTML(post.path)}`, `<span id="editor-status" class="editor-status">所有更改已保存</span><button id="back-posts" class="secondary">返回列表</button>${post.kind === 'draft' ? '<button id="publish-draft" class="secondary">发布草稿</button>' : ''}<button id="save-post" class="primary">保存${label}</button>`)}
    <div class="editor-layout"><section class="panel editor-panel"><div class="editor-tabs"><button class="active" data-editor-tab="write">Markdown</button><button data-editor-tab="preview">实时预览</button></div><div class="editor-toolbar" aria-label="编辑工具"><button type="button" data-insert="bold" title="加粗">B</button><button type="button" data-insert="italic" title="斜体"><i>I</i></button><button type="button" data-insert="heading" title="二级标题">H₂</button><button type="button" data-insert="link" title="链接">⌁</button><span class="toolbar-separator"></span><button type="button" id="upload-image" title="上传图片到博客">▧ 上传图片</button><button type="button" id="media-toggle" title="选择已上传的图片">图片库</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden><small>可粘贴或拖入图片</small></div><div id="media-library" class="media-library hidden"><div class="media-head"><strong>已上传图片</strong><span>点击图片插入${label}</span></div><div id="media-list" class="media-grid">加载中…</div></div><textarea id="editor" class="editor-textarea" spellcheck="false" aria-label="Markdown ${label}内容"></textarea><div id="preview" class="preview hidden">正在生成预览…</div></section>
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
  $('#editor-status').textContent = state.editorDirty ? '未保存 · 已备份本机草稿' : '所有更改已保存';
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
  finally { state.uploading = false; button.disabled = false; $('#editor-status').textContent = state.editorDirty ? '未保存 · 已备份本机草稿' : '所有更改已保存'; }
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
  $('#config-editor').value = config.content;
  $('#config-editor').oninput = () => { state.configDirty = $('#config-editor').value !== state.config.content; $('#save-config').textContent = state.configDirty ? '保存配置 ●' : '保存配置'; };
  $('#save-config').textContent = state.configDirty ? '保存配置 ●' : '保存配置';
  $('#save-config').onclick = saveConfig;
}
function deployPage() {
  $('#view').innerHTML = `${pageHead('PUBLISH WORKFLOW', '构建与部署', '运行当前 Hexo 项目中已安装的本地命令。')}
    <div class="command-grid"><button class="command-card" data-command="clean"><span class="command-icon">⌁</span><strong>清理缓存</strong><small>hexo clean · 清理生成文件与缓存</small></button><button class="command-card" data-command="generate"><span class="command-icon">◇</span><strong>生成静态站点</strong><small>hexo generate · 输出到 public 目录</small></button><button class="command-card" data-command="deploy"><span class="command-icon">↗</span><strong>部署博客</strong><small>hexo deploy · 使用项目当前部署配置</small></button></div>
    <section class="panel"><div class="panel-title"><h3>运行日志</h3><button id="clear-log">清空日志</button></div><div id="terminal" class="terminal">准备就绪。选择上方操作以运行 Hexo 命令。</div></section>`;
  document.querySelectorAll('[data-command]').forEach(button => button.onclick = () => runCommand(button.dataset.command));
  $('#clear-log').onclick = () => $('#terminal').textContent = '日志已清空。';
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
async function loadGit() { try { state.git = await api('git/status'); if (state.view === 'git') render(); } catch (error) { toast(error.message); } }
async function gitStage() {
  const paths = [...document.querySelectorAll('[data-git-path]:checked')].map(input => input.dataset.gitPath);
  if (!paths.length) return toast('请先选择文件');
  try { state.git = await api('git/stage', { method: 'POST', data: { paths } }); render(); toast('所选文件已暂存'); } catch (error) { toast(error.message); }
}
async function gitUnstage(path) {
  try { state.git = await api('git/unstage', { method: 'POST', data: { path } }); render(); toast('已取消暂存，文件修改仍保留'); }
  catch (error) { toast(error.message); }
}
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
  try { state.git = await api('git/commit', { method: 'POST', data: { message } }); state.gitMessage = ''; render(); toast('提交已创建，可以推送到远端'); } catch (error) { toast(error.message); }
}
async function gitSync(action) {
  if (state.busy) return;
  state.busy = true;
  for (const button of ['#git-fetch', '#git-pull', '#git-push']) if ($(button)) $(button).disabled = true;
  try {
    state.git = await api(`git/${action}`, { method: 'POST' });
    if (action === 'pull') { state.config = null; await refreshPosts(); }
    render(); toast({ fetch: '远端状态已更新', pull: '已拉取远端更新', push: '提交已推送到远端' }[action]);
  } catch (error) { toast(error.message); }
  finally { state.busy = false; for (const button of ['#git-fetch', '#git-pull', '#git-push']) if ($(button) && state.git?.remote) $(button).disabled = false; }
}
function render() { updateShell(); if (!state.root) return onboarding(); ({ dashboard, posts: postsPage, pages: pagesPage, editor: editorPage, config: configPage, git: gitPage, deploy: deployPage })[state.view](); }
function connectionForm() {
  return `<div class="connection-tabs"><button type="button" data-connect-mode="local" class="active">本机目录</button><button type="button" data-connect-mode="remote">GitHub / GitLab</button></div>
    <div id="local-fields" class="connection-fields"><p>输入包含 <code>_config.yml</code> 与 <code>source/_posts</code> 的项目目录。</p><label for="root-input">Hexo 项目目录</label><input id="root-input" placeholder="/Users/name/blog 或 C:\\Users\\name\\blog"><div class="connect-actions"><button id="connect-project" class="primary">连接本机项目</button><button id="browse-project" class="secondary hidden">浏览目录…</button></div></div>
    <div id="remote-fields" class="connection-fields hidden"><p>用 HTTPS 仓库地址和 Token 连接，项目会克隆到本机工作目录。</p><div class="connection-grid"><div><label for="remote-provider">服务商</label><select id="remote-provider"><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></div><div><label for="remote-repo">仓库</label><input id="remote-repo" placeholder="username/repo 或 HTTPS 地址" autocomplete="off"></div><div><label for="remote-token">访问 Token</label><input id="remote-token" type="password" placeholder="有仓库读写权限的 Token" autocomplete="off"></div><div><label for="remote-branch">项目分支</label><input id="remote-branch" placeholder="留空使用默认分支" autocomplete="off"></div><div class="full"><label for="remote-path">博客路径</label><input id="remote-path" placeholder="留空为仓库根目录；例如 blog" autocomplete="off"></div></div><button id="connect-remote" class="primary">连接远端仓库</button><p class="secret-note">Token 保存在本机设置文件中，不写入 Git 远端地址。</p></div>`;
}
function bindConnectionForm() {
  document.querySelectorAll('[data-connect-mode]').forEach(button => button.onclick = () => {
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
  $('#view').innerHTML = `${pageHead('WELCOME TO HEXOSTUDIO', '连接你的 Hexo 博客', '连接本机目录，或用 Token 接入 GitHub / GitLab 仓库。')}<section class="panel connection-panel"><div class="eyebrow">STEP 01 / CONNECT</div><h2>博客源码在哪里？</h2>${connectionForm()}</section>`;
  bindConnectionForm();
}
async function connectProject() {
  const path = $('#root-input')?.value.trim();
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  try { const result = await api('project', { method: 'POST', data: { path } }); state.root = result.root; state.site = result.site; state.connection = { type: 'local' }; state.git = null; state.config = null; state.configDirty = false; state.current = null; state.contentKind = 'post'; state.search = ''; state.filter = 'all'; await refreshPosts(); closeModal(); navigate('dashboard'); toast('项目已连接'); }
  catch (error) { toast(error.message); }
}
async function connectRemote() {
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  const button = $('#connect-remote'); button.disabled = true; button.textContent = '正在连接…';
  try {
    const data = { provider: $('#remote-provider').value, repository: $('#remote-repo').value.trim(), token: $('#remote-token').value.trim(), branch: $('#remote-branch').value.trim(), blogPath: $('#remote-path').value.trim() };
    const result = await api('remote/connect', { method: 'POST', data });
    state.root = result.root; state.site = result.site; state.connection = result.connection; state.git = null; state.config = null; state.configDirty = false; state.current = null; state.contentKind = 'post'; state.search = ''; state.filter = 'all';
    await refreshPosts(); closeModal(); navigate('dashboard'); toast('远端仓库已连接');
  } catch (error) { toast(error.message); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = '连接远端仓库'; } }
}
function showProjectModal() { modal(`<h2 id="modal-title">切换 Hexo 项目</h2>${connectionForm()}<div class="actions"><button class="secondary" id="cancel-modal">取消</button></div>`); bindConnectionForm(); $('#cancel-modal').onclick = closeModal; }
async function chooseDirectory() { const selected = await window.hexoStudio?.selectDirectory(); if (selected) $('#root-input').value = selected; }
function localDateTime() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`; }
function showNewPost(kind = 'post') { if (!state.root || (state.view === 'editor' && !canLeaveEditor()) || (state.view === 'config' && !canLeaveConfig())) return; state.newKind = ['post', 'draft', 'page'].includes(kind) ? kind : 'post'; const label = state.newKind === 'draft' ? '草稿' : state.newKind === 'page' ? '页面' : '文章'; const folder = state.newKind === 'draft' ? 'source/_drafts' : state.newKind === 'page' ? 'source/页面路径/index.md' : 'source/_posts'; modal(`<h2 id="modal-title">新建${label}</h2><p>给${label}取个名字，HexoStudio 会在 ${folder} 中创建 Markdown 文件。</p><label for="new-title">${label}标题</label><input id="new-title" placeholder="写下${label}标题"><div class="actions"><button class="secondary" id="cancel-modal">取消</button><button class="primary" id="create-post">创建并编辑</button></div>`); $('#new-title').focus(); $('#cancel-modal').onclick = closeModal; $('#create-post').onclick = createPost; $('#new-title').onkeydown = event => { if (event.key === 'Enter') createPost(); }; }
async function createPost() { try { const kind = state.newKind; const post = await api('posts', { method: 'POST', data: { title: $('#new-title').value, localDate: localDateTime(), kind } }); closeModal(); await refreshPosts(); await openPost(post.path, kind, true); toast(kind === 'draft' ? '草稿已创建' : kind === 'page' ? '页面已创建' : '文章已创建'); } catch (error) { toast(error.message); } }
async function refreshPosts() { const [posts, drafts, pages] = await Promise.all([api('posts'), api('posts', { params: { kind: 'draft' } }), api('posts', { params: { kind: 'page' } })]); state.posts = posts.posts; state.drafts = drafts.posts; state.pages = pages.posts; }
async function openPost(path, kind = 'post', skipGuard = false) {
  if (!skipGuard && state.view === 'editor' && !canLeaveEditor()) return;
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
    navigate('editor');
    const draft = readDraft(path, kind);
    if (draft?.content && (draft.content !== post.content || (draft.metadataValues && JSON.stringify(draft.metadataValues) !== JSON.stringify(state.metadataBase)))) {
      const stale = draft.modified !== post.modified;
      modal(`<h2 id="modal-title">发现未保存草稿</h2><p>这篇文章在本机留有未保存内容。${stale ? '磁盘文件后来发生了变化；恢复后保存时会先提示冲突。' : '可以继续编辑草稿，或使用磁盘上的版本。'}</p><div class="actions"><button class="secondary" id="discard-draft">使用磁盘版本</button><button class="primary" id="restore-draft">恢复草稿</button></div>`);
      $('#discard-draft').onclick = () => { clearDraft(path, kind); closeModal(); };
      $('#restore-draft').onclick = () => { state.editorBuffer = draft.content; state.editorBaseModified = draft.modified; state.metadataValues = { ...state.metadataBase, ...(draft.metadataValues || {}) }; state.editorDirty = true; editorPage(); closeModal(); };
    }
  } catch (error) { toast(error.message); }
}
async function savePost() {
  if (!state.current || state.saving) return false;
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
  } catch (error) { toast(error.message); return false; }
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
      await refreshPosts();
      closeModal();
      state.current = null;
      state.editorDirty = false;
      state.contentKind = 'post';
      state.view = 'posts';
      render();
      toast(`草稿已发布：${result.path}`);
    } catch (error) { toast(error.message); $('#confirm-publish').disabled = false; }
  };
}
function confirmDelete(path, kind = 'post') { const label = kind === 'draft' ? '草稿' : kind === 'page' ? '页面' : '文章'; modal(`<h2 id="modal-title">删除${label}？</h2><p>这会从 Hexo 源码目录删除 <strong>${escapeHTML(path)}</strong>。此操作无法在后台撤销。</p><div class="actions"><button class="secondary" id="cancel-modal">取消</button><button class="secondary danger" id="confirm-delete">删除${label}</button></div>`); $('#cancel-modal').onclick = closeModal; $('#confirm-delete').onclick = async () => { try { await api('post', { method: 'DELETE', params: { path, kind } }); clearDraft(path, kind); closeModal(); await refreshPosts(); render(); toast(`${label}已删除`); } catch (error) { toast(error.message); } }; }
function canLeaveConfig() { return !state.configDirty || window.confirm('配置还有未保存的改动，确定放弃吗？'); }
async function loadConfig(scope = 'site') {
  if (state.view === 'config' && !canLeaveConfig()) return false;
  try { state.config = await api('config', { params: { scope } }); state.configDirty = false; state.view = 'config'; render(); return true; }
  catch (error) { toast(error.message); return false; }
}
async function saveConfig() {
  const button = $('#save-config');
  button.disabled = true;
  try {
    const content = $('#config-editor').value;
    const result = await api('config', { method: 'PUT', data: { scope: state.config.scope, content, modified: state.config.modified } });
    state.config.content = content;
    state.config.modified = result.modified;
    state.configDirty = false;
    button.textContent = '保存配置';
    toast('配置已保存');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function runCommand(action) {
  if (state.busy) return toast('已有命令正在运行');
  if (action === 'deploy' && !window.confirm('将按当前 Hexo 配置部署博客，确定继续？')) return;
  state.busy = true;
  const terminal = $('#terminal'); terminal.textContent = `$ hexo ${action}\n`;
  document.querySelectorAll('[data-command]').forEach(button => button.disabled = true);
  try {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' }, body: JSON.stringify({ action }) });
    if (!response.ok) { const result = await response.json(); if (response.status === 401) { state.csrf = null; showAuth(true); } throw new Error(result.error || '命令运行失败'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    while (true) { const { value, done } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) { if (!line) continue; const item = JSON.parse(line); terminal.textContent += item.type === 'exit' ? `\n进程结束，退出码 ${item.code}\n` : item.text; terminal.scrollTop = terminal.scrollHeight; } }
  } catch (error) { terminal.textContent += `\n错误：${error.message}`; }
  finally { state.busy = false; document.querySelectorAll('[data-command]').forEach(button => button.disabled = false); }
}
async function navigate(view) { if (state.view === 'editor' && view !== 'editor') { if (!canLeaveEditor()) return; state.editorDirty = false; } if (state.view === 'config' && view !== 'config' && !canLeaveConfig()) return; state.view = view; if (view === 'config' && !state.config) return loadConfig(); if (view === 'git') { render(); return loadGit(); } render(); }
document.addEventListener('click', event => { const view = event.target.closest('[data-view]'); if (view) navigate(view.dataset.view); const open = event.target.closest('[data-open]'); if (open) openPost(open.dataset.open, open.dataset.kind || 'post'); const deletion = event.target.closest('[data-delete]'); if (deletion) confirmDelete(deletion.dataset.delete, deletion.dataset.kind || 'post'); const publish = event.target.closest('[data-publish]'); if (publish) requestPublish(publish.dataset.publish); });
$('#change-project').onclick = showProjectModal;
function showAuth(configured) {
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#auth-form').reset();
  $('#auth-error').classList.add('hidden');
  $('#auth-title').textContent = configured ? '登录工作台' : '创建管理员账号';
  $('#auth-description').textContent = configured ? '使用管理员账号继续管理博客。' : '首次使用请在本机设置账号，之后每次进入都需要登录。';
  $('#auth-confirm-row').classList.toggle('hidden', configured);
  $('#auth-confirm').required = !configured;
  $('#auth-password').autocomplete = configured ? 'current-password' : 'new-password';
  $('#auth-submit').textContent = configured ? '登录' : '创建账号并进入';
  $('#auth-form').dataset.mode = configured ? 'login' : 'setup';
  $('#auth-username').focus();
}
async function loadWorkspace() {
  const status = await api('status');
  state.root = status.root;
  state.site = status.site;
  state.connection = status.connection;
  $('#connection').textContent = status.mode === 'desktop' ? '桌面工作台' : '本地工作台';
  if (state.root) await refreshPosts();
  state.view = 'dashboard';
  render();
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
}
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const mode = $('#auth-form').dataset.mode;
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  if (mode === 'setup' && password !== $('#auth-confirm').value) {
    $('#auth-error').textContent = '两次输入的密码不一致';
    $('#auth-error').classList.remove('hidden');
    return;
  }
  $('#auth-submit').disabled = true;
  try {
    const result = await api(`auth/${mode}`, { method: 'POST', data: { username, password } });
    state.csrf = result.csrf;
    await loadWorkspace();
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').classList.remove('hidden');
  } finally { $('#auth-submit').disabled = false; }
};
$('#logout').onclick = async () => {
  if (!canLeaveEditor() || !canLeaveConfig()) return;
  try { await api('auth/logout', { method: 'POST' }); }
  catch (error) { return toast(error.message); }
  state.csrf = null;
  state.root = null;
  state.posts = [];
  state.drafts = [];
  state.pages = [];
  state.current = null;
  state.config = null;
  state.configDirty = false;
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
    } catch (error) { toast(error.message); submit.disabled = false; }
  };
};
$('#top-new').onclick = () => showNewPost(state.view === 'pages' ? 'page' : 'post');
$('#modal-close').onclick = closeModal;
$('#modal').onclick = event => { if (event.target === $('#modal')) closeModal(); };
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.view === 'editor') { event.preventDefault(); savePost(); } });
window.addEventListener('beforeunload', event => { if (state.editorDirty || state.configDirty) { if (state.editorDirty) saveDraft(); event.preventDefault(); event.returnValue = ''; } });
(async () => {
  try {
    const status = await api('auth/status');
    if (!status.authenticated) return showAuth(status.configured);
    state.csrf = status.csrf;
    await loadWorkspace();
  } catch (error) { showAuth(true); toast(error.message); }
})();
