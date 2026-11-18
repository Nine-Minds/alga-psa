import { describe, expect, it } from 'vitest';
import {
  PAYMENT_LINK_EXPIRATION_OPTIONS_HOURS,
  isValidPaymentLinkExpirationHours,
  validatePaymentSettingsInput,
} from './payment.interfaces';

describe('payment link expiration validation', () => {
  it('shares one options list, all within bounds', () => {
    expect([...PAYMENT_LINK_EXPIRATION_OPTIONS_HOURS]).toEqual([24, 48, 72, 168, 336, 720]);
    for (const h of PAYMENT_LINK_EXPIRATION_OPTIONS_HOURS) expect(isValidPaymentLinkExpirationHours(h)).toBe(true);
  });

  it.each([1, 720, 24])('accepts %s', (hours) => {
    expect(validatePaymentSettingsInput({ paymentLinkExpirationHours: hours })).toBeNull();
  });

  it.each([0, 721, 1.5, -1, NaN, Infinity, '24', '', null, '720abc', {}])('rejects %j', (hours) => {
    expect(validatePaymentSettingsInput({ paymentLinkExpirationHours: hours as unknown as number })).toMatch(
      /between 1 and 720/,
    );
  });

  it('ignores payloads that do not touch the expiration', () => {
    expect(validatePaymentSettingsInput({ paymentLinksInEmails: false })).toBeNull();
    expect(validatePaymentSettingsInput(undefined)).toBeNull();
  });
});
