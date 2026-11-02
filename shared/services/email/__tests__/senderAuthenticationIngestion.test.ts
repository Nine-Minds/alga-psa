import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { mapParsedMimeToEmailMessageDetails } from '../unifiedInboundEmailQueueJobProcessor';
import { isInternalAttributionTrusted } from '../../../lib/email/senderAuthVerification';

async function mapMime(provider: 'microsoft' | 'imap', headers: string[]) {
  const raw = Buffer.from([
    'From: Agent <agent@msp.test>',
    'To: support@example.test',
    'Subject: Re: Ticket',
    ...headers,
    '',
    'Reply content',
  ].join('\r\n'));
  const parsed = await simpleParser(raw);
  return mapParsedMimeToEmailMessageDetails({
    provider,
    providerId: 'provider-1',
    tenant: 'tenant-1',
    rawMimeBuffer: raw,
    parsed,
    fallbackMessageId: 'message-1',
  });
}

describe('Microsoft MIME sender-auth ingestion', () => {
  const authSource = 'VI1EUR05FT022.eop-eur05.prod.protection.outlook.com';

  it('feeds the topmost Exchange receiver pass into the internal attribution decision', async () => {
    const details = await mapMime('microsoft', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=pass header.from=msp.test',
      'Authentication-Results: relay.example; dmarc=fail header.from=msp.test',
    ]);
    expect(details.senderAuthentication?.authenticationResults).toHaveLength(2);
    expect(isInternalAttributionTrusted(details.senderAuthentication, details.from.email)).toBe(true);
  });

  it('does not search below a trusted Exchange fail for a forged pass', async () => {
    const details = await mapMime('microsoft', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=fail header.from=msp.test',
      'Authentication-Results: attacker.test; dmarc=pass header.from=msp.test',
    ]);
    expect(isInternalAttributionTrusted(details.senderAuthentication, details.from.email)).toBe(false);
  });

  it('rejects forged receiver identifiers, missing AuthSource, and generic IMAP assertions', async () => {
    const forged = await mapMime('microsoft', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: attacker.test; dmarc=pass header.from=msp.test',
    ]);
    expect(isInternalAttributionTrusted(forged.senderAuthentication, forged.from.email)).toBe(false);

    const missingReceiver = await mapMime('microsoft', [
      'Authentication-Results: dmarc=pass header.from=msp.test',
    ]);
    expect(isInternalAttributionTrusted(missingReceiver.senderAuthentication, missingReceiver.from.email)).toBe(false);

    const ambiguousAuthSource = await mapMime('microsoft', [
      'X-MS-Exchange-Organization-AuthSource: attacker.test',
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: dmarc=pass header.from=msp.test',
    ]);
    expect(isInternalAttributionTrusted(ambiguousAuthSource.senderAuthentication, ambiguousAuthSource.from.email)).toBe(false);

    const imap = await mapMime('imap', [
      `X-MS-Exchange-Organization-AuthSource: ${authSource}`,
      'Authentication-Results: mx.google.com; dmarc=pass header.from=msp.test',
    ]);
    expect(imap.senderAuthentication).toBeUndefined();
    expect(isInternalAttributionTrusted(imap.senderAuthentication, imap.from.email)).toBe(false);
  });
});
