---
title: Ananya WhatsApp Bot
emoji: 💬
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Ananya WhatsApp bot

A small WhatsApp linked-device bridge (Baileys). Incoming text messages are
sent to the Ananya agent over HTTP and its TwiML reply is sent back to the chat.

## Settings (Space secrets / env)

| Name | Meaning |
| --- | --- |
| `PAIR_NUMBER` | WhatsApp number to link, digits with country code, e.g. `919812345678` |
| `PAIR_KEY` | Secret key needed to read the pairing code |
| `AGENT_URL` | Agent endpoint; called with `Body` and `From=whatsapp:+<number>` |
| `ALLOW_NUMBERS` | Optional. Comma-separated numbers (digits with country code, e.g. `919812345678,919876543210`) that may also chat with the bot. Default: empty |

## Pairing

1. Open `/pair?k=<PAIR_KEY>` and read the 8-character code.
2. On the phone: WhatsApp > Linked devices > Link a device > Link with phone number instead, enter the code.
3. `/pair?k=<PAIR_KEY>&new=1` starts a fresh pairing attempt (only while not yet paired).

`GET /` shows `ok` and the connection state.

## Behaviour

The bot is meant to be linked to a personal WhatsApp number, so it only answers two kinds of chats and ignores everything else silently:

- **Self-chat** ("Message yourself"): every text message goes to the agent, including the ones the owner types himself. `From` is the bot's own number. The self-chat is recognised by the bot's own number and, when known, its `@lid` id.
- **Numbers in `ALLOW_NUMBERS`**: direct messages from these contacts go to the agent. Messages the owner sends to them are never processed.
- **Everything else** (other contacts, groups, broadcasts, status, newsletters) is ignored. The bot never replies there. Before the bot knows its own number (not logged in), it answers nobody.
- Loop protection: the bot remembers the ids of the messages it sent and its recent reply texts (10 minutes). Echoes of its own replies in the self-chat are skipped.
- Voice notes in the self-chat or an allowed chat get a short "write in text" reply.
- Login lives in `./auth`. On a free Space the disk is wiped on restart, so
  either attach persistent storage mounted at `/app/auth` or pair again after a restart.
