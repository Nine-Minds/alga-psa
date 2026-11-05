import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { dkimSign } from 'mailauth';
import {
  allowsContactSenderAttribution,
  allowsInternalSenderAttribution,
  verifySenderAuthentication,
  verifyProviderSenderAuthentication,
  orderedAuthenticationResults,
  isInternalAttributionTrusted,
  verifyOriginalMimeDkim,
} from '../senderAuthVerification';

describe('verifySenderAuthentication', () => {
  it('uses aligned passing results for both contact and internal attribution', () => {
    const result = verifySenderAuthentication(
      'mx.example; spf=pass smtp.mailfrom=mailer.example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      'tech@example.com'
    );
    expect(result?.aligned).toEqual({ spf: true, dkim: true, dmarc: true });
    expect(allowsContactSenderAttribution(result)).toBe(true);
    expect(allowsInternalSenderAttribution(result)).toBe(true);
  });

  it('fails closed when the header is absent or has no authentication methods', () => {
    expect(verifySenderAuthentication(undefined, 'tech@example.com')).toBeNull();
    expect(verifySenderAuthentication('mx.example; arc=pass', 'tech@example.com')).toBeNull();
  });

  it('requires both SPF and DKIM when DMARC is not aligned for internal users', () => {
    const result = verifySenderAuthentication(
      'mx.example; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=unrelated.test; dmarc=fail header.from=example.com',
      'tech@example.com'
    );
    expect(allowsContactSenderAttribution(result)).toBe(true);
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });

  it('uses the topmost MTA result, not an attacker-injected trailing result', () => {
    const result = verifySenderAuthentication([
      'our-mta.example; dmarc=fail header.from=example.com',
      'attacker.example; dmarc=pass header.from=example.com',
    ], 'tech@example.com');
    expect(result?.dmarc).toBe('fail');
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });

  it('does not align a public-suffix parent domain', () => {
    const result = verifySenderAuthentication(
      'mx.example; dkim=pass header.d=com',
      'tech@example.com'
    );
    expect(result?.aligned.dkim).toBe(false);
  });

  it('parses a real Google Authentication-Results header (ticket alga0002339)', () => {
    const result = verifySenderAuthentication(
      `mx.google.com;
       dkim=pass header.i=@techff.onmicrosoft.com header.s=selector1-techff-onmicrosoft-com header.b="cmLi/gLS";
       arc=pass (i=1 spf=pass spfdomain=joymode.io dkim=pass dkdomain=joymode.io dmarc=pass fromdomain=joymode.io);
       spf=pass (google.com: domain of munjal@joymode.io designates 2a01:111:f403:c005::5 as permitted sender) smtp.mailfrom=munjal@joymode.io`,
      'munjal@joymode.io'
    );
    expect(result?.spf).toBe('pass');
    expect(result?.dkim).toBe('pass');
    expect(result?.dmarc).toBeNull();
    // smtp.mailfrom is a full address; only its domain aligns with the From domain.
    expect(result?.aligned.spf).toBe(true);
    // Signer domain (onmicrosoft.com) never matches joymode.io; header.i must not fabricate alignment.
    expect(result?.aligned.dkim).toBe(false);
    expect(result?.aligned.dmarc).toBe(false);
    expect(allowsContactSenderAttribution(result)).toBe(true);
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });

  it('aligns DKIM via header.i when header.d is absent and the signer matches the From domain', () => {
    const result = verifySenderAuthentication(
      'mx.google.com; dkim=pass header.i=@joymode.io header.s=selector1-joymode-io header.b="abc"; spf=pass smtp.mailfrom=joymode.io',
      'munjal@joymode.io'
    );
    expect(result?.aligned.dkim).toBe(true);
    expect(allowsContactSenderAttribution(result)).toBe(true);
    expect(allowsInternalSenderAttribution(result)).toBe(true);
  });

  it('does not treat comment text inside arc=pass (...) as top-level results', () => {
    const result = verifySenderAuthentication(
      'mx.google.com; arc=pass (i=1 spf=pass spfdomain=joymode.io dkim=pass dkdomain=joymode.io dmarc=pass fromdomain=joymode.io)',
      'munjal@joymode.io'
    );
    // No top-level mechanism survives comment stripping: fail closed.
    expect(result).toBeNull();
    expect(allowsContactSenderAttribution(result)).toBe(false);
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });

  it('keeps parsing a topmost block when later blocks are present in a single string', () => {
    const result = verifySenderAuthentication(
      'our-mta.example; dmarc=fail header.from=example.com\nattacker.example; dmarc=pass header.from=example.com',
      'tech@example.com'
    );
    expect(result?.dmarc).toBe('fail');
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });
});

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
});

