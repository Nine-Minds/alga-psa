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
