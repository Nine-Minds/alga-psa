import { describe, expect, it } from 'vitest';
import type { ITenant } from './tenant.interface';

describe('ITenant interface', () => {
  it('ITenant.plan accepts TenantTier values', () => {
    const tenant: ITenant = {
      tenant: 'test-tenant',
      company_name: 'Test Company',
      email: 'test@example.com',
      is_inactive: false,
      plan: 'pro',
    };

    expect(tenant.plan).toBe('pro');

    const premiumTenant: ITenant = { ...tenant, plan: 'premium' };
    const undefinedPlanTenant: ITenant = { ...tenant, plan: undefined };

    expect(premiumTenant.plan).toBe('premium');
    expect(undefinedPlanTenant.plan).toBeUndefined();
  });

  it('ITenant.addons accepts string array', () => {
    const tenant: ITenant = {
      tenant: 'test-tenant',
      company_name: 'Test Company',
      email: 'test@example.com',
      is_inactive: false,
      addons: ['invoice_designer'],
    };

    expect(tenant.addons).toEqual(['invoice_designer']);

    const noAddonsTenant: ITenant = { ...tenant, addons: undefined };
    expect(noAddonsTenant.addons).toBeUndefined();
  });
});
