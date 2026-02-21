import { describe, expect, it } from 'vitest';
import {
  computeEvergreenDecisionDueDate,
  computeNextEvergreenReviewAnchorDate,
  normalizeClientContract,
} from '../../../shared/billingClients/clientContracts';

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

  it('computes fixed-term decision_due_date from end_date minus effective notice period', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-4',
      client_contract_id: 'cc-4',
      client_id: 'client-4',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 45,
    });

    expect(normalized.effective_notice_period_days).toBe(45);
    expect(normalized.decision_due_date).toBe('2026-11-16');
  });

  it('computes next evergreen review anchor date using contract anniversary rules', () => {
    expect(
      computeNextEvergreenReviewAnchorDate({
        startDate: '2024-05-10',
        now: '2026-05-01',
      })
    ).toBe('2026-05-10');

    expect(
      computeNextEvergreenReviewAnchorDate({
        startDate: '2024-05-10',
        now: '2026-05-11',
      })
    ).toBe('2027-05-10');
  });

  it('computes evergreen decision_due_date from annual anchor minus notice period', () => {
    expect(
      computeEvergreenDecisionDueDate({
        startDate: '2024-05-10',
        now: '2026-05-01',
        noticePeriodDays: 20,
      })
    ).toBe('2026-04-20');
  });

  it('exposes evergreen_review_anchor_date on active evergreen assignments', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-5',
      client_contract_id: 'cc-5',
      client_id: 'client-5',
      tenant: 'tenant-1',
      start_date: '2024-10-04',
      end_date: null,
      is_active: true,
      use_tenant_renewal_defaults: true,
      tenant_default_renewal_mode: 'manual',
      tenant_default_notice_period_days: 30,
    });

    expect(normalized.evergreen_review_anchor_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normalized.decision_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
