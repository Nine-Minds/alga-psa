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
});
