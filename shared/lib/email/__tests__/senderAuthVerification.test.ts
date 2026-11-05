import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth';
import {
  orderedAuthenticationResults,
  isInternalAttributionTrusted,
  verifyOriginalMimeDkim,
} from '../senderAuthVerification';

describe('verifyOriginalMimeDkim', () => {
  it('verifies aligned signatures over original bytes and rejects signed-content tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const raw = Buffer.from('From: Agent <agent@example.com>\r\nSubject: Reply\r\n\r\nOriginal signed reply body\r\n');
    const signed = await dkimSign(raw, {
      strict: true,
      signatureData: [{ signingDomain: 'example.com', selector: 'test', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }],
    });
    const message = Buffer.concat([Buffer.from(signed.signatures), raw]);
    const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const resolver = async (name: string) => name === 'test._domainkey.example.com'
      ? [`v=DKIM1; k=rsa; p=${key}`]
      : [];

    await expect(verifyOriginalMimeDkim(message, 'agent@example.com', resolver)).resolves.toMatchObject({
      verified: true,
      alignedDomains: ['example.com'],
      reason: 'aligned_signature',
    });
    const tampered = Buffer.from(message.toString('utf8').replace('Original signed reply body', 'Altered signed reply body'));
    await expect(verifyOriginalMimeDkim(tampered, 'agent@example.com', resolver)).resolves.toMatchObject({
      verified: false,
      reason: 'no_aligned_signature',
    });
    const badSignature = Buffer.from(message.toString('utf8').replace(/(b=)[A-Za-z0-9+/=]+/, '$1AAAA'));
    await expect(verifyOriginalMimeDkim(badSignature, 'agent@example.com', resolver)).resolves.toMatchObject({
      verified: false,
      reason: 'no_aligned_signature',
    });
    await expect(verifyOriginalMimeDkim(message, 'agent@attacker.test', resolver)).resolves.toMatchObject({
      verified: false,
      reason: 'no_aligned_signature',
    });
  });

  it('reports missing signatures as insufficient evidence', async () => {
    await expect(verifyOriginalMimeDkim(Buffer.from('From: agent@example.com\r\n\r\nunsigned'), 'agent@example.com'))
      .resolves.toMatchObject({ verified: false, alignedDomains: [], reason: 'no_aligned_signature' });
  });

  it('fails closed when DNS key lookup fails', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const raw = Buffer.from('From: Agent <agent@example.com>\r\nSubject: Reply\r\n\r\nSigned reply body\r\n');
    const signed = await dkimSign(raw, {
      strict: true,
      signatureData: [{ signingDomain: 'example.com', selector: 'missing-dns', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }],
    });
    const message = Buffer.concat([Buffer.from(signed.signatures), raw]);
    await expect(verifyOriginalMimeDkim(message, 'agent@example.com', async () => { throw new Error('DNS unavailable'); }))
      .resolves.toMatchObject({ verified: false, alignedDomains: [], reason: 'no_aligned_signature' });
  });
});

describe('provider sender authentication evidence', () => {
  it('requires explicit provider-attested author provenance for internal attribution', () => {
    const receivingMailboxOnly = {
      provider: 'google' as const,
      author: { authorization: 'confirmation_required' as const, provenance: 'receiving_mailbox_only' as const },
      contact: { authorization: 'untrusted' as const, provenance: 'missing_or_invalid_dkim' as const, alignedDomains: [] as [] },
      dkim: { verified: false, alignedDomains: [], reason: 'no_aligned_signature' },
    };
    expect(isInternalAttributionTrusted(receivingMailboxOnly)).toBe(false);
    expect(isInternalAttributionTrusted({
      ...receivingMailboxOnly,
      author: { authorization: 'internal_actor_attribution', provenance: 'provider_attested_author' },
    })).toBe(true);
  });

  it('retains duplicate Gmail authentication headers in source order', () => {
    expect(orderedAuthenticationResults([
      { name: 'Authentication-Results', value: 'attacker; dmarc=pass header.from=msp.test' },
      { name: 'authentication-results', value: 'mx.google.com; dmarc=fail header.from=msp.test' },
    ])).toEqual([
      'attacker; dmarc=pass header.from=msp.test',
      'mx.google.com; dmarc=fail header.from=msp.test',
    ]);
  });
});
