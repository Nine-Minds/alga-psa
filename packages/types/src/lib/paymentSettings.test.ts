import { describe, expect, it } from 'vitest';
import { DEFAULT_PAYMENT_SETTINGS } from '../interfaces/payment.interfaces';
import { mergePaymentSettings } from './paymentSettings';
import { mergePaymentSettings as fromBarrel } from '@alga-psa/types';

describe('mergePaymentSettings', () => {
  it('is exported from the package barrel', () => {
    expect(fromBarrel).toBe(mergePaymentSettings);
  });

  it.each([null, undefined, 42, true, [], 'not json', '{bad', '"str"', 'null'])(
    'returns defaults for %j',
    (stored) => {
      expect(mergePaymentSettings(stored)).toEqual(DEFAULT_PAYMENT_SETTINGS);
    }
  );

  it('overlays stored object values on defaults', () => {
    const result = mergePaymentSettings({ paymentLinkExpirationHours: 720, autopayEnabled: true });
    expect(result.paymentLinkExpirationHours).toBe(720);
    expect(result.autopayEnabled).toBe(true);
    expect(result.autopayRetryDays).toEqual(DEFAULT_PAYMENT_SETTINGS.autopayRetryDays);
  });

  it('parses a JSON string payload', () => {
    const result = mergePaymentSettings(JSON.stringify({ sendPaymentConfirmations: false, autopayConsentText: 'hi' }));
    expect(result.sendPaymentConfirmations).toBe(false);
    expect(result.autopayConsentText).toBe('hi');
  });

  it('keeps unknown keys', () => {
    const result = mergePaymentSettings({ futureFlag: 'x' });
    expect(result.futureFlag).toBe('x');
  });

  it('lets patch values win over stored and defaults', () => {
    const result = mergePaymentSettings(
      { paymentLinkExpirationHours: 720, autopayEnabled: true },
      { paymentLinkExpirationHours: 24, autopayEnabled: false }
    );
    expect(result.paymentLinkExpirationHours).toBe(24);
    expect(result.autopayEnabled).toBe(false);
  });

  it('does not mutate defaults or stored input', () => {
    const stored = { autopayEnabled: true };
    mergePaymentSettings(stored, { autopayRetryDays: [1] });
    expect(stored).toEqual({ autopayEnabled: true });
    expect(DEFAULT_PAYMENT_SETTINGS.autopayRetryDays).toEqual([3, 5, 7]);
  });
});
