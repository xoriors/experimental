import RUNTIME from "../../runtime/pi-runtime.js?raw";

/** The only hosts a page may load scripts from, as on claude.ai. */
const SCRIPT_HOSTS = [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net/npm/",
  "https://unpkg.com",
  "https://cdn.tailwindcss.com",
  "https://code.jquery.com",
];

/**
 * The page has no network of its own: `connect-src 'none'`. Every connector
 * call goes through the runtime's message port to the viewer page, which
 * sends it to the Worker.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${SCRIPT_HOSTS.join(" ")}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Wrap the HTML the agent published in a document that loads the runtime
 * first. A page that is already a full document gets the runtime as the first
 * thing in its head.
 */
export function renderArtifact(html: string): string {
  const runtime = `<script>${RUNTIME}</script>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${runtime}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (tag) => `${tag}<head>${runtime}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${runtime}</head><body>${html}</body></html>`;
}

export function artifactResponse(html: string): Response {
  return new Response(renderArtifact(html), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": ARTIFACT_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, max-age=0",
    },
  });
}
