import http from 'node:http';
import fs from 'node:fs';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { parseTwiml } from './twiml.js';
import { createHandler, digits, parseAllowList } from './handler.js';

const { PAIR_KEY, AGENT_URL } = process.env;
const PAIR_NUMBER = (process.env.PAIR_NUMBER || '').replace(/\D/g, '');
// Numbers (besides the self-chat) that may talk to the bot; everyone else is ignored.
const ALLOW_NUMBERS = parseAllowList(process.env.ALLOW_NUMBERS);
const PORT = Number(process.env.PORT) || 7860;
const AUTH_DIR = './auth';
const log = (...a) => console.log(new Date().toISOString(), ...a);

let sock = null;
let gen = 0; // bumped for every new socket so stale events are ignored
let state = 'starting';
let pairing = { code: null, at: null };
const lidToPn = new Map();

async function start() {
  const my = ++gen;
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* use bundled default */ }
  if (my !== gen) return;
  const s = (sock = makeWASocket({
    auth, version, browser: Browsers.ubuntu('Chrome'), logger: pino({ level: 'warn' }),
    markOnlineOnConnect: false, syncFullHistory: false,
  }));
  let codeAsked = false;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('chats.phoneNumberShare', ({ lid, jid }) => lid && jid && lidToPn.set(digits(lid), digits(jid)));
  s.ev.on('connection.update', async (u) => {
    if (my !== gen) return;
    const { connection, lastDisconnect, qr } = u;
    // A qr event means the handshake is done and the socket is ready for a pairing code.
    if (qr && !auth.creds.registered && !codeAsked) {
      codeAsked = true;
      state = 'waiting';
      if (!PAIR_NUMBER) return log('PAIR_NUMBER not set, cannot pair');
      try {
        pairing = { code: await s.requestPairingCode(PAIR_NUMBER), at: new Date() };
        log('pairing code ready');
      } catch (e) { log('pairing code failed:', e.message); }
    }
    if (connection === 'open') { state = 'connected'; pairing = { code: null, at: null }; log('connected'); }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode;
      log('closed, status', status);
      pairing = { code: null, at: null };
      if (status === DisconnectReason.loggedOut) {
        state = 'logged out';
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(boot, 2000);
      } else {
        state = 'reconnecting';
        setTimeout(boot, 3000);
      }
    }
  });
  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) handle(s, m).catch((e) => log('handler error:', e.message));
  });
}

async function askAgent(body, from) {
  const url = new URL(AGENT_URL);
  url.searchParams.set('Body', body);
  url.searchParams.set('From', `whatsapp:+${from}`);
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`agent HTTP ${res.status}`);
  return parseTwiml(await res.text());
}

const handle = createHandler({ askAgent, allowNumbers: ALLOW_NUMBERS, lidToPn, log });

function restartPairing() {
  gen++; // invalidates the current socket's handlers
  try { sock?.end(undefined); } catch { /* already closed */ }
  pairing = { code: null, at: null };
  state = 'starting';
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  setTimeout(boot, 1000);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(body + '\n'); };
  if (u.pathname === '/') return send(200, `ok - ${state}`);
  if (u.pathname === '/pair') {
    if (!PAIR_KEY || u.searchParams.get('k') !== PAIR_KEY) return send(403, 'forbidden');
    if (u.searchParams.get('new') === '1') {
      if (sock?.authState?.creds?.registered) return send(409, `already paired (${state}), no new code needed`);
      restartPairing();
      return send(200, 'restarting pairing, call /pair again in a few seconds');
    }
    if (state === 'connected') return send(200, 'connected');
    if (pairing.code) return send(200, `${pairing.code}\nissued ${pairing.at.toISOString()}`);
    return send(200, state === 'waiting' ? 'waiting' : state);
  }
  send(404, 'not found');
}).listen(PORT, () => log('http on', PORT));

setInterval(() => log('alive, state:', state), 5 * 60 * 1000);
if (process.env.RENDER_EXTERNAL_URL) setInterval(() => { fetch(process.env.RENDER_EXTERNAL_URL + '/').catch(() => {}); }, 8 * 60 * 1000);
log(`self-chat enabled, ${ALLOW_NUMBERS.size} allowlisted number(s)`);
if (!AGENT_URL) log('AGENT_URL not set, messages will not be answered');
const boot = () => start().catch((e) => { log('start failed:', e.message); setTimeout(boot, 5000); });
boot();
