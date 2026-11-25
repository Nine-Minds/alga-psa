import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeForwardedSender,
  detectForwardedSender,
  isForwardedSenderResolutionEnabled,
  parseForwardedHeaderBlock,
} from '../forwardedMessage';

// Hand-written fixtures shaped like each client's plain-text forward. RFC 2606 example domains only.
const OUTLOOK = `Hi team, can you open a ticket for this one?

________________________________
From: Dana Whitfield <dana.whitfield@client-a.example>
Sent: Tuesday, November 18, 2025 9:14 AM
To: Tom Technician <tom@msp.example>
Subject: VPN keeps dropping

Hello Tom,
The VPN has dropped three times today.
`;

const GMAIL = `Please log this.

---------- Forwarded message ---------
From: Dana Whitfield <dana.whitfield@client-a.example>
Date: Tue, Nov 18, 2025 at 9:14 AM
Subject: VPN keeps dropping
To: Tom Technician <tom@msp.example>

Hello Tom,
The VPN has dropped three times today.
`;

const APPLE = `Logging this for Dana.

Begin forwarded message:

From: Dana Whitfield <dana.whitfield@client-a.example>
Subject: VPN keeps dropping
Date: November 18, 2025 at 9:14:02 AM EST
To: Tom Technician <tom@msp.example>

Hello Tom,
`;

const GERMAN = `Bitte als Ticket anlegen.

Von: Dana Weiß <dana.weiss@kunde.example>
Gesendet: Dienstag, 18. November 2025 09:14
An: Tom Technician <tom@msp.example>
Betreff: VPN bricht ab

Hallo Tom,
`;

const FRENCH = `Merci de créer un ticket.

De: Dana Martin <dana.martin@client.example>
Envoyé: mardi 18 novembre 2025 09:14
À: Tom Technician <tom@msp.example>
Objet: Le VPN se déconnecte

Bonjour Tom,
`;

const REPLY_CHAIN = `FYI

From: Dana Whitfield <dana.whitfield@client-a.example>
Sent: Tuesday, November 18, 2025 9:14 AM
To: Tom Technician <tom@msp.example>
Subject: RE: VPN keeps dropping

Still happening.

From: Tom Technician <tom@msp.example>
Sent: Monday, November 17, 2025 4:00 PM
To: Other Person <other@client-b.example>
Subject: VPN keeps dropping

Earlier note.
`;

describe('parseForwardedHeaderBlock', () => {
  it('returns the single From address of a coherent block', () => {
    const block = parseForwardedHeaderBlock(OUTLOOK.split('\n'), 3);
    expect(block?.from).toEqual({ email: 'dana.whitfield@client-a.example', name: 'Dana Whitfield' });
    expect(block?.subject).toBe('VPN keeps dropping');
  });

  it('is not coherent without To/Subject', () => {
    expect(parseForwardedHeaderBlock(['From: a@b.example', 'Sent: today', 'Body'])).toBeNull();
  });

  it('is not coherent when the first line is not From', () => {
    expect(parseForwardedHeaderBlock(['Subject: x', 'From: a@b.example'])).toBeNull();
  });
});

describe('detectForwardedSender', () => {
  it.each([
    ['Outlook inline', OUTLOOK, 'dana.whitfield@client-a.example'],
    ['Gmail', GMAIL, 'dana.whitfield@client-a.example'],
    ['Apple Mail', APPLE, 'dana.whitfield@client-a.example'],
    ['German labels', GERMAN, 'dana.weiss@kunde.example'],
    ['French labels', FRENCH, 'dana.martin@client.example'],
  ])('%s', async (_name, text, email) => {
    const result = await detectForwardedSender({ headers: {}, text });
    expect(result?.source).toBe('text-block');
    expect(result?.sender.email).toBe(email);
  });

  it('prefers a nested message/rfc822 attachment over a body block', async () => {
    const inner = [
      'From: Nested Sender <nested@client-c.example>',
      'To: tom@msp.example',
      'Subject: Original',
      'Date: Tue, 18 Nov 2025 09:14:00 +0000',
      'Message-ID: <inner@client-c.example>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain',
      '',
      'Body',
      '',
    ].join('\r\n');
    const result = await detectForwardedSender({
      headers: {},
      text: OUTLOOK,
      attachments: [{ contentType: 'message/rfc822', name: 'fwd.eml', content: Buffer.from(inner).toString('base64') }],
    });
    expect(result).toEqual({ sender: { email: 'nested@client-c.example', name: 'Nested Sender' }, source: 'nested-message' });
  });

  it('returns null for direct mail', async () => {
    expect(await detectForwardedSender({ headers: {}, text: 'Hi, my printer is broken.\nThanks' })).toBeNull();
  });

  it('uses only the first block of a forwarded reply chain', async () => {
    const result = await detectForwardedSender({ headers: {}, text: REPLY_CHAIN });
    expect(result?.sender.email).toBe('dana.whitfield@client-a.example');
  });

  it('returns null when the block carries two different addresses', async () => {
    const text = OUTLOOK.replace(
      'From: Dana Whitfield <dana.whitfield@client-a.example>',
      'From: Dana Whitfield <dana.whitfield@client-a.example>; Eve <eve@client-b.example>'
    );
    expect(await detectForwardedSender({ headers: {}, text })).toBeNull();
    expect(await analyzeForwardedSender({ text })).toEqual({ status: 'not-applied', reason: 'ambiguous' });
  });

  it('returns null for an unparseable From', async () => {
    const text = OUTLOOK.replace('Dana Whitfield <dana.whitfield@client-a.example>', 'Dana Whitfield');
    expect(await detectForwardedSender({ headers: {}, text })).toBeNull();
  });

  it('never reads outer headers as evidence', async () => {
    const result = await detectForwardedSender({
      headers: {
        'x-original-from': 'dana.whitfield@client-a.example',
        'reply-to': 'Dana <dana.whitfield@client-a.example>',
        sender: 'dana.whitfield@client-a.example',
        'return-path': '<dana.whitfield@client-a.example>',
      },
      text: 'Please open a ticket.',
    });
    expect(result).toBeNull();
  });

  it('detects an HTML-only forward but does not attribute it', async () => {
    const html = '<div>---------- Forwarded message ---------<br><b>From:</b> Dana &lt;dana@client-a.example&gt;</div>';
    expect(await detectForwardedSender({ text: '', html })).toBeNull();
    expect(await analyzeForwardedSender({ text: '', html })).toEqual({ status: 'not-applied', reason: 'no-text-part' });
  });
});

describe('isForwardedSenderResolutionEnabled', () => {
  const original = process.env.INBOUND_RESOLVE_FORWARDED_SENDER;
  afterEach(() => {
    if (original === undefined) delete process.env.INBOUND_RESOLVE_FORWARDED_SENDER;
    else process.env.INBOUND_RESOLVE_FORWARDED_SENDER = original;
  });

  it('is on by default and off only for "false"', () => {
    delete process.env.INBOUND_RESOLVE_FORWARDED_SENDER;
    expect(isForwardedSenderResolutionEnabled()).toBe(true);
    process.env.INBOUND_RESOLVE_FORWARDED_SENDER = 'FALSE';
    expect(isForwardedSenderResolutionEnabled()).toBe(false);
  });
});
