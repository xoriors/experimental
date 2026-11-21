// VS Code host, preview webview side. Finds the diagram a click landed in, looks up the node's
// action in the data element placed just before it, and runs it.
const toastEl = document.createElement('div');
toastEl.className = 'ma-toast';
const toast = msg => {
  toastEl.textContent = msg;
  if (!toastEl.isConnected) document.body.appendChild(toastEl);
  toastEl.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => toastEl.classList.remove('on'), 4000);
};

const dataBefore = target => {
  for (let b = target; b && b !== document.body; b = b.parentElement) {
    const prev = b.previousElementSibling;
    if (prev?.classList.contains('mermaid-actions-data')) {
      try { return { block: b, clicks: JSON.parse(prev.dataset.actions) }; } catch { return null; }
    }
  }
  return null;
};

MermaidActions.mount(document, {
  capture: true,           // before mermaid.js's own <a> handling, which would navigate to about:blank
  toast,
  hrefFor: target => {
    const d = dataBefore(target);
    return d && d.clicks[MermaidActions.nodeIdOf(target)?.id]?.href;
  },
});

// Diagrams render asynchronously and the preview re-renders on every edit.
const tag = () => {
  for (const data of document.querySelectorAll('.mermaid-actions-data')) {
    const block = data.nextElementSibling;
    if (block) try { MermaidActions.decorate(block, JSON.parse(data.dataset.actions)); } catch {}
  }
};
new MutationObserver(tag).observe(document.body, { childList: true, subtree: true });
tag();
