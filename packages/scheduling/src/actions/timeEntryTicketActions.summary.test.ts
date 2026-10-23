// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: vi.fn(() => ({
    table: () => {
      const query: Record<string, unknown> = {};
      query.where = () => query;
      query.orderBy = () => query;
      query.select = () => Promise.resolve(state.rows);
      return query;
    },
    tenantJoin: () => undefined,
  })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: unknown) => action,
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({
    authorizeResource: async (input: { record: { id: string } }) =>
      state.decisions.get(input.record.id) ?? { allowed: true, redactedFields: [] },
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

vi.mock('./timeEntryDelegationAuth', () => ({
  resolveManagedSubjectUserIds: async () => [],
}));

vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: async () => undefined,
}));

const USER = { user_id: 'user-own', user_type: 'internal', clientId: null } as never;

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    entry_id: 'entry',
    user_id: 'user-own',
    user_name: 'Own User',
    start_time: null,
    end_time: null,
    work_date: null,
    billable_duration: 0,
    notes: null,
    approval_status: 'DRAFT',
    service_id: null,
    service_name: null,
    ...overrides,
  };
}

describe('fetchTimeEntriesForTicketCore ticket totals', () => {
  beforeEach(() => {
    state.rows = [];
    state.decisions = new Map();
  });

  it('sums worked duration for every total while preserving per-entry billable_duration', async () => {
    state.rows = [
      // Own five-minute ad-hoc entry whose billable_duration is zero.
      row({
        entry_id: 'own-non-billable',
        start_time: new Date('2026-09-20T23:54:00.000Z'),
        end_time: new Date('2026-09-20T23:59:00.000Z'),
        work_date: new Date('2026-09-20T00:00:00.000Z'),
        billable_duration: 0,
        notes: 'Ad-hoc non-billable',
      }),
      // Another user's visible entry: worked 30m, billed 45m.
      row({
        entry_id: 'other-visible',
        user_id: 'user-other-visible',
        user_name: 'Other Visible',
        start_time: new Date('2026-09-21T10:00:00.000Z'),
        end_time: new Date('2026-09-21T10:30:00.000Z'),
        work_date: new Date('2026-09-21T00:00:00.000Z'),
        billable_duration: 45,
        approval_status: 'APPROVED',
      }),
      // Another user's hidden entry with no usable interval: falls back to billable.
      row({
        entry_id: 'other-hidden',
        user_id: 'user-other-hidden',
        user_name: 'Other Hidden',
        start_time: null,
        end_time: null,
        billable_duration: 12,
        approval_status: 'APPROVED',
      }),
    ];
    state.decisions.set('other-visible', { allowed: true, redactedFields: [] });
    state.decisions.set('other-hidden', { allowed: false, redactedFields: [] });

    const { fetchTimeEntriesForTicketCore } = await import('./timeEntryTicketActions');
    const db = { raw: (sql: string) => sql } as never;

    const summary = await fetchTimeEntriesForTicketCore(USER, 'tenant-1', db, 'ticket-1');

    // Own entry: 5 worked minutes, not 0.
    expect(summary.ownTotalMinutes).toBe(5);
    // Others: 30 visible worked + 12 fallback worked = 42.
    expect(summary.othersTotalMinutes).toBe(42);
    expect(summary.othersVisibleMinutes).toBe(30);
    expect(summary.othersHiddenMinutes).toBe(12);
    expect(summary.totalMinutes).toBe(47);

    // Authorization still hides the denied entry.
    expect(summary.entries.map((entry) => entry.entry_id)).toEqual([
      'own-non-billable',
      'other-visible',
    ]);
    // Billing values cross the boundary untouched.
    expect(summary.entries.find((entry) => entry.entry_id === 'own-non-billable')?.billable_duration).toBe(0);
    expect(summary.entries.find((entry) => entry.entry_id === 'other-visible')?.billable_duration).toBe(45);
  });
});
