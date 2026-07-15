import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRows = vi.hoisted(() => ({
  value: [] as Array<{ client_id: string; entry_count: string | number }>,
}));
const whereCalls = vi.hoisted(() => [] as unknown[][]);

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => {
    const query: Record<string, unknown> = {};
    for (const method of [
      'where',
      'whereNotNull',
      'whereIn',
      'groupBy',
      'select',
      'countDistinct',
    ]) {
      query[method] = vi.fn((...args: unknown[]) => {
        if (method === 'where') whereCalls.push(args);
        return query;
      });
    }
    query.then = (resolve: (rows: typeof queryRows.value) => unknown) =>
      Promise.resolve(queryRows.value).then(resolve);
    return {
      table: vi.fn(() => query),
      tenantJoin: vi.fn(),
    };
  }),
}));

import {
  detectRecurringApprovalWarnings,
  formatStaleProjectBillingWarning,
} from './recurringApprovalBlockers';

describe('recurring project billing readiness warnings', () => {
  beforeEach(() => {
    queryRows.value = [];
    whereCalls.length = 0;
  });

  it('T024: adds a warning without creating a blocker for each due-work identity of the client', async () => {
    queryRows.value = [{ client_id: 'client-1', entry_count: '2' }];
    const now = new Date('2026-07-15T12:00:00.000Z');

    const warnings = await detectRecurringApprovalWarnings({
      knex: {} as never,
      tenant: 'tenant-1',
      now,
      rows: [
        {
          executionIdentityKey: 'identity-1',
          clientId: 'client-1',
          servicePeriodStart: '2026-07-01' as never,
          servicePeriodEnd: '2026-08-01' as never,
        },
        {
          executionIdentityKey: 'identity-2',
          clientId: 'client-2',
          servicePeriodStart: '2026-07-01' as never,
          servicePeriodEnd: '2026-08-01' as never,
        },
      ],
    });

    expect(warnings.get('identity-1')).toEqual([{
      code: 'stale_project_billing_ready_entries',
      severity: 'warning',
      message: '2 project billing schedule entries have been ready for more than 7 days.',
      entryCount: 2,
    }]);
    expect(warnings.has('identity-2')).toBe(false);
    expect(whereCalls).toContainEqual(['entry.ready_at', '<', '2026-07-08T12:00:00.000Z']);
  });

  it('uses singular warning copy', () => {
    expect(formatStaleProjectBillingWarning(1)).toBe(
      '1 project billing schedule entry has been ready for more than 7 days.',
    );
  });
});
