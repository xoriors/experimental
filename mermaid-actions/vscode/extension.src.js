// VS Code host, Node side. The Markdown preview renders Mermaid through another extension (for
// example "Markdown Preview Mermaid Support") that may not keep our links, so we put the parsed
// `click` lines next to each diagram as a hidden element; media/preview.js reads them on click.
// A core rule, rather than a fence renderer, keeps this independent of extension load order.
function activate() {
  return {
    extendMarkdownIt(md) {
      md.core.ruler.push('mermaid_actions', state => {
        for (let i = state.tokens.length - 1; i >= 0; i--) {
          const tok = state.tokens[i];
          if (tok.type !== 'fence' || !/^\s*mermaid\b/.test(tok.info)) continue;
          const clicks = MermaidActions.parseClicks(tok.content);
          if (!Object.keys(clicks).length) continue;
          const h = new state.Token('html_block', '', 0);
          h.block = true;
          h.content = `<div class="mermaid-actions-data" hidden data-actions="${md.utils.escapeHtml(JSON.stringify(clicks))}"></div>\n`;
          state.tokens.splice(i, 0, h);
        }
      });
      return md;
    },
  };
}
function deactivate() {}
module.exports = { activate, deactivate };
