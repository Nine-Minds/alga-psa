import { describe, expect, it } from 'vitest';
import {
  allowsContactSenderAttribution,
  allowsInternalSenderAttribution,
  verifySenderAuthentication,
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
});
