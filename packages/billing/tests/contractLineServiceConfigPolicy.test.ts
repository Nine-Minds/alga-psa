import { describe, expect, it } from 'vitest';
import { resolveContractLineServiceConfig } from '../src/lib/contractLineServiceConfigPolicy';

/**
 * One policy decides the configuration type and the per-type defaults for both
 * live contract lines and contract template lines. The line's type is the
 * billing mode, so catalog billing_method never gates the attach — see
 * ee/docs/plans/2026-03-21-service-catalog-billing-mode-decoupling.
 */

const service = (overrides: Record<string, unknown> = {}) => ({
  service_name: 'Basic Support',
  default_rate: 15000,
  billing_method: 'hourly',
  item_kind: 'service',
  ...overrides,
});

describe('contract line service configuration policy', () => {
  it('resolves any catalog billing method against the line type', () => {
    // A fixed-method service billed hourly, and an hourly one billed fixed:
    // the line decides the mode, the catalog only supplies the default rate.
    expect(
      resolveContractLineServiceConfig('Hourly', undefined, service({ billing_method: 'fixed' })),
    ).toMatchObject({ configurationType: 'Hourly', typeConfig: { hourly_rate: 15000 } });
    expect(resolveContractLineServiceConfig('Fixed', undefined, service()).configurationType).toBe('Fixed');
    expect(
      resolveContractLineServiceConfig('Usage', undefined, service({ billing_method: 'fixed' })).configurationType,
    ).toBe('Usage');
  });

  it('defaults the hourly rate and min/round from the catalog rate', () => {
    const resolved = resolveContractLineServiceConfig('Hourly', undefined, service());

    expect(resolved.configurationType).toBe('Hourly');
    expect(resolved.typeConfig).toMatchObject({
      hourly_rate: 15000,
      minimum_billable_time: 15,
      round_up_to_nearest: 15,
    });
  });

  it('keeps the caller min/round and requires a numeric hourly rate', () => {
    expect(
      resolveContractLineServiceConfig('Hourly', undefined, service(), {
        hourly_rate: 20000,
        minimum_billable_time: 30,
        round_up_to_nearest: 6,
      } as any).typeConfig,
    ).toMatchObject({ hourly_rate: 20000, minimum_billable_time: 30, round_up_to_nearest: 6 });

    expect(() =>
      resolveContractLineServiceConfig('Hourly', undefined, service({ default_rate: null })),
    ).toThrow(/requires an hourly rate/);
    expect(() =>
      resolveContractLineServiceConfig('Hourly', undefined, service({ default_rate: 'abc' })),
    ).toThrow(/must be a numeric value/);
  });

  it('defaults the bucket overage rate from the catalog rate', () => {
    const resolved = resolveContractLineServiceConfig('Hourly', 'Bucket', service());

    expect(resolved.configurationType).toBe('Bucket');
    expect(resolved.typeConfig).toMatchObject({ overage_rate: 15000 });
  });

  it('still rejects a configuration type the line cannot carry', () => {
    expect(() => resolveContractLineServiceConfig('Hourly', 'Usage', service())).toThrow(
      /Configuration type Usage is not valid for Hourly contract lines/,
    );
  });
});
