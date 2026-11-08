import { describe, expect, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('tenant default tax rate tenant deletion ordering', () => {
  it('clears default-rate references before cleanup, then deletes settings before rates, preserving other tenants', async () => {
    const { operations } = await expectTenantDeletion([
      ['tenant_settings', 'tax_rates'],
      ['tax_rates', 'tax_regions'],
      ['tax_regions', 'tenants'],
    ], { tenant_settings: { default_tax_rate_id: 'rate-1' } });

    expect(operations[0]).toEqual({
      table: 'tenant_settings', kind: 'update', data: { default_tax_rate_id: null },
    });
  });
});
