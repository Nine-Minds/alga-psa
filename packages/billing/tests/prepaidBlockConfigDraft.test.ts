import { describe, expect, it } from 'vitest';
import {
  defaultBlockPriceMinor,
  draftFromConfig,
  draftToInput,
  emptyPrepaidBlockDraft,
  hoursTextToMinutes,
  majorToMinor,
  minorToMajor,
  minutesToHoursText,
} from '../src/components/billing-dashboard/contracts/prepaidBlockConfigDraft';

describe('prepaid block config draft helpers', () => {
  it('converts hours text to whole minutes, allowing fractions and a decimal comma', () => {
    expect(hoursTextToMinutes('40')).toBe(2400);
    expect(hoursTextToMinutes('1.5')).toBe(90);
    expect(hoursTextToMinutes('1,5')).toBe(90);
    expect(hoursTextToMinutes('0')).toBeNull();
    expect(hoursTextToMinutes('')).toBeNull();
    expect(hoursTextToMinutes('abc')).toBeNull();
    // 1/3 hour is not a whole number of minutes.
    expect(hoursTextToMinutes('0.3333333')).toBeNull();
    expect(minutesToHoursText(90)).toBe('1.5');
    expect(minutesToHoursText(2400)).toBe('40');
  });

  it('defaults the price to hours x the hourly rate in minor units but only when both are known', () => {
    expect(defaultBlockPriceMinor('40', 11000)).toBe(440000);
    expect(defaultBlockPriceMinor('1.5', 11000)).toBe(16500);
    expect(defaultBlockPriceMinor('40', undefined)).toBeUndefined();
    expect(defaultBlockPriceMinor('40', 0)).toBeUndefined();
    expect(defaultBlockPriceMinor('x', 11000)).toBeUndefined();
  });

  it('always submits the price explicitly, whether defaulted or typed', () => {
    const defaulted = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '40' }, 11000);
    expect(defaulted).toMatchObject({ input: { block_minutes: 2400, block_price: 440000 } });
    const typed = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '40', priceManual: true, priceMinor: 400000 }, 11000);
    expect(typed).toMatchObject({ input: { block_price: 400000 } });
    const free = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '2', priceManual: true, priceMinor: 0 }, undefined);
    expect(free).toMatchObject({ input: { block_price: 0 } });
  });

  it('reports every invalid field and forces trigger_on_expiry off without an expiry', () => {
    const bad = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '', expiryMonths: '121', thresholdPercent: '100' }, undefined);
    expect(bad).toEqual({ errors: ['hoursInvalid', 'priceInvalid', 'expiryInvalid', 'thresholdInvalid'] });
    const noExpiry = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '10', expiryMonths: '', triggerOnExpiry: true }, 5000);
    expect(noExpiry).toMatchObject({ input: { expiry_months: null, trigger_on_expiry: false } });
  });

  it('round-trips a stored config and converts money by the currency fraction digits', () => {
    const draft = draftFromConfig({
      tenant: 't', contract_line_id: 'l', block_minutes: 90, block_price: 16500, sold_as_service_id: 's',
      expiry_months: null, trigger_on_exhaustion: true, trigger_threshold_percent: 80, trigger_on_expiry: false,
      trigger_on_renewal: true, replenishment_tier: 'auto_issue',
    } as any);
    expect(draft).toMatchObject({ hours: '1.5', priceMinor: 16500, priceManual: true, expiryMonths: '', thresholdPercent: '80', triggerOnRenewal: true });
    expect(draftToInput(draft, undefined)).toMatchObject({
      input: { block_minutes: 90, block_price: 16500, expiry_months: null, trigger_threshold_percent: 80, replenishment_tier: 'auto_issue' },
    });
    expect(minorToMajor(16500, 'EUR', 'en-US')).toBe(165);
    expect(majorToMinor(165, 'EUR', 'en-US')).toBe(16500);
    expect(minorToMajor(1650, 'JPY', 'en-US')).toBe(1650);
    expect(majorToMinor(1650, 'JPY', 'en-US')).toBe(1650);
  });
});
