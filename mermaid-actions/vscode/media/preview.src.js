// VS Code host, preview webview side. Finds the diagram a click landed in, looks up the node's
// action in the data element placed just before it, and runs it.
const toastEl = document.createElement('div');
toastEl.className = 'ma-toast';
document.documentElement.appendChild(toastEl);

const readClicks = data => { try { return JSON.parse(data.dataset.actions); } catch { return null; } };

const clicksFor = target => {
  for (let b = target; b && b !== document.body; b = b.parentElement) {
    const prev = b.previousElementSibling;
    if (prev?.classList.contains('mermaid-actions-data')) return readClicks(prev);
  }
  return null;
};

MermaidActions.mount(document, {
  capture: true,           // before mermaid.js's own <a> handling, which would navigate to about:blank
  toast: MermaidActions.toaster(toastEl),
  clicks: clicksFor,
});

MermaidActions.watch(document.body, () => {
  for (const data of document.querySelectorAll('.mermaid-actions-data')) {
    const clicks = readClicks(data);
    if (clicks && data.nextElementSibling) MermaidActions.decorate(data.nextElementSibling, clicks);
  }
});
