import { describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';

import { INBOUND_MIME_PARSE_OPTIONS } from '../inboundMimeParseOptions';
import { parseStagedMimeIntoEmailDetails } from '../inboundEmailSourceStager';
import { extractEmbeddedImageAttachments } from '../inboundEmailArtifactHelpers';
import { resolveInboundHeaders } from '../../../lib/email/inboundHeaderBag';
import {
  allowsContactSenderAttribution,
  isMicrosoftIntraOrgSender,
  verifySenderAuthentication,
} from '../../../lib/email/senderAuthVerification';

// One inline PNG referenced once from the HTML body, plus a voicemail .wav.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function buildSingleCidMime(): Buffer {
  const outer = 'outer-boundary';
  const related = 'related-boundary';
  return Buffer.from(
    [
      'From: Voicemail Caller <caller@example.test>',
      'To: support@example.test',
      'Subject: Voicemail',
      'Message-ID: <single-cid@example.test>',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      '',
      `--${outer}`,
      `Content-Type: multipart/related; boundary="${related}"`,
      '',
      `--${related}`,
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<p>New voicemail</p><img src="cid:smoke-logo" alt="Smoke logo">',
      `--${related}`,
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <smoke-logo>',
      'Content-Disposition: inline; filename="smoke-logo.png"',
      '',
      PNG_BASE64,
      `--${related}--`,
      `--${outer}`,
      'Content-Type: audio/wav; name="voicemail.wav"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="voicemail.wav"',
      '',
      Buffer.from('RIFF....WAVEfmt ').toString('base64'),
      `--${outer}--`,
      '',
    ].join('\r\n')
  );
}

describe('inbound MIME parsing keeps CID links', () => {
  it('mailparser default rewrites cid: to a data URL (the duplicate-image trap this guards against)', async () => {
    const parsed = await simpleParser(buildSingleCidMime());
    expect(String(parsed.html)).toContain('data:image/png;base64,');
    expect(String(parsed.html)).not.toContain('cid:smoke-logo');
    expect(parsed.attachments.some((a) => a.contentId === '<smoke-logo>')).toBe(true);
  });

  it('parseStagedMimeIntoEmailDetails preserves the cid: reference and the inline part exactly once', async () => {
    const { emailData } = await parseStagedMimeIntoEmailDetails({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      rawMime: buildSingleCidMime(),
      mailbox: 'INBOX',
      uidValidity: '1',
      uid: 42,
    });

    expect(emailData.body.html).toContain('src="cid:smoke-logo"');
    expect(emailData.body.html).not.toContain('data:image/png;base64,');

    const inlineParts = emailData.attachments.filter((a) => a.contentId === '<smoke-logo>');
    expect(inlineParts).toHaveLength(1);
    expect(inlineParts[0]).toMatchObject({ name: 'smoke-logo.png', contentType: 'image/png', isInline: true });
    expect(emailData.attachments.filter((a) => a.name === 'voicemail.wav')).toHaveLength(1);

    // Embedded extraction now yields a single CID-sourced record bound to the
    // original part, so the base attachment is marked consumed instead of
    // being persisted as a second copy.
    const extraction = extractEmbeddedImageAttachments({
      emailId: emailData.id,
      html: emailData.body.html,
      attachments: emailData.attachments,
    });
    expect(extraction.attachments).toHaveLength(1);
    expect(extraction.attachments[0]).toMatchObject({
      source: 'cid',
      name: 'smoke-logo.png',
      providerAttachmentId: inlineParts[0].id,
    });
    expect(extraction.attachments.filter((a) => a.source === 'data-url')).toHaveLength(0);
  });

  it('exports the option every inbound parse site uses', () => {
    expect(INBOUND_MIME_PARSE_OPTIONS).toEqual({ keepCidLinks: true });
  });
});

// ---------------------------------------------------------------------------
// V2 header propagation (parity with V1's header bag)
// ---------------------------------------------------------------------------

const ALIGNED_AUTH =
  'mx.example-mta.com; dkim=pass header.d=sender.example; spf=pass smtp.mailfrom=alice@sender.example; dmarc=pass header.from=sender.example';
const FORGED_AUTH = 'relay.example; dkim=pass header.d=evil.example; dmarc=pass header.from=evil.example';

