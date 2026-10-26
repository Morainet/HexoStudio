/* Public display settings only. Credentials never enter this object. */
const BrandUI = (() => {
  let record = { branding: { name: 'HexoStudio', accentLight: '#365fc5', accentDark: '#9dbbff' } };
  const originalIcons = [...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map(node => node.cloneNode(true));
  let favicon;
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  function contrast(color) {
    const rgb = color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    return luminance > .179 ? '#000000' : '#ffffff';
  }
  function apply() {
    const brand = record.branding;
    document.querySelector('title').removeAttribute('data-i18n');
    document.title = `${brand.name} · ${HexoI18n.t('博客工作台')}`;
    document.querySelectorAll('[data-brand-name]').forEach(node => text(node, brand.name));
    document.querySelectorAll('[data-brand-tagline]').forEach(node => text(node, brand.tagline || HexoI18n.t('内容管理工作台')));
    document.querySelectorAll('.auth-brand,.brand-mark').forEach(node => {
      const source = brand.logo || '';
      if (node.dataset.brandLogo === source && node.dataset.brandText === brand.name) return;
      node.dataset.brandLogo = source; node.dataset.brandText = brand.name;
      node.classList.toggle('custom-brand-logo', Boolean(source));
      node.replaceChildren();
      if (source) {
        const img = document.createElement('img'); img.alt = ''; img.src = source; img.referrerPolicy = 'no-referrer';
        img.onerror = () => { node.classList.remove('custom-brand-logo'); text(node, Array.from(brand.name)[0]); };
        node.append(img);
      } else text(node, Array.from(brand.name)[0]);
    });
    const form = document.querySelector('#auth-form');
    if (form.dataset.mode === 'login') {
      text(document.querySelector('#auth-title'), brand.loginTitle || HexoI18n.t('登录工作台'));
      text(document.querySelector('#auth-description'), brand.loginDescription || HexoI18n.t('使用管理员账号继续管理博客。'));
    }
    document.querySelectorAll('[data-brand-footer]').forEach(node => { text(node, brand.footerText || ''); node.classList.toggle('hidden', !brand.footerText); });
    document.querySelectorAll('[data-brand-help]').forEach(node => { node.classList.toggle('hidden', !brand.helpUrl); if (brand.helpUrl) node.href = brand.helpUrl; else node.removeAttribute('href'); });
    const root = document.documentElement;
    const light = brand.accentLight || '#365fc5', dark = brand.accentDark || '#9dbbff';
    root.dataset.oemColors = String(light.toLowerCase() !== '#365fc5' || dark.toLowerCase() !== '#9dbbff');
    root.style.setProperty('--oem-light', light); root.style.setProperty('--oem-dark', dark);
    root.style.setProperty('--oem-light-ink', contrast(light)); root.style.setProperty('--oem-dark-ink', contrast(dark));
    const next = brand.favicon || '';
    if (next !== favicon) {
      document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(node => node.remove());
      if (next) for (const rel of ['icon', 'apple-touch-icon']) { const link = document.createElement('link'); link.rel = rel; link.href = next; document.head.append(link); }
      else originalIcons.forEach(node => document.head.append(node.cloneNode(true)));
      favicon = next;
    }
  }
  async function load() {
    try { const response = await fetch('/api/branding', { cache: 'no-store', signal: AbortSignal.timeout(5000) }); if (response.ok) record = await response.json(); } catch { /* Keep default branding if the server is unavailable. */ }
    apply();
  }
  function preview() {
    const name = document.querySelector('#brand-name').value.trim() || 'HexoStudio';
    text(document.querySelector('#brand-preview-name'), name);
    text(document.querySelector('#brand-preview-tagline'), document.querySelector('#brand-tagline').value || HexoI18n.t('内容管理工作台'));
    const logoInput = document.querySelector('#brand-logo');
    const logo = logoInput.dataset.imageValue || logoInput.value.trim();
    for (const key of ['logo', 'favicon']) { const input = document.querySelector(`#brand-${key}`); document.querySelector(`[data-brand-clear="${key}"]`).classList.toggle('hidden', !input.dataset.imageValue && !input.value); }
    const mark = document.querySelector('#brand-preview-mark'); mark.replaceChildren();
    if (/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(logo)) {
      const img = document.createElement('img'); img.src = logo; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onerror = () => text(mark, Array.from(name)[0]); mark.append(img);
    } else text(mark, Array.from(name)[0]);
  }
  async function open() {
    if (!modal(`<h2 id="modal-title">${t('品牌设置')}</h2><p>${t('正在读取品牌配置…')}</p>`)) return;
    const version = state.dialogVersion;
    let current;
    try { current = await api('branding'); } catch (error) { if (version === state.dialogVersion) { closeModal(); toast(error.message, 'error'); } return; }
    if (version !== state.dialogVersion) return;
    const brand = current.branding;
    const field = (key, label, limit = 200, type = 'text') => `<label>${t(label)}<input id="brand-${key}" name="${key}" type="${type}" maxlength="${limit}" ${key === 'name' ? 'required' : ''}></label>`;
    const imageField = (key, label) => `<label>${t(label)}<span class="brand-image-input"><input id="brand-${key}" name="${key}" placeholder="${t('HTTPS 图片地址或上传图片')}" maxlength="360000"><button type="button" class="icon-button hidden" data-brand-clear="${key}" aria-label="${t('移除图片')}">×</button><button type="button" class="secondary" data-brand-upload="${key}">${t('上传')}</button></span><input type="file" id="brand-file-${key}" accept="image/png,image/jpeg,image/webp" hidden></label>`;
    modal(`<h2 id="modal-title">${t('品牌设置')}</h2><p>${t('为你的工作台设置独立品牌，保存后生效。')}</p><form id="branding-form"><div class="brand-preview"><span id="brand-preview-mark"></span><div><strong id="brand-preview-name"></strong><small id="brand-preview-tagline"></small></div></div><div class="brand-fields">${field('name','产品名称',48)}${field('tagline','产品简介')}</div>${imageField('logo','品牌 Logo')}${imageField('favicon','网站图标')}<p class="brand-tip">${t('支持 PNG、JPEG、WebP，单张不超过 256 KB。')}</p><details class="brand-more"><summary>${t('更多设置 · 登录、颜色与支持')}</summary><div class="brand-fields">${field('loginTitle','登录标题',48)}${field('loginDescription','登录说明')}${field('accentLight','浅色主题色',7,'color')}${field('accentDark','深色主题色',7,'color')}</div>${field('footerText','页脚文字')}${field('helpUrl','帮助链接',2048,'url')}${field('releaseRepository','GitHub 更新仓库')}<p class="brand-tip">${t('更新仓库填写 owner/repo；留空关闭正式版本检查。网页刷新检测不受影响。')}</p></details><div class="actions"><button id="brand-reset" type="button" class="text-button">${t('恢复部署默认')}</button><button id="brand-save" type="submit" class="primary">${t('保存品牌设置')}</button></div></form>`);
    const form = document.querySelector('#branding-form');
    for (const [key, value] of Object.entries(brand)) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    for (const key of ['logo', 'favicon']) {
      const input = document.querySelector(`#brand-${key}`);
      if (input.value.startsWith('data:')) { input.dataset.imageValue = input.value; input.value = ''; input.placeholder = t('已上传图片'); }
      document.querySelector(`[data-brand-clear="${key}"]`).onclick = () => { delete input.dataset.imageValue; input.value = ''; input.placeholder = t('HTTPS 图片地址或上传图片'); preview(); };
    }
    preview(); form.addEventListener('input', event => { if (['logo', 'favicon'].includes(event.target.name)) { delete event.target.dataset.imageValue; event.target.placeholder = t('HTTPS 图片地址或上传图片'); } preview(); });
    for (const key of ['logo', 'favicon']) {
      const file = document.querySelector(`#brand-file-${key}`);
      document.querySelector(`[data-brand-upload="${key}"]`).onclick = () => file.click();
      file.onchange = async () => {
        const selected = file.files[0]; if (!selected) return;
        if (!['image/png','image/jpeg','image/webp'].includes(selected.type) || selected.size > 256 * 1024) { file.value = ''; return toast(t('品牌图片格式无效或超过 256 KB'), 'error'); }
        const outcome = await modalAction(document.querySelector('#brand-save'), () => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(t('图片读取失败'))); reader.readAsDataURL(selected); }), t('正在读取图片…'));
        if (outcome.ok) { const input = document.querySelector(`#brand-${key}`); input.dataset.imageValue = outcome.value; input.value = ''; input.placeholder = t('已上传图片'); preview(); }
        file.value = '';
      };
    }
    const save = async reset => {
      const branding = Object.fromEntries(Object.keys(brand).map(key => [key, form.elements.namedItem(key).dataset.imageValue || form.elements.namedItem(key).value.trim()]));
      const outcome = await modalAction(document.querySelector(reset ? '#brand-reset' : '#brand-save'), () => api('branding', { method: reset ? 'DELETE' : 'PUT', data: { branding, revision: current.revision } }), t('正在保存…'));
      if (!outcome.ok) return;
      record = outcome.value; state.updateInfo = null;
      closeModal(); apply(); toast(t('品牌设置已保存')); void checkForUpdates();
    };
    form.onsubmit = event => { event.preventDefault(); void save(false); };
    document.querySelector('#brand-reset').onclick = () => { if (window.confirm(t('恢复部署时的默认品牌设置？'))) void save(true); };
  }
  document.addEventListener('hexostudio:render', apply);
  document.addEventListener('hexostudio:language', () => queueMicrotask(apply));
  new MutationObserver(apply).observe(document.querySelector('#modal-content'), { childList: true });
  return { load, apply, open };
})();
