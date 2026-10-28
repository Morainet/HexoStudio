/* Credentials remain server-side; empty proxy input preserves a saved endpoint. */
(() => {
  const button = document.querySelector('#network-settings');
  button.onclick = async () => {
    if (state.saving || state.configSaving || state.gitBusy || state.connecting || state.modalBusy) return toast(t('请等待当前操作完成'), 'error');
    if (!modal(`<h2 id="modal-title">${t('网络设置')}</h2><p>${t('正在读取网络设置…')}</p>`)) return;
    const version = state.dialogVersion;
    let config;
    try { config = await api('network/settings'); }
    catch (error) { if (state.dialogVersion === version) { closeModal(); toast(error.message, 'error'); } return; }
    if (state.dialogVersion !== version) return;
    modal(`<h2 id="modal-title">${t('网络设置')}</h2><p>${t('统一用于仓库、AI、更新、Git 和数据库连接。数据库单独填写的代理优先。')}</p>
      <form id="network-form"><label>${t('网络模式')}<select id="network-mode"><option value="inherit">${t('保持现有配置')}</option><option value="direct">${t('直连')}</option><option value="socks5">${t('手动 SOCKS5')}</option></select></label>
      <div id="network-proxy-fields"><label>${t('SOCKS5 代理地址')}<input id="network-proxy" autocomplete="off" spellcheck="false" type="password" placeholder="socks5://127.0.0.1:7890"></label><p id="network-endpoint"></p><p>${t('使用代理软件实际的 SOCKS5 或 mixed 端口。已保存时留空保持不变，代理认证信息不会回传。')}</p></div>
      <p>${t('保持现有配置不会自动读取 Windows 系统代理；AI 和 Atlas SRV 查询仍需可用的系统 DNS。')}</p><p id="network-managed" class="hidden">${t('云端或环境变量管理的网络配置，请在部署环境修改 HEXOSTUDIO_PROXY_URL。')}</p>
      <div class="actions"><button class="primary" id="network-save" type="submit">${t('保存设置')}</button></div></form>`);
    const mode = $('#network-mode'), proxy = $('#network-proxy');
    mode.value = config.mode;
    const refresh = () => {
      $('#network-proxy-fields').classList.toggle('hidden', mode.value !== 'socks5');
      proxy.required = mode.value === 'socks5' && !config.hasProxy;
    };
    mode.onchange = refresh; refresh();
    $('#network-endpoint').textContent = config.endpoint || '';
    if (config.managed) {
      mode.disabled = proxy.disabled = $('#network-save').disabled = true;
      $('#network-managed').classList.remove('hidden');
    }
    $('#network-form').onsubmit = async event => {
      event.preventDefault();
      const result = await modalAction($('#network-save'), () => api('network/settings', { method: 'PUT', data: { mode: mode.value, proxyUrl: proxy.value.trim(), revision: config.revision } }), t('正在保存…'));
      if (result.ok) { closeModal(); toast(t('网络设置已保存，新连接立即生效')); }
    };
  };
})();