describe('verifyProviderSenderAuthentication', () => {
  it('accepts an ingestion decision only from the provider with a proven boundary', () => {
    expect(isInternalAttributionTrusted({ provider: 'google', internalAttributionTrusted: true })).toBe(true);
    expect(isInternalAttributionTrusted({ provider: 'microsoft', internalAttributionTrusted: true })).toBe(true);
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
  it('accepts a unique Google receiver assertion', () => {
    expect(allowsInternalSenderAttribution(verifyProviderSenderAuthentication({
      provider: 'google', authenticationResults: ['mx.google.com; dmarc=pass header.from=msp.test'],
    }, 'agent@msp.test'))).toBe(true);
  });

  it('uses the topmost trusted fail and never falls through to a forged transit pass', () => {
    const result = verifyProviderSenderAuthentication({ provider: 'google', authenticationResults: [
      'mx.google.com; dmarc=fail header.from=msp.test',
      'attacker.test; dmarc=pass header.from=msp.test',
    ] }, 'agent@msp.test');
    expect(allowsInternalSenderAttribution(result)).toBe(false);
  });

  it('uses the topmost trusted pass while retaining older transit results', () => {
    const result = verifyProviderSenderAuthentication({ provider: 'google', authenticationResults: [
      'mx.google.com; dmarc=pass header.from=msp.test',
      'relay.example; dmarc=fail header.from=msp.test',
    ] }, 'agent@msp.test');
    expect(allowsInternalSenderAttribution(result)).toBe(true);
  });

  it('does not search past an untrusted topmost identifier for a lower provider result', () => {
    expect(verifyProviderSenderAuthentication({ provider: 'google', authenticationResults: [
      'attacker.test; dmarc=pass header.from=msp.test',
      'mx.google.com; dmarc=pass header.from=msp.test',
    ] }, 'agent@msp.test')).toBeNull();
  });

  it('never treats Microsoft MIME headers, including AuthSource, as verified provenance', () => {
    for (const receivingAuthservId of [
      'VI1EUR05FT022.eop-eur05.prod.protection.outlook.com', 'attacker.test', undefined,
    ]) {
      expect(verifyProviderSenderAuthentication({
        provider: 'microsoft',
        authenticationResults: ['dmarc=pass header.from=msp.test'],
        receivingAuthservId,
      }, 'agent@msp.test')).toBeNull();
    }
  });

  it('rejects a forged explicit Microsoft authserv-id even when AuthSource is trusted', () => {
    expect(verifyProviderSenderAuthentication({
      provider: 'microsoft',
      authenticationResults: ['attacker.test; dmarc=pass header.from=msp.test'],
      receivingAuthservId: 'VI1EUR05FT022.eop-eur05.prod.protection.outlook.com',
    }, 'agent@msp.test')).toBeNull();
  });

  it.each([
    ['untrusted authserv', ['attacker.test; dmarc=pass header.from=msp.test']],
    ['mismatched authserv', ['mx.google.com.evil.test; dmarc=pass header.from=msp.test']],
    ['malformed assertion', ['mx.google.com; dmarc=pass header.from=']],
  ])('fails closed for %s', (_name, authenticationResults) => {
    expect(allowsInternalSenderAttribution(verifyProviderSenderAuthentication({ provider: 'google', authenticationResults }, 'agent@msp.test'))).toBe(false);
  });

  it('does not trust generic IMAP or absent provider provenance', () => {
    expect(verifyProviderSenderAuthentication(undefined, 'agent@msp.test')).toBeNull();
  });
});
