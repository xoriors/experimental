import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { StoredMessage } from './store.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = [
  "You summarize one day of a WhatsApp group's messages for the group itself.",
  'Write plain text suitable for a WhatsApp message — no markdown headers, no tables.',
  'Group the recap by topic. Call out decisions made, open questions, and any',
  'action items (with who they belong to, if clear). Keep it concise and skimmable.',
  'Use short lines or simple "•" bullets. Do not invent anything not in the messages.',
].join(' ');

function buildTranscript(messages: StoredMessage[]): string {
  const lines = messages.map((m) => `${m.senderName}: ${m.body.replace(/\s+/g, ' ').trim()}`);
  let transcript = lines.join('\n');

  // Bound token cost on very busy days: keep the most recent messages.
  if (transcript.length > config.maxTranscriptChars) {
    transcript = transcript.slice(transcript.length - config.maxTranscriptChars);
    transcript = `…(earlier messages trimmed)…\n${transcript.slice(transcript.indexOf('\n') + 1)}`;
  }
  return transcript;
}

/**
 * Summarize a day's messages. Returns null when there is nothing to summarize,
 * so the caller can decide whether to stay quiet.
 */
export async function summarizeDay(messages: StoredMessage[]): Promise<string | null> {
  if (messages.length === 0) return null;

  const transcript = buildTranscript(messages);

  const response = await client.messages.create({
    model: config.summaryModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here are today's ${messages.length} group messages, oldest first:\n\n${transcript}\n\nWrite the daily summary.`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return text === '' ? null : text;
}
