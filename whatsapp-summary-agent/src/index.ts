import cron from 'node-cron';
import { config } from './config.js';
import { insertMessage } from './store.js';
import { startSocket } from './wa.js';
import { runDailySummary } from './job.js';

async function main(): Promise<void> {
  const runNow = process.argv.includes('--run-summary-now');

  console.log('[boot] starting whatsapp-summary-agent');
  console.log(`[boot] model=${config.summaryModel} tz=${config.timezone} cron="${config.summaryCron}"`);
  if (config.groupJid === '') {
    console.log('[boot] GROUP_JID is empty — send a message in the target group to discover its JID.');
  } else {
    console.log(`[boot] watching group ${config.groupJid}`);
  }

  await startSocket((msg) => {
    insertMessage(msg);
  });

  if (runNow) {
    // One-off: useful for testing the summary path without waiting for the cron.
    // Give the socket a moment to come up before posting.
    console.log('[boot] --run-summary-now: will post a summary in 8s…');
    setTimeout(() => {
      void runDailySummary();
    }, 8000);
  }

  if (!cron.validate(config.summaryCron)) {
    throw new Error(`Invalid SUMMARY_CRON: "${config.summaryCron}"`);
  }

  cron.schedule(
    config.summaryCron,
    () => {
      console.log('[cron] daily summary triggered');
      void runDailySummary();
    },
    { timezone: config.timezone },
  );

  console.log('[boot] scheduled. Running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
