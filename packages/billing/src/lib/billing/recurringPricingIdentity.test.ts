import { describe, expect, it } from 'vitest';
import type { IBillingCharge } from '@alga-psa/types';
import {
  bindRecurringPricingSources,
  findStaleRecurringPricingSources,
  recurringPricingSourceKey,
  type IExpectedRecurringPricingSource,
} from './recurringPricingIdentity';

function expectedSource(
  overrides: Partial<IExpectedRecurringPricingSource> = {},
): IExpectedRecurringPricingSource {
  return {
    clientContractLineId: 'line-1',
    configId: 'config-1',
    serviceId: 'service-1',
    servicePeriodStart: '2023-02-01',
    servicePeriodEnd: '2023-03-01',
    quantity: 23,
    revisionId: 'revision-1',
    version: 1,
    pricePolicy: 'catalog',
    unitRateCents: 10000,
    effectivePeriodStart: '2023-02-01',
    catalogPriceId: 'price-1',
    catalogEffectiveDate: '2023-01-01',
    ...overrides,
  };
}

function charge(
  overrides: Partial<IBillingCharge> = {},
): IBillingCharge {
  return {
    client_contract_line_id: 'line-1',
    config_id: 'config-1',
    serviceId: 'service-1',
    servicePeriodStart: '2023-02-01',
    servicePeriodEnd: '2023-03-01',
    quantity: 23,
    recurringPricingSource: {
      revisionId: 'revision-1',
      version: 1,
      pricePolicy: 'catalog',
      unitRateCents: 10000,
      effectivePeriodStart: '2023-02-01',
      catalogPriceId: 'price-1',
      catalogEffectiveDate: '2023-01-01',
    },
    ...overrides,
  } as unknown as IBillingCharge;
}

describe('recurringPricingIdentity', () => {
  it('binds the obligation key and quantity onto a scheduled charge provenance', () => {
    const bound = bindRecurringPricingSources([charge()]);
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({
      clientContractLineId: 'line-1',
      configId: 'config-1',
      serviceId: 'service-1',
      quantity: 23,
      revisionId: 'revision-1',
      version: 1,
    });
  });

  it('ignores legacy charges that were not priced by a revision', () => {
    const bound = bindRecurringPricingSources([
      charge({ recurringPricingSource: null }),
      charge({ serviceId: 'service-2', recurringPricingSource: undefined }),
      charge({ serviceId: null as unknown as string }),
    ]);
    expect(bound).toEqual([]);
  });

  it('accepts an unchanged reviewed revision and catalog identity', () => {
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current: bindRecurringPricingSources([charge()]),
    });
    expect(stale).toEqual([]);
  });

  it('rejects a bumped revision version', () => {
    const current = bindRecurringPricingSources([
      charge({
        quantity: 25,
        recurringPricingSource: {
          ...charge().recurringPricingSource!,
          version: 2,
        },
      }),
    ]);
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].serviceId).toBe('service-1');
    expect(stale[0].reason).toMatch(/revision or catalog price/i);
  });

  it('rejects a switched price policy even at the same version', () => {
    const current = bindRecurringPricingSources([
      charge({
        recurringPricingSource: {
          ...charge().recurringPricingSource!,
          pricePolicy: 'override',
          unitRateCents: 11000,
        },
      }),
    ]);
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current,
    });
    expect(stale).toHaveLength(1);
  });

  it('rejects a moved inherited catalog price identity', () => {
    const current = bindRecurringPricingSources([
      charge({
        recurringPricingSource: {
          ...charge().recurringPricingSource!,
          catalogPriceId: 'price-2',
          catalogEffectiveDate: '2023-02-01',
        },
      }),
    ]);
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current,
    });
    expect(stale).toHaveLength(1);
  });

  it('rejects a quantity change at the same revision', () => {
    const current = bindRecurringPricingSources([charge({ quantity: 25 })]);
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toMatch(/quantity/i);
  });

  it('rejects a reviewed source that is no longer billed', () => {
    const stale = findStaleRecurringPricingSources({
      expected: [expectedSource()],
      current: [],
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toMatch(/no longer billed/i);
  });

  it('rejects a newly billed scheduled source that was not reviewed', () => {
    const stale = findStaleRecurringPricingSources({
      expected: [],
      current: bindRecurringPricingSources([charge()]),
    });
    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toMatch(/not in the reviewed preview/i);
  });

  it('keys sources by obligation, config, service and covered window', () => {
    expect(recurringPricingSourceKey(expectedSource())).toBe(
      recurringPricingSourceKey(expectedSource()),
    );
    expect(recurringPricingSourceKey(expectedSource())).not.toBe(
      recurringPricingSourceKey(expectedSource({ configId: 'config-2' })),
    );
    expect(recurringPricingSourceKey(expectedSource())).not.toBe(
      recurringPricingSourceKey(
        expectedSource({ servicePeriodEnd: '2023-04-01' }),
      ),
    );
  });
});
