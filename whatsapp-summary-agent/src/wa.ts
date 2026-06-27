import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';

const logger = pino({ level: 'warn' });

export interface IncomingGroupMessage {
  id: string;
  groupJid: string;
  sender: string;
  senderName: string;
  body: string;
  ts: number;
}

type MessageHandler = (msg: IncomingGroupMessage) => void;

// Holds the current live socket. Reconnects replace it, so callers go through
// sendToGroup() rather than capturing a socket reference.
let sock: WASocket | null = null;

/** Extract plain text from the many shapes a WhatsApp message can take. */
function extractText(m: WAMessage): string | null {
  const msg = m.message;
  if (!msg) return null;
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    null
  );
}

export async function startSocket(onMessage: MessageHandler): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    // We print our own QR below for clarity.
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[wa] Scan this QR with WhatsApp → Linked devices → Link a device:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('[wa] connected');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.error(
          '[wa] logged out — delete the auth/ directory and re-scan the QR to reconnect.',
        );
        return; // do not auto-reconnect; needs a fresh QR scan
      }

      console.warn(`[wa] connection closed (code ${statusCode ?? 'unknown'}), reconnecting…`);
      // Re-create the socket. saveCreds already persisted state.
      void startSocket(onMessage);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // ignore history sync / appends

    for (const m of messages) {
      const remoteJid = m.key.remoteJid;
      if (!remoteJid || !remoteJid.endsWith('@g.us')) continue; // groups only
      if (m.key.fromMe) continue; // skip our own (incl. the summary we post)

      // Help discover the group JID on first run.
      if (config.groupJid === '') {
        if (config.logUnknownGroups) {
          console.log(`[wa] message from group JID: ${remoteJid} (set GROUP_JID to this)`);
        }
        continue;
      }
      if (remoteJid !== config.groupJid) {
        if (config.logUnknownGroups) {
          console.log(`[wa] ignoring other group JID: ${remoteJid}`);
        }
        continue;
      }

      const body = extractText(m);
      if (!body) continue; // non-text (sticker, audio, etc.) — skip

      onMessage({
        id: m.key.id ?? `${remoteJid}:${m.messageTimestamp}`,
        groupJid: remoteJid,
        sender: m.key.participant ?? remoteJid,
        senderName: m.pushName ?? 'Unknown',
        body,
        ts: Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)),
      });
    }
  });
}

/** Send a text message to a group JID using the current live socket. */
export async function sendToGroup(groupJid: string, text: string): Promise<void> {
  if (!sock) throw new Error('socket not connected');
  await sock.sendMessage(groupJid, { text });
}
