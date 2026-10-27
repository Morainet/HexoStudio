/* A single navigation tree serves desktop and the mobile drawer. */
(() => {
  const sidebar = document.querySelector('#workspace-navigation');
  const toggle = document.querySelector('#navigation-toggle');
  const closeButton = document.querySelector('#navigation-close');
  const backdrop = document.querySelector('#navigation-backdrop');
  const main = document.querySelector('.main');
  const viewport = window.matchMedia('(max-width: 700px)');
  let open = false;

  function setOpen(value, restoreFocus = true) {
    open = Boolean(value && viewport.matches);
    main.inert = open;
    // Move focus before hiding/inerting its previous container.
    if (!open && sidebar.contains(document.activeElement) && restoreFocus) toggle.focus();
    sidebar.inert = viewport.matches && !open;
    document.body.classList.toggle('navigation-open', open);
    backdrop.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      closeButton.focus();
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
  }
  toggle.addEventListener('click', () => setOpen(!open));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', event => {
    // Capture before actions open dialogs, so their focus is left intact.
    if (open && event.target.closest('.nav button, .text-button')) setOpen(false);
  }, true);
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href]')].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  viewport.addEventListener('change', () => {
    setOpen(false, viewport.matches);
    if (!viewport.matches && [toggle, closeButton].includes(document.activeElement)) sidebar.querySelector('.nav button.active')?.focus();
  });
  document.addEventListener('hexostudio:render', () => {
    if (document.querySelector('#app').classList.contains('hidden')) setOpen(false, false);
  });
  setOpen(false, false);
})();
