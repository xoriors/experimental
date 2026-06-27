import { config } from './config.js';
import { getMessagesSince, pruneOld } from './store.js';
import { summarizeDay } from './summarize.js';
import { sendToGroup } from './wa.js';

/** Unix seconds for local midnight today, in the configured timezone. */
function startOfTodayUnix(): number {
  // Format "now" in the target tz, then reinterpret that wall-clock date at 00:00.
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const ymd = `${get('year')}-${get('month')}-${get('day')}T00:00:00`;

  // Compute the tz offset at this instant to convert local midnight → UTC.
  const asUtc = new Date(`${ymd}Z`).getTime();
  const offsetMs = tzOffsetMs(now, config.timezone);
  return Math.floor((asUtc - offsetMs) / 1000);
}

/** Offset (ms) of `tz` from UTC at the given instant: localWallClock = utc + offset. */
function tzOffsetMs(at: Date, tz: string): number {
  const tzString = at.toLocaleString('en-US', { timeZone: tz });
  const utcString = at.toLocaleString('en-US', { timeZone: 'UTC' });
  return new Date(tzString).getTime() - new Date(utcString).getTime();
}

/** Gather today's messages, summarize, and post the result back to the group. */
export async function runDailySummary(): Promise<void> {
  if (config.groupJid === '') {
    console.warn('[job] GROUP_JID not set — skipping summary. Discover it from the logs first.');
    return;
  }

  const since = startOfTodayUnix();
  const messages = getMessagesSince(config.groupJid, since);
  console.log(`[job] summarizing ${messages.length} messages since ${new Date(since * 1000).toISOString()}`);

  let summary: string | null;
  try {
    summary = await summarizeDay(messages);
  } catch (err) {
    console.error('[job] summarization failed:', err);
    return;
  }

  if (!summary) {
    console.log('[job] nothing to summarize today — staying quiet.');
    return;
  }

  const header = formatHeader();
  try {
    await sendToGroup(config.groupJid, `${header}\n\n${summary}`);
    console.log('[job] summary posted to group.');
  } catch (err) {
    console.error('[job] failed to post summary:', err);
  }

  const pruned = pruneOld();
  if (pruned > 0) console.log(`[job] pruned ${pruned} old messages.`);
}

function formatHeader(): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return `📋 Daily summary — ${date}`;
}
