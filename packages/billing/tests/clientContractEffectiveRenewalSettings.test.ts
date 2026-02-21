import { describe, expect, it } from 'vitest';
import { normalizeClientContract } from '../../../shared/billingClients/clientContracts';

describe('client contract effective renewal settings normalization', () => {
  it('applies tenant defaults when use_tenant_renewal_defaults is true', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-1',
      client_contract_id: 'cc-1',
      client_id: 'client-1',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: true,
      renewal_mode: 'auto',
      notice_period_days: 10,
      tenant_default_renewal_mode: 'manual',
      tenant_default_notice_period_days: 45,
    });

    expect(normalized.use_tenant_renewal_defaults).toBe(true);
    expect(normalized.effective_renewal_mode).toBe('manual');
    expect(normalized.effective_notice_period_days).toBe(45);
  });

  it('uses explicit values when tenant defaults are disabled', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-2',
      client_contract_id: 'cc-2',
      client_id: 'client-2',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'auto',
      notice_period_days: 60,
      tenant_default_renewal_mode: 'manual',
      tenant_default_notice_period_days: 30,
    });

    expect(normalized.use_tenant_renewal_defaults).toBe(false);
    expect(normalized.effective_renewal_mode).toBe('auto');
    expect(normalized.effective_notice_period_days).toBe(60);
  });

  it('falls back deterministically when explicit override values are partially missing', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-3',
      client_contract_id: 'cc-3',
      client_id: 'client-3',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: null,
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: null,
      notice_period_days: undefined,
      tenant_default_renewal_mode: 'manual',
      tenant_default_notice_period_days: 20,
    });

    expect(normalized.effective_renewal_mode).toBe('manual');
    expect(normalized.effective_notice_period_days).toBe(20);
  });
});