function mime(lines: string[]): Buffer {
  return Buffer.from([...lines, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'hello', ''].join('\r\n'));
}

async function stage(rawMime: Buffer, providerType: 'imap' | 'microsoft' = 'imap') {
  const { emailData } = await parseStagedMimeIntoEmailDetails({
    tenant: 'tenant-1',
    providerId: 'provider-1',
    providerType,
    rawMime,
    mailbox: 'INBOX',
    uidValidity: '1',
    uid: 7,
  });
  return emailData;
}

const directMime = () =>
  mime([
    `Authentication-Results: ${ALIGNED_AUTH}`,
    `Authentication-Results: ${FORGED_AUTH}`,
    'From: Alice <alice@sender.example>',
    'To: support@example.test',
    'Subject: Re: help',
    'Message-ID: <direct@sender.example>',
  ]);

const listMime = () =>
  mime([
    'Authentication-Results: mx.example-mta.com; dkim=pass header.i=@vendor.example; spf=pass smtp.mailfrom=jane.doe@vendor.example; dmarc=pass header.from=vendor.example',
    'X-BeenThere: support@lists.example.com',
    'List-Id: <support.lists.example.com>',
    'X-Original-Sender: jane.doe@vendor.example',
    "From: 'Jane Doe' via support <support@lists.example.com>",
    'To: support@lists.example.com',
    'Subject: list mail',
    'Message-ID: <list@lists.example.com>',
  ]);

const msMime = () =>
  mime([
    'X-MS-Exchange-Organization-AuthAs: Internal',
    'From: Tech <tech@msp.example>',
    'To: support@msp.example',
    'Subject: internal',
    'Message-ID: <ms@msp.example>',
  ]);

describe('V2 stager propagates the MIME header bag', () => {
  it('T1: both Authentication-Results blocks arrive newline-joined in wire order and sender auth evaluates', async () => {
    const emailData = await stage(directMime());
    const joined = emailData.headers?.['authentication-results'];
    expect(joined).toBeDefined();
    const blocks = String(joined).split('\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('header.from=sender.example');
    expect(blocks[1]).toContain('header.from=evil.example');

    const auth = verifySenderAuthentication(joined, emailData.from.email);
    expect(auth).not.toBeNull();
    expect(auth?.aligned.dkim).toBe(true);
    expect(allowsContactSenderAttribution(auth)).toBe(true);
  });

  it('T2: wire X-Resolved-*/X-List-* are stripped while sibling wire headers survive; From unchanged', async () => {
    const emailData = await stage(
      mime([
        'X-Resolved-Original-Sender: ceo@evil.example',
        'X-List-Address: list@evil.example',
        `Authentication-Results: ${ALIGNED_AUTH}`,
        'From: Alice <alice@sender.example>',
        'To: support@example.test',
        'Subject: forged stamp',
        'Message-ID: <forged@sender.example>',
      ])
    );
    // Sibling header proves the bag is populated at all (otherwise absence is trivial).
    expect(emailData.headers?.subject).toBe('forged stamp');
    expect(emailData.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(emailData.headers).not.toHaveProperty('x-list-address');
    expect(emailData.from).toEqual({ email: 'alice@sender.example', name: 'Alice' });
  });

  it('T3: a verified list rewrite recovers the author and sets the resolved stamps', async () => {
    const emailData = await stage(listMime());
    expect(emailData.from.email).toBe('jane.doe@vendor.example');
    expect(emailData.headers?.['x-resolved-original-sender']).toBe('jane.doe@vendor.example');
    expect(emailData.headers?.['x-list-address']).toBe('support@lists.example.com');
  });

  it('T4: V2 output deep-equals resolveInboundHeaders over the same parse (V1 parity)', async () => {
    for (const raw of [directMime(), listMime(), msMime()]) {
      const emailData = await stage(raw);
      const resolved = resolveInboundHeaders(await simpleParser(raw, INBOUND_MIME_PARSE_OPTIONS));
      expect(emailData.headers).toEqual(resolved.headers);
      expect(emailData.from).toEqual(resolved.from);
    }
  });

  it('T5: Microsoft intra-org mail is recognised on V2 output', async () => {
    const emailData = await stage(msMime(), 'microsoft');
    expect(isMicrosoftIntraOrgSender('microsoft', emailData.headers)).toBe(true);
  });
});
