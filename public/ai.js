/* AI output remains a reviewable draft until the writer explicitly applies it. */
const AIWriter = (() => {
  const writeIcon = () => icon('sparkles');
  function available() {
    return !(state.modalBusy || state.saving || state.configSaving || state.uploading || state.gitBusy || state.connecting);
  }
  async function settings() {
    if (!available()) return toast(t('请等待当前操作完成'), 'error');
    if (!modal(`<h2 id="modal-title">${t('AI 设置')}</h2><p>${t('正在读取 AI 设置…')}</p>`)) return;
    const version = state.dialogVersion;
    let config;
    try { config = await api('ai/settings'); }
    catch(error) { if (state.dialogVersion === version) { closeModal(); toast(error.message,'error'); } return; }
    if (state.dialogVersion !== version) return;
    modal(`<h2 id="modal-title">${t('AI 设置')}</h2><p>${t('连接兼容 OpenAI Chat Completions 的服务。')}</p><form id="ai-settings-form"><label for="ai-base">${t('服务地址')}</label><input id="ai-base" type="url" required maxlength="2048" placeholder="https://api.openai.com/v1"><label for="ai-model">${t('模型名称')}</label><input id="ai-model" required maxlength="150" placeholder="${t('填写服务商提供的模型 ID')}"><label for="ai-key">API Key</label><input id="ai-key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" ${config.hasKey ? '' : 'required'} placeholder="${t(config.hasKey ? '已保存，留空保持不变' : '填写服务商 API Key')}"><p class="ai-note">${t('密钥仅保存在服务端，不会回传到浏览器。更换服务地址需要重新填写密钥。')}</p><div class="actions"><button id="ai-disable" class="secondary danger" type="button" ${config.hasKey ? '' : 'disabled'}>${t('移除配置')}</button><button class="primary" id="ai-settings-save" type="submit">${t('保存设置')}</button></div></form>`);
    $('#ai-base').value = config.baseUrl; $('#ai-model').value = config.model;
    const form = $('#ai-settings-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const result = await modalAction($('#ai-settings-save'), () => api('ai/settings',{method:'PUT',data:{revision:config.revision,baseUrl:$('#ai-base').value.trim(),model:$('#ai-model').value.trim(),apiKey:$('#ai-key').value.trim()}}),t('正在保存…'));
      if (!result.ok) return;
      config = result.value; $('#ai-key').value = ''; closeModal(); toast(t('AI 设置已保存'));
    };
    $('#ai-disable').onclick = async () => {
      if (!window.confirm(t('移除 AI 服务配置和密钥？博客内容不受影响。'))) return;
      const result = await modalAction($('#ai-disable'),()=>api('ai/settings',{method:'DELETE',data:{revision:config.revision}}));
      if (result.ok) { closeModal(); toast(t('AI 配置已移除')); }
    };
  }
  function captureEditor() {
    const editor = $('#editor');
    if (state.view !== 'editor' || !state.current || !editor) return null;
    const selected = state.editorSelection || {start:editor.selectionStart,end:editor.selectionEnd};
    // Front matter is managed separately; never replace it with AI prose.
    const front = editor.value.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
    const start = Math.max(front?.[0].length || 0, selected.start), end = Math.max(start, selected.end);
    return {root:state.root,path:state.current.path,kind:state.current.kind,content:editor.value,start,end,text:editor.value.slice(start,end)};
  }
  function unchanged(snapshot) {
    return snapshot && state.root === snapshot.root && state.view === 'editor' && state.current?.path === snapshot.path && state.current?.kind === snapshot.kind && $('#editor')?.value === snapshot.content && available();
  }
  async function open(inEditor = false) {
    if (!available() || !state.root) return toast(t('请等待当前操作完成'), 'error');
    const snapshot = inEditor ? captureEditor() : null;
    if (inEditor && !snapshot) return;
    const root = state.root;
    if (!modal(`<h2 id="modal-title">${t('AI 写作')}</h2><p>${t('正在读取 AI 设置…')}</p>`)) return;
    const version = state.dialogVersion;
    let config;
    try { config = await api('ai/settings'); }
    catch(error) { if (version === state.dialogVersion) { closeModal(); toast(error.message,'error'); } return; }
    if (version !== state.dialogVersion || root !== state.root) return;
    if (!config.hasKey) {
      modal(`<h2 id="modal-title">${t('开启 AI 写作')}</h2><p>${t('先填写服务地址、模型和 API Key，再开始写作。')}</p><div class="actions"><button id="ai-configure" class="primary">${t('配置 AI 服务')}</button></div>`);
      $('#ai-configure').onclick = settings; return;
    }
    modal(`<div class="ai-workspace"><div class="eyebrow">${writeIcon()} AI ASSISTANT</div><h2 id="modal-title">${t('AI 写作')}</h2><p>${t('从想法开始，生成内容后由你决定如何使用。')}</p><form id="ai-write-form">${inEditor ? '' : `<label for="ai-title">${t('文章标题')}</label><input id="ai-title" maxlength="300" required placeholder="${t('这篇文章想写什么？')}">`}<div class="ai-options"><label>${t('写作方式')}<select id="ai-action"><option value="article">${t('生成文章')}</option><option value="outline">${t('生成大纲')}</option>${inEditor ? `<option value="polish" ${snapshot.text ? '' : 'disabled'}>${t('润色选中文字')}</option>` : ''}</select></label><label>${t('输出语言')}<select id="ai-language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label></div><label for="ai-prompt">${t('写作要求')}</label><textarea id="ai-prompt" class="ai-input" maxlength="5500" placeholder="${t('介绍主题、读者、语气和篇幅，也可以提供参考要点。')}"></textarea>${inEditor ? `<div id="ai-source-wrap" class="hidden"><label for="ai-source">${t('将发送的选中文字')}</label><textarea id="ai-source" class="ai-input" readonly></textarea></div>` : ''}<p class="ai-note" id="ai-destination"></p><div class="actions"><button id="ai-generate" class="primary" type="submit">${writeIcon()} ${t('生成内容')}</button></div></form><section id="ai-result" class="ai-result hidden"><div class="panel-title"><h3>${t('生成结果 · Markdown')}</h3><button id="ai-copy" type="button">${t('复制')}</button></div><p id="ai-truncated" class="ai-note hidden" role="status">${t('内容达到输出上限，可能未完成。请检查后使用，或缩短篇幅重新生成。')}</p><textarea id="ai-output" class="ai-output" aria-label="${t('生成结果，可修改')}"></textarea><p class="ai-note">${t('请核对事实与引用。内容不会自动发布。')}</p><div class="actions"><button id="ai-apply" class="primary" type="button">${t(inEditor ? '插入光标处' : '保存为草稿并编辑')}</button></div></section></div>`);
    const dialog = state.dialogVersion;
    const action = $('#ai-action');
    $('#ai-language').value = HexoI18n.language;
    if (inEditor) { $('#ai-source').value = snapshot.text; action.value = snapshot.text ? 'polish' : 'article'; }
    const destination = new URL(config.baseUrl).host;
    let resultAction = null, created = null;
    function updateSource() {
      const polish = action.value === 'polish';
      $('#ai-source-wrap')?.classList.toggle('hidden',!polish);
      $('#ai-destination').textContent = t`点击生成会将写作要求${polish ? t('和选中文字') : ''}发送至 ${destination}，可能产生服务商费用。`;
    }
    action.onchange = updateSource; updateSource();
    $('#ai-write-form').onsubmit = async event => {
      event.preventDefault();
      const title = inEditor ? state.metadataValues.title : $('#ai-title').value.trim();
      const prompt = [title ? `${t('文章标题')}：${title}` : '',$('#ai-prompt').value.trim()].filter(Boolean).join('\n');
      const mode = action.value;
      if (!prompt && mode !== 'polish') return toast(t('请填写写作要求'), 'error');
      const result = await modalAction($('#ai-generate'),()=>api('ai/generate',{method:'POST',data:{action:mode,prompt,text:mode==='polish'?snapshot.text:'',language:$('#ai-language').value,revision:config.revision}}),t('正在生成，最长约 45 秒…'));
      if (!result.ok || state.dialogVersion !== dialog || root !== state.root) return;
      resultAction = mode;
      $('#ai-output').value = result.value.content; $('#ai-result').classList.remove('hidden');
      $('#ai-truncated').classList.toggle('hidden',!result.value.truncated);
      $('#ai-apply').textContent = t(inEditor ? mode === 'polish' ? '替换选中文字' : '插入光标处' : '保存为草稿并编辑');
      $('#ai-output').focus();
    };
    $('#ai-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#ai-output').value); toast(t('已复制')); } catch { toast(t('复制失败，请手动选择并复制'), 'error'); } };
    $('#ai-apply').onclick = async () => {
      const content = $('#ai-output').value;
      if (!content.trim() || state.modalBusy || state.root !== root) return;
      if (inEditor) {
        if (!unchanged(snapshot)) return toast(t('编辑器内容已变化，请复制结果后重新打开 AI 写作'), 'error');
        closeModal();
        state.editorSelection = {start:snapshot.start,end:resultAction==='polish'?snapshot.end:snapshot.start};
        insertAtCursor(content);
        toast(t('AI 内容已插入，请检查后保存')); return;
      }
      const title = $('#ai-title').value.trim();
      if (!title) return toast(t('请填写标题'), 'error');
      const outcome = await modalAction($('#ai-apply'),async()=>{
        created ||= await api('posts',{method:'POST',data:{title,kind:'draft',localDate:localDateTime(),content}});
        try { await refreshPosts(); } catch { toast(t('草稿已保存，列表稍后刷新'), 'error'); }
        return created;
      },t('正在保存…'));
      if (!outcome.ok) return;
      closeModal(); await openPost(outcome.value.path,'draft',true);
      toast(t('AI 草稿已保存，可继续编辑'));
    };
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-ai-write]');
    if (button) open(button.dataset.aiWrite === 'editor');
  });
  document.querySelector('#ai-settings').onclick = settings;
  return {open,settings,captureEditor,unchanged};
})();
