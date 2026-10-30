(() => {
  const target = document.querySelector('#diagram');
  let latest = 0, id, chain = Promise.resolve();
  const resize = () => { if (id) parent.postMessage({ type: 'diagram-size', id, height: Math.min(4000, Math.max(96, document.body.scrollHeight + 8)) }, '*'); };
  new ResizeObserver(resize).observe(target);
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.type !== 'render-diagram' || typeof data.source !== 'string' || data.source.length > 12000 || typeof data.id !== 'string') return;
    const version = ++latest; id = data.id;
    chain = chain.catch(() => {}).then(async () => {
      if (version !== latest) return;
      document.body.dataset.theme = data.theme === 'dark' ? 'dark' : 'light';
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 12000, maxEdges: 200,
          theme: data.theme === 'dark' ? 'dark' : 'default', htmlLabels: false, flowchart: { htmlLabels: false },
          secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'theme', 'themeCSS', 'themeVariables'] });
        const rendered = await mermaid.render(`diagram-${version}`, data.source);
        if (version !== latest) return;
        target.innerHTML = rendered.svg;
      } catch {
        if (version !== latest) return;
        target.replaceChildren();
        const error = document.createElement('p'); error.className = 'diagram-error';
        error.textContent = data.language === 'en' ? 'Unable to render this diagram. Check the Mermaid syntax.' : '无法渲染图表，请检查 Mermaid 语法。'; target.append(error);
      }
      resize();
    });
  });
})();
