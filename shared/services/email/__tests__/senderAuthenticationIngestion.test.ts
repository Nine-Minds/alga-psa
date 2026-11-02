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

  it('fails closed even when MIME claims passing results and a Microsoft AuthSource', async () => {
    const details = await mapMime('microsoft', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=pass header.from=msp.test',
      'Authentication-Results: relay.example; dmarc=fail header.from=msp.test',
    ]);
    expect(details.senderAuthentication).toEqual({
      provider: 'microsoft', internalAttributionTrusted: false, contactAttributionTrusted: false,
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
    expect(details.senderAuthentication).toMatchObject({ internalAttributionTrusted: false, contactAttributionTrusted: false });
  });

  it('does not grant trust to Authentication-Results received through generic IMAP', async () => {
    const details = await mapMime('imap', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: mx.google.com; dmarc=pass header.from=msp.test',
    ]);
    expect(details.senderAuthentication).toBeUndefined();
  });
});
