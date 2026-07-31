import { describe, expect, it } from 'vitest';

import {
  calculateCredits,
  resolvePricingRate,
  type PricingRecord,
} from '../../pricing/pricing.js';

function pricingRecord(overrides: Partial<PricingRecord> = {}): PricingRecord {
  return {
    pricingId: 'default-id',
    modelPattern: '*',
    inputCreditsPer1kTokens: 10n,
    outputCreditsPer1kTokens: 20n,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('pricing resolution', () => {
  const defaultRate = {
    inputCreditsPer1kTokens: 101n,
    outputCreditsPer1kTokens: 202n,
  };
  const now = new Date('2026-07-20T12:00:00.000Z');

  it('selects the most specific matching pattern before a newer generic pattern', () => {
    const result = resolvePricingRate(
      [
        pricingRecord({
          pricingId: 'generic-newer',
          modelPattern: 'gpt-*',
          inputCreditsPer1kTokens: 30n,
          effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        }),
        pricingRecord({
          pricingId: 'specific-older',
          modelPattern: 'gpt-4o*',
          inputCreditsPer1kTokens: 40n,
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        }),
        pricingRecord({
          pricingId: 'exact',
          modelPattern: 'gpt-4o-mini',
          inputCreditsPer1kTokens: 50n,
          effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ],
      'gpt-4o-mini',
      now,
      defaultRate,
    );

    expect(result).toMatchObject({
      pricingId: 'exact',
      modelPattern: 'gpt-4o-mini',
      inputCreditsPer1kTokens: 50n,
      source: 'configured',
    });
  });

  it('uses the latest effective version of an equally specific pattern and ignores future rates', () => {
    const result = resolvePricingRate(
      [
        pricingRecord({
          pricingId: 'old',
          modelPattern: 'claude-*',
          inputCreditsPer1kTokens: 10n,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        }),
        pricingRecord({
          pricingId: 'current',
          modelPattern: 'claude-*',
          inputCreditsPer1kTokens: 20n,
          effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
        }),
        pricingRecord({
          pricingId: 'future',
          modelPattern: 'claude-*',
          inputCreditsPer1kTokens: 30n,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ],
      'claude-sonnet',
      now,
      defaultRate,
    );

    expect(result.pricingId).toBe('current');
    expect(result.inputCreditsPer1kTokens).toBe(20n);
  });

  it('uses the non-zero configurable default for an unknown model', () => {
    const result = resolvePricingRate([], 'unknown/model', now, defaultRate);

    expect(result).toEqual({
      inputCreditsPer1kTokens: 101n,
      outputCreditsPer1kTokens: 202n,
      source: 'default',
      pricingId: null,
      modelPattern: null,
    });
    expect(calculateCredits({ promptTokens: 1n, completionTokens: 0n }, result)).toBe(1n);
  });

  it('rejects a zero default rate so an unknown model can never be free', () => {
    expect(() =>
      resolvePricingRate([], 'unknown/model', now, {
        inputCreditsPer1kTokens: 0n,
        outputCreditsPer1kTokens: 1n,
      }),
    ).toThrow('greater than zero');
  });
});

describe('credit calculation', () => {
  it('uses bigint arithmetic and rounds the combined rate numerator up once', () => {
    expect(
      calculateCredits(
        { promptTokens: 1_001n, completionTokens: 501n },
        { inputCreditsPer1kTokens: 11n, outputCreditsPer1kTokens: 23n },
      ),
    ).toBe(23n);
  });

  it('preserves exactness beyond the safe Number range', () => {
    const promptTokens = 9_007_199_254_740_993n;
    const rate = 9_007_199_254_740_997n;
    const expected = (promptTokens * rate + 999n) / 1_000n;

    expect(
      calculateCredits(
        { promptTokens, completionTokens: 0n },
        { inputCreditsPer1kTokens: rate, outputCreditsPer1kTokens: 1n },
      ),
    ).toBe(expected);
  });
});
