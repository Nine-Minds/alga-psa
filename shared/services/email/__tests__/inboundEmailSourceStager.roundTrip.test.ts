import { describe, expect, it, vi } from 'vitest';

// In-memory object store standing in for the durable source bucket.
const objects = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: async () => ({
      exists: async (key: string) => objects.has(key),
      upload: async (body: Buffer, key: string) => {
        objects.set(key, Buffer.from(body));
      },
      download: async (key: string) => {
        const body = objects.get(key);
        if (!body) throw new Error(`missing object ${key}`);
        return Buffer.from(body);
      },
    }),
  },
}));

import {
  parseStagedMimeIntoEmailDetails,
  readStagedSourceMime,
  stageInboundSourceMime,
} from '../inboundEmailSourceStager';
import { allowsContactSenderAttribution, verifySenderAuthentication } from '../../../lib/email/senderAuthVerification';

const ALIGNED_AUTH =
  'mx.example-mta.com; dkim=pass header.d=sender.example; spf=pass smtp.mailfrom=alice@sender.example; dmarc=pass header.from=sender.example';
const FORGED_AUTH = 'relay.example; dkim=pass header.d=evil.example; dmarc=pass header.from=evil.example';

describe('V2 durable staging round trip keeps the header bag', () => {
  it('stage -> read back -> parse yields the same Authentication-Results bag and an evaluable sender auth', async () => {
    const rawMime = Buffer.from(
      [
        `Authentication-Results: ${ALIGNED_AUTH}`,
        `Authentication-Results: ${FORGED_AUTH}`,
        'X-Resolved-Original-Sender: ceo@evil.example',
        'From: Alice <alice@sender.example>',
        'To: support@example.test',
        'Subject: Re: help',
        'Message-ID: <round-trip@sender.example>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'hello',
        '',
      ].join('\r\n')
    );

    const staged = await stageInboundSourceMime({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      normalizedMessageId: 'round-trip@sender.example',
      rawMime,
    });
    expect(staged.uploaded).toBe(true);

    const readBack = await readStagedSourceMime({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      objectKey: staged.objectKey,
      expectedSha256: staged.sha256,
    });

    const { emailData } = await parseStagedMimeIntoEmailDetails({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      rawMime: readBack,
    });

    const blocks = String(emailData.headers?.['authentication-results']).split('\n');
    expect(blocks).toEqual([ALIGNED_AUTH, FORGED_AUTH]);
    expect(emailData.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(emailData.from).toEqual({ email: 'alice@sender.example', name: 'Alice' });

    const auth = verifySenderAuthentication(emailData.headers?.['authentication-results'], emailData.from.email);
    expect(auth?.aligned.dkim).toBe(true);
  });

  it('a forged lower Authentication-Results claiming the From domain cannot flip a failing topmost verdict', async () => {
    const rawMime = Buffer.from(
      [
        'Authentication-Results: mx.example-mta.com; dkim=fail header.d=sender.example; spf=fail smtp.mailfrom=alice@sender.example; dmarc=fail header.from=sender.example',
        'Authentication-Results: relay.example; dkim=pass header.d=sender.example; spf=pass smtp.mailfrom=alice@sender.example; dmarc=pass header.from=sender.example',
        'From: Alice <alice@sender.example>',
        'To: support@example.test',
        'Subject: forged lower block',
        'Message-ID: <forged-lower@sender.example>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'hello',
        '',
      ].join('\r\n')
    );
    const staged = await stageInboundSourceMime({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      normalizedMessageId: 'forged-lower@sender.example',
      rawMime,
    });
    const { emailData } = await parseStagedMimeIntoEmailDetails({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      providerType: 'imap',
      rawMime: await readStagedSourceMime({
        tenant: 'tenant-1',
        providerId: 'provider-1',
        objectKey: staged.objectKey,
        expectedSha256: staged.sha256,
      }),
    });

    const auth = verifySenderAuthentication(emailData.headers?.['authentication-results'], emailData.from.email);
    expect(auth).not.toBeNull();
    expect(auth?.aligned).toEqual({ spf: false, dkim: false, dmarc: false });
    expect(allowsContactSenderAttribution(auth)).toBe(false);
  });
});
