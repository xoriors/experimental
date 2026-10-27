/**
 * JSON with object keys sorted at every level, so two inputs that differ only
 * in property order produce the same cache key.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The convenience `payload` of a result: structured content, else the first text block as JSON, else that text. */
export function derivePayload(result: { content: { type: string; text?: string }[]; structuredContent?: unknown }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((block) => block.type === "text")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
