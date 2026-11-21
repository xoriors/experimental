// Obsidian host. Pele drops `action:` links, so the nodes are not links in the rendered diagram.
// Instead we read the `click` lines from the note's own Markdown source and run the action when the
// matching node (found by its Mermaid id) is clicked. Reading view; see the README for Live Preview.
const { Plugin, Notice, MarkdownRenderChild } = require('obsidian');

const FENCE = /^\s*(`{3,}|~{3,})\s*mermaid\b/;

module.exports = class MermaidActionsPlugin extends Plugin {
  async onload() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const info = ctx.getSectionInfo(el);
      if (!info) return;
      const lines = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1);
      if (!FENCE.test(lines[0])) return;
      const clicks = MermaidActions.parseClicks(lines.slice(1, -1).join('\n'));
      if (!Object.keys(clicks).length) return;

      const mounted = MermaidActions.mount(el, {
        capture: true,
        toast: msg => new Notice(msg),
        clicks: () => clicks,
      });
      const unwatch = MermaidActions.watch(el, () => MermaidActions.decorate(el, clicks));

      const child = new MarkdownRenderChild(el);
      child.onunload = () => { mounted.destroy(); unwatch(); };
      ctx.addChild(child);
    });
  }
};
