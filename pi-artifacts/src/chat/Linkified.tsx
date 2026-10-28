import type { ReactNode } from "react";

// A markdown link [text](https://…) or a bare https URL. Only http(s): the text comes from the model and from tools.
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()"'\]]*[^\s<>()"'\].,;:!?])/g;

/** Text with its links made clickable, opening in a new tab. Everything else stays plain text. */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, target, bare] = match;
    if (match.index > last) parts.push(text.slice(last, match.index));
    const href = target ?? bare;
    parts.push(
      <a key={match.index} href={href} target="_blank" rel="noreferrer noopener">
        {label ?? bare}
      </a>,
    );
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
