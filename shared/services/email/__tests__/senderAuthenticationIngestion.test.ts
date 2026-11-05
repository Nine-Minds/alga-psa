import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { mapParsedMimeToEmailMessageDetails } from '../unifiedInboundEmailQueueJobProcessor';

async function mapMime(provider: 'microsoft' | 'imap', headers: string[]) {
  const raw = Buffer.from([
    'From: Agent <agent@msp.test>', 'To: support@example.test', 'Subject: Re: Ticket',
    ...headers, '', 'Reply content',
  ].join('\r\n'));
  const parsed = await simpleParser(raw);
  return mapParsedMimeToEmailMessageDetails({
    provider, providerId: 'provider-1', tenant: 'tenant-1', rawMimeBuffer: raw, parsed, fallbackMessageId: 'message-1',
  });
}

describe('Microsoft MIME sender-auth ingestion', () => {
  const authSource = 'VI1EUR05FT022.eop-eur05.prod.protection.outlook.com';

  it('keeps MIME authentication claims diagnostic when Graph mailbox evidence is absent', async () => {
    const details = await mapMime('microsoft', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=pass header.from=msp.test',
      'Authentication-Results: relay.example; dmarc=fail header.from=msp.test',
    ]);
    expect(details.senderAuthentication).toMatchObject({
      provider: 'microsoft', internalAttributionTrusted: false, contactAttributionTrusted: false,
      mailboxEvidence: 'mailbox_confirmation_required', dkim: { verified: false },
    });
  });

  it('uses the authenticated Graph sender mailbox even when MIME From represents another sender', async () => {
    const raw = Buffer.from('From: Agent <agent@msp.test>\r\nTo: support@example.test\r\n\r\nReply');
    const parsed = await simpleParser(raw);
    const matched = await mapParsedMimeToEmailMessageDetails({ provider: 'microsoft', providerId: 'p', tenant: 't', rawMimeBuffer: raw, parsed, fallbackMessageId: 'm1', authenticatedSenderEmail: 'Agent@msp.test' });
    const mismatch = await mapParsedMimeToEmailMessageDetails({ provider: 'microsoft', providerId: 'p', tenant: 't', rawMimeBuffer: raw, parsed, fallbackMessageId: 'm2', authenticatedSenderEmail: 'attacker@msp.test' });
    expect(matched.senderAuthentication).toMatchObject({ internalAttributionTrusted: true, authenticatedMailbox: 'agent@msp.test', mailboxEvidence: 'provider_sender_match' });
    expect(mismatch.senderAuthentication).toMatchObject({ internalAttributionTrusted: true, authenticatedMailbox: 'attacker@msp.test', mailboxEvidence: 'provider_sender_match' });
  });

  it.each([
    ['missing AuthSource', ['Authentication-Results: dmarc=pass header.from=msp.test']],
    ['spoofed organization metadata', [
      'X-MS-Exchange-Organization-AuthSource: attacker.test',
      'X-MS-Exchange-Organization-AuthAs: Internal',
      'Authentication-Results: dmarc=pass header.from=msp.test',
    ]],
    ['ambiguous AuthSource', [
      'X-MS-Exchange-Organization-AuthSource: attacker.test',
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=pass header.from=msp.test',
    ]],
  ])('fails closed for %s', async (_case, headers) => {
    const details = await mapMime('microsoft', headers);
    expect(details.senderAuthentication).toMatchObject({ internalAttributionTrusted: false, contactAttributionTrusted: false });
  });

  it('does not treat IMAP Authentication-Results as verified, but retains an explicit confirmation decision', async () => {
    const details = await mapMime('imap', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: mx.google.com; dmarc=pass header.from=msp.test',
    ]);
    expect(details.senderAuthentication).toMatchObject({
      provider: 'imap', internalAttributionTrusted: false,
      mailboxEvidence: 'mailbox_confirmation_required', dkim: { verified: false },
      reasons: ['no_aligned_signature', 'no_independent_mailbox_assertion'],
    });
  });
});
