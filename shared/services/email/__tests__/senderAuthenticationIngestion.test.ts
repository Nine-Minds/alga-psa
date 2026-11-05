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
      provider: 'microsoft',
      author: { authorization: 'confirmation_required', provenance: 'receiving_mailbox_only' },
      contact: { authorization: 'untrusted', provenance: 'missing_or_invalid_dkim' }, dkim: { verified: false },
      diagnostics: { authenticationResults: [
        'dmarc=pass header.from=msp.test',
        'relay.example; dmarc=fail header.from=msp.test',
      ] },
    });
  });

  it('does not treat Graph sender metadata or forged Sender/From and Authentication-Results as author proof', async () => {
    const raw = Buffer.from([
      'From: Agent <agent@msp.test>', 'Sender: victim@msp.test', 'To: support@example.test',
      'Authentication-Results: mx.google.com; dmarc=pass header.from=msp.test',
      'Authentication-Results: outlook.com; dkim=pass header.d=msp.test', '', 'Reply',
    ].join('\r\n'));
    const parsed = await simpleParser(raw);
    const details = await mapParsedMimeToEmailMessageDetails({ provider: 'microsoft', providerId: 'p', tenant: 't', rawMimeBuffer: raw, parsed, fallbackMessageId: 'm1' });
    expect(details.from.email).toBe('agent@msp.test');
    expect(details.senderAuthentication).toMatchObject({
      author: { authorization: 'confirmation_required' },
      contact: { authorization: 'untrusted' },
      reasons: ['no_aligned_signature', 'provider_does_not_establish_message_author_mailbox'],
    });
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
    expect(details.senderAuthentication).toMatchObject({
      author: { authorization: 'confirmation_required' }, contact: { authorization: 'untrusted' },
    });
  });

  it('does not treat IMAP Authentication-Results as verified, but retains an explicit confirmation decision', async () => {
    const details = await mapMime('imap', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: mx.google.com; dmarc=pass header.from=msp.test',
    ]);
    expect(details.senderAuthentication).toMatchObject({
      provider: 'imap', author: { authorization: 'confirmation_required' },
      contact: { authorization: 'untrusted' }, dkim: { verified: false },
      reasons: ['no_aligned_signature', 'provider_does_not_establish_message_author_mailbox'],
    });
  });
});
