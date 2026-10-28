import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/chat/Markdown.tsx";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("chat Markdown", () => {
  it("renders GitHub-flavoured Markdown", () => {
    const out = html("## Results\n\n- **3** items\n- `run_query`\n\n| code | name |\n|---|---|\n| H1 | Alpha |\n\nSee https://example.com/x");
    expect(out).toContain("<h2>Results</h2>");
    expect(out).toContain("<strong>3</strong>");
    expect(out).toContain("<code>run_query</code>");
    expect(out).toMatch(/<div class="md-table"><table>.*<td>Alpha<\/td>/);
    expect(out).toContain('<a href="https://example.com/x" target="_blank" rel="noreferrer noopener">https://example.com/x</a>');
  });

  it("keeps model text inert: no raw HTML, no script links, no remote images", () => {
    const out = html('<img src=x onerror=alert(1)> [click](javascript:alert(1)) ![logo](https://evil.example/t.png)');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("click");
    expect(out).toContain("logo");
  });
});
