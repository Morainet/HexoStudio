/* Resolving a conflict changes only the editor; the next save still checks the file version. */
const SaveConflicts = (() => {
  async function open(options) {
    const { label, current, read, prepare, apply } = options;
    if (!current() || !modal(`<h2 id="modal-title">${t('文件已更新')}</h2><p>${t('正在读取最新版本，当前编辑仍然保留。')}</p>`)) return;
    let version = state.dialogVersion;
    const alive = () => version === state.dialogVersion && current();
    let mine, latest, accepted = false;
    try {
      [mine, latest] = await Promise.all([options.mine(), read()]);
      if (!alive()) return;
      if (typeof mine !== 'string' || typeof latest?.content !== 'string' || !latest.modified) throw new Error(t('最新版本返回无效，请稍后重试'));
    } catch (error) {
      if (!alive()) return;
      modal(`<h2 id="modal-title">${t('暂时无法对比版本')}</h2><p id="conflict-load-error"></p><p>${t('当前编辑未丢失，请返回编辑器后重试保存。')}</p><div class="actions"><button id="conflict-load-close" class="secondary">${t('返回编辑器')}</button><button id="conflict-load-retry" class="primary">${t('重新读取')}</button></div>`);
      $('#conflict-load-error').textContent = error.message;
      $('#conflict-load-close').onclick = closeModal;
      $('#conflict-load-retry').onclick = () => { closeModal(); void open(options); };
      return;
    }
    modal(`<div class="save-conflict"><h2 id="modal-title">${t('处理保存冲突')}</h2><p id="conflict-file" class="conflict-file"></p><p>${t('对照最新版本编辑合并结果，应用后仍需保存。')}</p>
      <div class="conflict-grid"><label>${t('最新文件')}<textarea id="conflict-latest" readonly spellcheck="false"></textarea></label><label>${t('合并结果（包含我的修改）')}<textarea id="conflict-merged" spellcheck="false"></textarea></label></div>
      <details><summary>${t('查看打开时的版本')}</summary><pre id="conflict-base"></pre></details>
      <label class="conflict-ack"><input id="conflict-reviewed" type="checkbox">${t('我已核对最新文件，确认采用合并结果')}</label>
      <div id="conflict-discard" class="conflict-discard hidden" role="alert"><p>${t('合并结果尚未应用，是否放弃本次合并？')}</p><div class="actions"><button id="conflict-keep" class="secondary">${t('继续合并')}</button><button id="conflict-discard-confirm" class="secondary">${t('放弃合并并返回')}</button></div></div>
      <div class="actions conflict-actions"><button id="conflict-back" class="secondary">${t('返回编辑器')}</button><button id="conflict-refresh" class="secondary">${t('更新对比版本')}</button><button id="conflict-apply" class="primary" disabled>${t('应用到编辑器')}</button></div></div>`);
    version = state.dialogVersion;
    $('#conflict-file').textContent = label;
    $('#conflict-latest').value = latest.content;
    $('#conflict-merged').value = mine;
    $('#conflict-base').textContent = options.base;
    const mergedEditor = $('#conflict-merged'), reviewed = $('#conflict-reviewed'), button = $('#conflict-apply');
    const update = () => { button.disabled = !reviewed.checked; };
    reviewed.onchange = update;
    mergedEditor.oninput = () => { reviewed.checked = false; update(); };
    modal.beforeClose = () => {
      if (accepted || mergedEditor.value === mine) return true;
      $('#conflict-discard').classList.remove('hidden'); $('#conflict-keep').focus(); return false;
    };
    $('#conflict-keep').onclick = () => { $('#conflict-discard').classList.add('hidden'); mergedEditor.focus(); };
    $('#conflict-discard-confirm').onclick = () => { accepted = true; closeModal(); };
    $('#conflict-back').onclick = closeModal;
    $('#conflict-refresh').onclick = async () => {
      if (!alive()) return toast(t('编辑内容已变化，请重新打开冲突对比'), 'error');
      const outcome = await modalAction($('#conflict-refresh'), read, t('正在读取最新版本…'));
      if (!outcome.ok || !alive()) return;
      if (typeof outcome.value?.content !== 'string' || !outcome.value.modified) return toast(t('最新版本返回无效，请稍后重试'), 'error');
      latest = outcome.value; $('#conflict-latest').value = latest.content;
      reviewed.checked = false; update();
    };
    button.onclick = async () => {
      if (!reviewed.checked || !alive()) return toast(t('编辑内容已变化，请重新打开冲突对比'), 'error');
      const content = mergedEditor.value;
      const outcome = await modalAction(button, () => prepare(content), t('正在应用合并结果…'));
      if (!outcome.ok || !alive()) return;
      if (typeof outcome.value?.content !== 'string') return toast(t('合并结果无效，请稍后重试'), 'error');
      accepted = true; closeModal(); apply(latest, outcome.value);
      toast(t('合并结果已应用，请检查后保存'));
    };
  }
  return { open };
})();
if (typeof module !== 'undefined') module.exports = SaveConflicts;
