(() => {
  const frames = new Map(); let serial = 0;
  const send = record => record.frame.contentWindow?.postMessage({ type: 'render-diagram', id: record.id, source: record.source,
    theme: document.documentElement.dataset.theme, language: document.documentElement.lang }, '*');
  window.RichPreview = { enhance(root) {
    for (const [id, record] of frames) if (!record.frame.isConnected) frames.delete(id);
    let count = 0;
    for (const pre of root.querySelectorAll('pre.mermaid-source')) {
      const source = pre.textContent;
      if (++count > 6 || source.length > 12000) {
        const note = document.createElement('p'); note.textContent = t('图表过多或过长，已显示源码。'); pre.before(note); continue;
      }
      const block = document.createElement('section'); block.className = 'mermaid-preview';
      const frame = document.createElement('iframe'); frame.className = 'mermaid-frame'; frame.title = t('Mermaid 图表');
      frame.setAttribute('sandbox', 'allow-scripts'); frame.src = '/diagram-preview.html';
      const record = { id: `preview-${++serial}`, frame, source };
      frames.set(record.id, record); frame.onload = () => send(record);
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = t('查看图表源码'); details.append(summary);
      pre.replaceWith(block); details.append(pre); block.append(frame, details);
    }
  } };
  addEventListener('message', event => {
    const data = event.data, record = frames.get(data?.id);
    if (!record || !record.frame.isConnected || event.source !== record.frame.contentWindow || data.type !== 'diagram-size' || !Number.isFinite(data.height)) return;
    record.frame.style.height = `${Math.min(4000, Math.max(96, data.height))}px`;
  });
  new MutationObserver(() => { for (const record of frames.values()) if (record.frame.isConnected) send(record); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
