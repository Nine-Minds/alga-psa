import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
}));

import { normalizeClientContract } from './clientContract';

// node-postgres returns DATE columns as JS Date objects at local midnight.
const baseRow = {
  tenant: 'tenant-1',
  client_contract_id: 'cc-1',
  is_active: true,
  contract_status: 'active',
  renewal_mode: 'manual',
  notice_period_days: 30,
  use_tenant_renewal_defaults: false,
};

describe('normalizeClientContract with pg DATE values', () => {
  it('derives scheduled for a confirmed contract whose Date start is in the future', () => {
    const result = normalizeClientContract(
      { ...baseRow, start_date: new Date(2026, 9, 20), end_date: null },
      { today: '2026-10-16' }
    );

    expect(result.assignment_status).toBe('scheduled');
    expect(result.evergreen_review_anchor_date).toBeDefined();
    expect(result.decision_due_date).toBeDefined();
    expect(result.renewal_cycle_start).toBe('2026-10-20');
  });

  it('derives active once the Date start is today, and keeps fixed-term cycle dates exact', () => {
    const result = normalizeClientContract(
      { ...baseRow, start_date: new Date(2026, 9, 16), end_date: new Date(2027, 9, 15) },
      { today: '2026-10-16' }
    );

    expect(result.assignment_status).toBe('active');
    expect(result.renewal_cycle_start).toBe('2026-10-16');
    expect(result.renewal_cycle_end).toBe('2027-10-15');
    expect(result.decision_due_date).toBe('2027-09-15');
  });

  it('still treats missing or invalid dates as absent', () => {
    const result = normalizeClientContract(
      { ...baseRow, start_date: new Date('nope'), end_date: '' },
      { today: '2026-10-16' }
    );
    expect(result.evergreen_review_anchor_date).toBeUndefined();
    expect(result.decision_due_date).toBeUndefined();
  });
});
