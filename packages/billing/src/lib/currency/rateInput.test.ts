import { describe, expect, it } from 'vitest';

import {
  minorUnitsToRateText,
  rateInputStep,
  rateTextToMinorUnits,
  rescaleRateToCurrency,
} from './rateInput';

describe('catalog rate inputs follow the currency exponent', () => {
  it('banks a typed rate in the currency\'s own minor units', () => {
    expect(rateTextToMinorUnits('50', 'USD')).toBe(5000);
    // The reported bug: 50 yen was banked as 5000 and billed as ¥5,000.
    expect(rateTextToMinorUnits('50', 'JPY')).toBe(50);
    expect(rateTextToMinorUnits('50', 'KWD')).toBe(50000);
    expect(rateTextToMinorUnits('12.5', 'USD')).toBe(1250);
    expect(rateTextToMinorUnits('', 'USD')).toBe(0);
  });

  it('prints stored minor units with the currency\'s digit count', () => {
    expect(minorUnitsToRateText(5000, 'USD')).toBe('50.00');
    expect(minorUnitsToRateText(50, 'JPY')).toBe('50');
    expect(minorUnitsToRateText(50000, 'KWD')).toBe('50.000');
    expect(minorUnitsToRateText(Number.NaN, 'USD')).toBe('0.00');
  });

  it('round-trips an edited rate', () => {
    for (const currency of ['USD', 'JPY', 'KWD']) {
      expect(rateTextToMinorUnits(minorUnitsToRateText(rateTextToMinorUnits('123.456', currency), currency), currency))
        .toBe(rateTextToMinorUnits('123.456', currency));
    }
  });

  it('keeps the typed amount when a row switches currency', () => {
    expect(rescaleRateToCurrency(5000, 'USD', 'JPY')).toBe(50);
    expect(rescaleRateToCurrency(50, 'JPY', 'USD')).toBe(5000);
    expect(rescaleRateToCurrency(5000, 'USD', 'USD')).toBe(5000);
  });

  it('steps whole units on a zero-decimal currency', () => {
    expect(rateInputStep('USD')).toBe('0.01');
    expect(rateInputStep('JPY')).toBe('1');
    expect(rateInputStep('KWD')).toBe('0.001');
  });
});
