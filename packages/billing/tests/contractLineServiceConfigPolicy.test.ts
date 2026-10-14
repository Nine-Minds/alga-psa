import { describe, expect, it } from 'vitest';
import {
  assertServiceMatchesConfigurationType,
  resolveContractLineServiceConfig,
} from '../src/lib/contractLineServiceConfigPolicy';

/**
 * One policy decides the configuration type, the billing-method match and the
 * per-type defaults for both live contract lines and contract template lines.
 */

const service = (overrides: Record<string, unknown> = {}) => ({
  service_name: 'Basic Support',
  default_rate: 15000,
  billing_method: 'hourly',
  item_kind: 'service',
  ...overrides,
});

describe('contract line service configuration policy', () => {
  it('rejects a fixed-method service on hourly, usage and bucket configurations', () => {
    const fixedService = service({ service_name: 'Managed Bundle', billing_method: 'fixed' });

    for (const configurationType of ['Hourly', 'Usage', 'Bucket'] as const) {
      expect(() => assertServiceMatchesConfigurationType(configurationType, fixedService)).toThrow(
        /"Managed Bundle" is a fixed-fee service and cannot be added to/,
      );
    }
  });

  it('rejects a non-fixed service on a fixed configuration', () => {
    expect(() => assertServiceMatchesConfigurationType('Fixed', service())).toThrow(
      '"Basic Support" is an hourly service and cannot be added to a fixed fee contract line.',
    );
    expect(() =>
      assertServiceMatchesConfigurationType('Fixed', service({ billing_method: 'usage' })),
    ).toThrow(/is a usage-based service and cannot be added to a fixed fee contract line/);
  });

  it('allows a product on a fixed configuration, since products carry usage by design', () => {
    expect(() =>
      assertServiceMatchesConfigurationType('Fixed', service({ billing_method: 'usage', item_kind: 'product' })),
    ).not.toThrow();
  });

  it('allows the matching billing method on every configuration type', () => {
    expect(() => assertServiceMatchesConfigurationType('Hourly', service())).not.toThrow();
    expect(() =>
      assertServiceMatchesConfigurationType('Usage', service({ billing_method: 'usage' })),
    ).not.toThrow();
    expect(() =>
      assertServiceMatchesConfigurationType('Fixed', service({ billing_method: 'fixed' })),
    ).not.toThrow();
    // A catalog row with no billing method is left to the line's own type.
    expect(() =>
      assertServiceMatchesConfigurationType('Fixed', service({ billing_method: null })),
    ).not.toThrow();
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
