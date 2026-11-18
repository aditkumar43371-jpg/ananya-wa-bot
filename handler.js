import { randomBytes } from 'node:crypto';

const MAX_AGE_S = 300; // skip messages older than this (history / long offline)
const RECENT_TTL_MS = 10 * 60 * 1000; // how long the bot remembers its own replies
const VOICE_REPLY = 'Abhi voice note samajh nahi paati, text mein likho.';

export const digits = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// "918340186805, +91 98123-45678" -> Set('918340186805', '919812345678')
export function parseAllowList(raw) {
  return new Set(String(raw || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean));
}

// The bot's own chat identities: number@s.whatsapp.net and, when known, id@lid.
export function selfIdentity(s) {
  const user = s?.user;
  const num = digits(user?.id);
  if (!num) return null;
  const jids = new Set([`${num}@s.whatsapp.net`]);
  const lid = digits(user?.lid);
  if (lid) jids.add(`${lid}@lid`);
  return { num, jids };
}

// Builds the message handler. Only two kinds of chats are ever answered:
//   1. the self-chat ("Message yourself"), including messages the owner typed (fromMe)
//   2. direct chats with numbers in allowNumbers
// Everything else (other contacts, groups, broadcasts) is ignored silently.
export function createHandler({ askAgent, allowNumbers = new Set(), lidToPn = new Map(), log = () => {}, now = Date.now }) {
  const seen = new Set(); // incoming message ids already processed
  const sentIds = new Set(); // ids of messages the bot sent
  const sentTexts = new Map(); // text -> expiry time, recent bot replies

  const remember = (set, v, max = 500) => { set.add(v); if (set.size > max) set.delete(set.values().next().value); };
  const rememberText = (t) => {
    const t0 = now();
    for (const [k, exp] of sentTexts) if (exp < t0) sentTexts.delete(k);
    sentTexts.set(t, t0 + RECENT_TTL_MS);
    if (sentTexts.size > 200) sentTexts.delete(sentTexts.keys().next().value);
  };
  const isRecentReply = (t) => (sentTexts.get(t) ?? 0) > now();

  // Every outgoing message goes through here so it can be recognised when it echoes back.
  async function say(s, jid, text) {
    const messageId = '3EB0' + randomBytes(18).toString('hex').toUpperCase();
    remember(sentIds, messageId);
    rememberText(text);
    const res = await s.sendMessage(jid, { text }, { messageId });
    if (res?.key?.id) remember(sentIds, res.key.id);
  }

  // Phone number of a direct-chat sender, or null when a @lid cannot be resolved.
  function chatPhone(s, key) {
    const jid = key.remoteJid;
    if (!jid.endsWith('@lid')) return digits(jid) || null;
    const pn = key.senderPn || key.remoteJidAlt
      || s.signalRepository?.lidMapping?.getPNForLID?.(jid) || lidToPn.get(digits(jid));
    if (!pn) return null;
    if (!String(pn).includes('@')) return digits(pn);
    lidToPn.set(digits(jid), digits(pn));
    return digits(pn);
  }

  return async function handle(s, m) {
    const { key, message } = m;
    const jid = key?.remoteJid;
    if (!message || !jid) return;
    if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter') || jid.endsWith('@g.us')) return;

    const self = selfIdentity(s);
    if (!self) return; // not logged in yet: answer nobody
    const isSelfChat = self.jids.has(jid);

    let from;
    if (isSelfChat) {
      from = self.num;
    } else {
      // Outside the self-chat, never touch anything the owner sent himself (fromMe).
      if (key.fromMe) return;
      const phone = chatPhone(s, key);
      if (!phone || !allowNumbers.has(phone)) return;
      from = phone;
    }

    const ts = Number(m.messageTimestamp?.toString?.() ?? m.messageTimestamp);
    if (ts && now() / 1000 - ts > MAX_AGE_S) return;
    if (key.id && sentIds.has(key.id)) return; // the bot's own message echoing back
    if (key.id) {
      if (seen.has(key.id)) return;
      remember(seen, key.id);
    }

    const text = message.conversation || message.extendedTextMessage?.text || '';
    if (isSelfChat && text && isRecentReply(text)) return; // looks like one of our own replies
    if (!text && !message.audioMessage) return;

    if (!text) { await say(s, jid, VOICE_REPLY); return; }
    log('message from +' + from.slice(0, 4) + '***', isSelfChat ? '(self-chat)' : '');
    const typing = () => s.sendPresenceUpdate('composing', jid).catch(() => {});
    typing();
    const timer = setInterval(typing, 8000);
    try {
      for (const reply of await askAgent(text, from)) await say(s, jid, reply);
    } catch (e) {
      log('agent call failed:', e.message);
    } finally {
      clearInterval(timer);
      s.sendPresenceUpdate('paused', jid).catch(() => {});
    }
  };
}
