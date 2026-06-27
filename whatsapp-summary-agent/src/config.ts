import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name} (see .env.example)`);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const config = {
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  summaryModel: optional('SUMMARY_MODEL', 'claude-haiku-4-5'),

  // GROUP_JID may be empty on first run while you discover it from the logs.
  groupJid: optional('GROUP_JID', ''),
  logUnknownGroups: optional('LOG_UNKNOWN_GROUPS', 'true') === 'true',

  summaryCron: optional('SUMMARY_CRON', '0 20 * * *'),
  timezone: optional('TZ', 'Europe/Bucharest'),

  dbPath: optional('DB_PATH', './data/messages.db'),
  authDir: optional('AUTH_DIR', './auth'),

  retentionDays: parseInt(optional('RETENTION_DAYS', '14'), 10),
  maxTranscriptChars: parseInt(optional('MAX_TRANSCRIPT_CHARS', '40000'), 10),
} as const;
