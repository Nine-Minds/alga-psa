import { describe, expect, it } from 'vitest';

import {
  calculateGraceLimit,
  parseTierConfig,
  resolveTopupPack,
} from '../../tier/tierConfig.js';

describe('tier configuration', () => {
  it('parses bigint credit amounts and calculates grace with basis points', () => {
    const config = parseTierConfig({
      monthlyIncludedCredits: '12345',
      gracePercentDefault: 1_000,
      topupPacks: [
        { priceId: 'price_small', credits: '5000' },
        { priceId: 'price_large', credits: '20000' },
      ],
      lowBalanceThresholdDefault: '250',
    });

    expect(config).toEqual({
      monthlyIncludedCredits: 12_345n,
      gracePercentBasisPoints: 1_000n,
      topupPacks: [
        { priceId: 'price_small', credits: 5_000n },
        { priceId: 'price_large', credits: 20_000n },
      ],
      lowBalanceThreshold: 250n,
    });
    expect(calculateGraceLimit(config)).toBe(1_234n);
    expect(resolveTopupPack(config, 'price_large').credits).toBe(20_000n);
  });

  it('rejects unsafe, duplicate, free, and out-of-range configuration', () => {
    const base = {
      monthlyIncludedCredits: '1000',
      gracePercentDefault: 1_000,
      topupPacks: [{ priceId: 'price_pack', credits: '100' }],
      lowBalanceThresholdDefault: '10',
    };

    expect(() => parseTierConfig({ ...base, monthlyIncludedCredits: '0' })).toThrow();
    expect(() => parseTierConfig({ ...base, gracePercentDefault: 10_001 })).toThrow();
    expect(() =>
      parseTierConfig({
        ...base,
        topupPacks: [
          { priceId: 'price_pack', credits: '100' },
          { priceId: 'price_pack', credits: '200' },
        ],
      }),
    ).toThrow('duplicate priceId');
    expect(() =>
      parseTierConfig({
        ...base,
        topupPacks: [{ priceId: 'price_pack', credits: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrow('integer string or bigint');
  });
});
