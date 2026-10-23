import { describe, expect, it } from 'vitest';
import { projectFixedServicesForSubmission } from '../src/lib/contractAuthoringSubmission';

describe('projectFixedServicesForSubmission', () => {
  it('T010: omits draft-only rate/source metadata while keeping the public fields', () => {
    const projected = projectFixedServicesForSubmission([
      {
        service_id: 'service-1',
        service_name: 'Managed endpoint',
        quantity: 3,
        bucket_overlay: undefined,
        resolved_rate: 25000,
        resolved_rate_source: 'currency-price',
      },
      {
        service_id: 'service-2',
        service_name: 'Backup',
        quantity: 1,
        bucket_overlay: { total_minutes: 600, overage_rate: 100, allow_rollover: false, billing_period: 'monthly' },
        resolved_rate: 7000,
        resolved_rate_source: 'catalog-default',
      },
    ]);

    expect(projected).toEqual([
      {
        service_id: 'service-1',
        service_name: 'Managed endpoint',
        quantity: 3,
        pricing_basis: 'bundle',
        unit_rate: undefined,
        bucket_overlay: undefined,
      },
      {
        service_id: 'service-2',
        service_name: 'Backup',
        quantity: 1,
        pricing_basis: 'bundle',
        unit_rate: undefined,
        bucket_overlay: { total_minutes: 600, overage_rate: 100, allow_rollover: false, billing_period: 'monthly' },
      },
    ]);
    for (const row of projected) {
      expect(row).not.toHaveProperty('resolved_rate');
      expect(row).not.toHaveProperty('resolved_rate_source');
    }
  });

  it('keeps pricing_basis and unit_rate for per-seat members and drops a stray unit_rate on bundle members', () => {
    const projected = projectFixedServicesForSubmission([
      { service_id: 's-seat', quantity: 5, pricing_basis: 'unit', unit_rate: 15000, resolved_rate: 1 } as any,
      { service_id: 's-bundle', quantity: 2, pricing_basis: 'bundle', unit_rate: 999 },
    ]);
    expect(projected[0]).toMatchObject({ pricing_basis: 'unit', unit_rate: 15000 });
    expect(projected[1]).toMatchObject({ pricing_basis: 'bundle', unit_rate: undefined });
  });
});
