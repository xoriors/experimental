// VS Code host, Node side. The Markdown preview renders Mermaid through another extension (for
// example "Markdown Preview Mermaid Support") that may not keep our links, so we put the parsed
// `click` lines next to each diagram as a hidden element; media/preview.js reads them on click.
// A core rule, rather than a fence renderer, keeps this independent of extension load order.
function activate() {
  return {
    extendMarkdownIt(md) {
      md.core.ruler.push('mermaid_actions', state => {
        const out = [];
        for (const tok of state.tokens) {
          if (tok.type === 'fence' && /^\s*mermaid\b/.test(tok.info)) {
            const clicks = MermaidActions.parseClicks(tok.content);
            if (Object.keys(clicks).length) {
              const h = new state.Token('html_block', '', 0);
              h.block = true;
              h.content = `<div class="mermaid-actions-data" hidden data-actions="${md.utils.escapeHtml(JSON.stringify(clicks))}"></div>\n`;
              out.push(h);
            }
          }
          out.push(tok);
        }
        state.tokens = out;
      });
      return md;
    },
  };
}
function deactivate() {}
module.exports = { activate, deactivate };
