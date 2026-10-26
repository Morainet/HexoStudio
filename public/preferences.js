/* Runs before the stylesheet to avoid a light flash on dark-mode startup. */
const DisplayPreferences = (() => {
  const key = 'hexostudio:display';
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch { stored = {}; }
  const preferences = {
    theme: ['light', 'dark', 'system'].includes(stored?.theme) ? stored.theme : 'system',
    language: ['zh-CN', 'en'].includes(stored?.language) ? stored.language : (/^zh\b/i.test(navigator.language) ? 'zh-CN' : 'en')
  };
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const resolved = preferences.theme === 'system' ? (system.matches ? 'dark' : 'light') : preferences.theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#14171c' : '#fafbfc');
  }
  function persist() { try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Preferences still work when storage is unavailable. */ } }
  function applyLanguage() {
    HexoI18n.setLanguage(preferences.language);
    document.documentElement.lang = preferences.language;
  }
  function syncControls() {
    document.querySelector('#theme-preference').value = preferences.theme;
    document.querySelector('#language-preference').value = preferences.language;
    HexoI18n.translateDocument();
  }
  function place() {
    const workspace = !document.querySelector('#app').classList.contains('hidden');
    const destination = document.querySelector(workspace ? '#preferences-workspace' : '#preferences-home');
    const controls = document.querySelector('#display-preferences');
    if (controls.parentElement !== destination) destination.append(controls);
    document.dispatchEvent(new CustomEvent('hexostudio:render'));
  }
  applyTheme(); applyLanguage();
  system.addEventListener('change', () => { if (preferences.theme === 'system') applyTheme(); });
  document.addEventListener('DOMContentLoaded', () => {
    syncControls(); place();
    document.querySelector('#theme-preference').addEventListener('change', event => {
      preferences.theme = event.target.value; applyTheme(); persist();
    });
    document.querySelector('#language-preference').addEventListener('change', event => {
      const change = new CustomEvent('hexostudio:before-language', { cancelable: true });
      if (!document.dispatchEvent(change)) { event.target.value = preferences.language; return; }
      preferences.language = event.target.value; applyLanguage(); persist(); syncControls();
      document.dispatchEvent(new CustomEvent('hexostudio:language'));
    });
  });
  return { place, get language() { return preferences.language; } };
})();
