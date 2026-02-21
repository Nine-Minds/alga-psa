import { describe, expect, it } from 'vitest';
import {
  computeEvergreenDecisionDueDate,
  computeNextEvergreenReviewAnchorDate,
  dedupeClientContractsByRenewalCycle,
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

  it('normalizes timestamp end_date to date-only semantics before fixed-term due-date math', () => {
    const normalized = normalizeClientContract({
      contract_id: 'contract-4b',
      client_contract_id: 'cc-4b',
      client_id: 'client-4b',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31T23:59:59.999Z',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 1,
    });

    expect(normalized.decision_due_date).toBe('2026-12-30');
  });

  it('recomputes fixed-term decision_due_date when end_date changes', () => {
    const baseAssignment = {
      contract_id: 'contract-4c',
      client_contract_id: 'cc-4c',
      client_id: 'client-4c',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 30,
    };

    const before = normalizeClientContract({
      ...baseAssignment,
      end_date: '2026-12-31',
    });
    const after = normalizeClientContract({
      ...baseAssignment,
      end_date: '2027-01-31',
    });

    expect(before.decision_due_date).toBe('2026-12-01');
    expect(after.decision_due_date).toBe('2027-01-01');
  });

  it('recomputes fixed-term decision_due_date when notice period changes', () => {
    const baseAssignment = {
      contract_id: 'contract-4d',
      client_contract_id: 'cc-4d',
      client_id: 'client-4d',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
    };

    const shortNotice = normalizeClientContract({
      ...baseAssignment,
      notice_period_days: 15,
    });
    const longNotice = normalizeClientContract({
      ...baseAssignment,
      notice_period_days: 45,
    });

    expect(shortNotice.decision_due_date).toBe('2026-12-16');
    expect(longNotice.decision_due_date).toBe('2026-11-16');
  });

  it('recomputes decision_due_date when renewal mode changes between none/manual/auto', () => {
    const baseAssignment = {
      contract_id: 'contract-4e',
      client_contract_id: 'cc-4e',
      client_id: 'client-4e',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      notice_period_days: 30,
    };

    const noneMode = normalizeClientContract({
      ...baseAssignment,
      renewal_mode: 'none',
    });
    const manualMode = normalizeClientContract({
      ...baseAssignment,
      renewal_mode: 'manual',
    });
    const autoMode = normalizeClientContract({
      ...baseAssignment,
      renewal_mode: 'auto',
    });

    expect(noneMode.decision_due_date).toBeUndefined();
    expect(manualMode.decision_due_date).toBe('2026-12-01');
    expect(autoMode.decision_due_date).toBe('2026-12-01');
  });

  it('skips decision_due_date generation for inactive/terminated assignments', () => {
    const inactiveAssignment = normalizeClientContract({
      contract_id: 'contract-4f',
      client_contract_id: 'cc-4f',
      client_id: 'client-4f',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: false,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 30,
    });
    const terminatedContract = normalizeClientContract({
      contract_id: 'contract-4g',
      client_contract_id: 'cc-4g',
      client_id: 'client-4g',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      contract_status: 'terminated',
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 30,
    });

    expect(inactiveAssignment.decision_due_date).toBeUndefined();
    expect(inactiveAssignment.evergreen_review_anchor_date).toBeUndefined();
    expect(terminatedContract.decision_due_date).toBeUndefined();
    expect(terminatedContract.evergreen_review_anchor_date).toBeUndefined();
  });

  it('creates one renewal_cycle_key per computed contract cycle for deduplication', () => {
    const fixedTerm = normalizeClientContract({
      contract_id: 'contract-4h',
      client_contract_id: 'cc-4h',
      client_id: 'client-4h',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'manual',
      notice_period_days: 30,
    });
    const evergreen = normalizeClientContract({
      contract_id: 'contract-4i',
      client_contract_id: 'cc-4i',
      client_id: 'client-4i',
      tenant: 'tenant-1',
      start_date: '2024-10-04',
      end_date: null,
      is_active: true,
      use_tenant_renewal_defaults: true,
      tenant_default_renewal_mode: 'manual',
      tenant_default_notice_period_days: 30,
    });
    const noneMode = normalizeClientContract({
      contract_id: 'contract-4j',
      client_contract_id: 'cc-4j',
      client_id: 'client-4j',
      tenant: 'tenant-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_active: true,
      use_tenant_renewal_defaults: false,
      renewal_mode: 'none',
      notice_period_days: 30,
    });

    expect(fixedTerm.renewal_cycle_key).toBe('fixed-term:2026-12-31');
    expect(evergreen.renewal_cycle_key).toMatch(/^evergreen:\d{4}-\d{2}-\d{2}$/);
    expect(noneMode.renewal_cycle_key).toBeUndefined();
  });

  it('deduplicates active rows by tenant + client_contract_id + renewal_cycle_key', () => {
    const duplicateRows = dedupeClientContractsByRenewalCycle([
      {
        tenant: 'tenant-1',
        client_contract_id: 'cc-dup',
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_active: true,
        renewal_cycle_key: 'fixed-term:2026-12-31',
      },
      {
        tenant: 'tenant-1',
        client_contract_id: 'cc-dup',
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_active: true,
        renewal_cycle_key: 'fixed-term:2026-12-31',
      },
      {
        tenant: 'tenant-1',
        client_contract_id: 'cc-dup',
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-01-01',
        end_date: '2027-12-31',
        is_active: true,
        renewal_cycle_key: 'fixed-term:2027-12-31',
      },
    ] as any);

    expect(duplicateRows).toHaveLength(2);
    expect(duplicateRows.map((row: any) => row.renewal_cycle_key)).toEqual([
      'fixed-term:2026-12-31',
      'fixed-term:2027-12-31',
    ]);
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

  it('recomputes evergreen decision_due_date when anniversary anchor basis changes', () => {
    const now = '2026-01-01';
    const noticePeriodDays = 20;

    const marchAnniversary = computeEvergreenDecisionDueDate({
      startDate: '2024-03-10',
      now,
      noticePeriodDays,
    });
    const septemberAnniversary = computeEvergreenDecisionDueDate({
      startDate: '2024-09-10',
      now,
      noticePeriodDays,
    });

    expect(marchAnniversary).toBe('2026-02-18');
    expect(septemberAnniversary).toBe('2026-08-21');
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
