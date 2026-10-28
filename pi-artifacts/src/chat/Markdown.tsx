import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Links open in a new tab. react-markdown renders no raw HTML and its default
// URL check drops javascript: and other unsafe links; this keeps only http(s)
// and mailto, since the text comes from the model and from MCP servers.
const components: Components = {
  a: ({ href, children }) =>
    href && /^(https?:|mailto:)/i.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  // Images in model text would load from anywhere; show the alt text instead.
  img: ({ alt }) => <>{alt ?? ""}</>,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

/** An assistant message as Markdown (GitHub flavour: tables, task lists, strikethrough, autolinked URLs). */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
