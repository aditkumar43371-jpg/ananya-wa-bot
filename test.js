import assert from 'node:assert/strict';
import { parseTwiml } from './twiml.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Tom &amp; Jerry &lt;3 &quot;hi&quot; &#8377;50</Message>
<Message><Body>Second &gt; first</Body><Media>https://x/y.png</Media></Message><Message/><Message>  </Message></Response>`;
assert.deepEqual(parseTwiml(xml), ['Tom & Jerry <3 "hi" ₹50', 'Second > first']);
assert.deepEqual(parseTwiml('<Response></Response>'), []);
assert.deepEqual(parseTwiml('<Response><Message><![CDATA[a & b <c>]]></Message></Response>'), ['a & b <c>']);
assert.deepEqual(parseTwiml('<Response><Message>&amp;lt;</Message></Response>'), ['&lt;']);
console.log('twiml tests ok');

// ---- message handling (fake socket) ----
const { createHandler, parseAllowList } = await import('./handler.js');
const SELF = '918340186805';
const FRIEND = '919812345678';
const OTHER = '911111111111';

function setup({ allow = '', user = { id: `${SELF}:7@s.whatsapp.net`, lid: '555555:7@lid' } } = {}) {
  const sent = [];
  const asked = [];
  const sock = {
    user,
    sendMessage: async (jid, content, opts) => { sent.push({ jid, text: content.text, id: opts?.messageId }); return { key: { id: opts?.messageId || 'x' } }; },
    sendPresenceUpdate: async () => {},
  };
  const handle = createHandler({
    askAgent: async (body, from) => { asked.push({ body, from }); return [`reply to ${body}`]; },
    allowNumbers: parseAllowList(allow),
  });
  let n = 0;
  const msg = (remoteJid, text, fromMe = false, extra = {}) => ({
    key: { remoteJid, fromMe, id: `ID${++n}`, ...extra },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  return { sock, sent, asked, handle, msg };
}

{ // self-chat, typed by Adit (fromMe) is answered, From uses own number
  const t = setup();
  await t.handle(t.sock, t.msg(`${SELF}@s.whatsapp.net`, 'hello', true));
  assert.deepEqual(t.asked, [{ body: 'hello', from: SELF }]);
  assert.deepEqual(t.sent.map((x) => [x.jid, x.text]), [[`${SELF}@s.whatsapp.net`, 'reply to hello']]);
}
{ // self-chat via the @lid form is answered too
  const t = setup();
  await t.handle(t.sock, t.msg('555555@lid', 'hi lid', true));
  assert.deepEqual(t.asked, [{ body: 'hi lid', from: SELF }]);
  assert.equal(t.sent[0].jid, '555555@lid');
}
{ // another contact (not allowlisted) is ignored, whether they wrote or Adit wrote to them
  const t = setup();
  await t.handle(t.sock, t.msg(`${OTHER}@s.whatsapp.net`, 'hey'));
  await t.handle(t.sock, t.msg(`${OTHER}@s.whatsapp.net`, 'Adit typing to a friend', true));
  await t.handle(t.sock, t.msg('999999@lid', 'unknown lid'));
  assert.equal(t.asked.length, 0);
  assert.equal(t.sent.length, 0);
}
{ // groups are ignored, even when they start with "ananya" and the sender is allowlisted
  const t = setup({ allow: FRIEND });
  await t.handle(t.sock, t.msg('1203630@g.us', 'ananya hello', false, { participant: `${FRIEND}@s.whatsapp.net` }));
  await t.handle(t.sock, t.msg('1203630@g.us', 'ananya hello', true));
  assert.equal(t.sent.length, 0);
  assert.equal(t.asked.length, 0);
}
{ // allowlisted contact is answered (From = their number); Adit's own messages to them are not
  const t = setup({ allow: `+${FRIEND}, 1234` });
  await t.handle(t.sock, t.msg(`${FRIEND}@s.whatsapp.net`, 'hi ananya'));
  assert.deepEqual(t.asked, [{ body: 'hi ananya', from: FRIEND }]);
  assert.equal(t.sent[0].jid, `${FRIEND}@s.whatsapp.net`);
  await t.handle(t.sock, t.msg(`${FRIEND}@s.whatsapp.net`, 'Adit typed this', true));
  assert.equal(t.asked.length, 1);
  assert.equal(t.sent.length, 1);
}
{ // allowlisted contact arriving as @lid is resolved through the sender number
  const t = setup({ allow: FRIEND });
  await t.handle(t.sock, t.msg('777@lid', 'via lid', false, { senderPn: `${FRIEND}@s.whatsapp.net` }));
  assert.deepEqual(t.asked, [{ body: 'via lid', from: FRIEND }]);
}
{ // the bot's own reply echoing back in the self-chat is not re-processed
  const t = setup();
  await t.handle(t.sock, t.msg(`${SELF}@s.whatsapp.net`, 'ping', true));
  assert.equal(t.sent.length, 1);
  const echoById = { key: { remoteJid: `${SELF}@s.whatsapp.net`, fromMe: true, id: t.sent[0].id }, message: { conversation: 'something else' }, messageTimestamp: Math.floor(Date.now() / 1000) };
  await t.handle(t.sock, echoById);
  await t.handle(t.sock, t.msg(`${SELF}@s.whatsapp.net`, t.sent[0].text, true)); // same text, different id
  assert.equal(t.asked.length, 1);
  assert.equal(t.sent.length, 1);
  await t.handle(t.sock, t.msg(`${SELF}@s.whatsapp.net`, 'a new question', true)); // normal messages still work
  assert.equal(t.asked.length, 2);
}
{ // duplicate delivery of the same message is answered once; voice note gets the text-only reply
  const t = setup();
  const m = t.msg(`${SELF}@s.whatsapp.net`, 'once', true);
  await t.handle(t.sock, m);
  await t.handle(t.sock, m);
  assert.equal(t.asked.length, 1);
  await t.handle(t.sock, { key: { remoteJid: `${SELF}@s.whatsapp.net`, fromMe: true, id: 'VN1' }, message: { audioMessage: {} }, messageTimestamp: Math.floor(Date.now() / 1000) });
  assert.match(t.sent.at(-1).text, /voice note/);
}
{ // not logged in yet: nobody is answered
  const t = setup({ user: null });
  await t.handle(t.sock, t.msg(`${SELF}@s.whatsapp.net`, 'x', true));
  assert.equal(t.sent.length, 0);
}
console.log('handler tests ok');
