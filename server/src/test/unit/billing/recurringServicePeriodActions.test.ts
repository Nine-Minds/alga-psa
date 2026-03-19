import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  createTenantKnex: vi.fn(async () => ({ knex: vi.fn() })),
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          tenant: 'tenant-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

const {
  getRecurringServicePeriodManagementView,
  previewRecurringServicePeriodInvoiceLinkageRepair,
  previewRecurringServicePeriodRegeneration,
} = await import('../../../../../packages/billing/src/actions/recurringServicePeriodActions');

describe('recurring service period actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('T076: service-period view actions require billing.recurring_service_periods.view', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      getRecurringServicePeriodManagementView('schedule:tenant-1:contract_line:line-1:contract:arrears'),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot view recurring service periods',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'view',
    );
  });

  it('T077: service-period regenerate actions require billing.recurring_service_periods.regenerate', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      previewRecurringServicePeriodRegeneration({
        existingRecords: [],
        candidateRecords: [],
        regeneratedAt: '2026-03-18T20:00:00.000Z',
        sourceRuleVersion: 'line-1:v2',
        sourceRunKey: 'regen-1',
      }),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot regenerate recurring service periods',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'regenerate',
    );
  });

  it('T078: service-period repair/history correction actions require billing.recurring_service_periods.correct_history', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(
      previewRecurringServicePeriodInvoiceLinkageRepair({
        record: buildRecurringServicePeriodRecord({
          lifecycleState: 'billed',
        }),
        invoiceLinkage: {
          invoiceId: 'invoice-1',
          invoiceChargeId: 'charge-1',
          invoiceChargeDetailId: 'detail-1',
          linkedAt: '2026-03-18T20:00:00.000Z',
        },
        repairedAt: '2026-03-18T20:00:00.000Z',
        sourceRuleVersion: 'repair:v1',
        sourceRunKey: 'repair-1',
      }),
    ).resolves.toEqual({
      permissionError: 'Permission denied: Cannot repair recurring service period history',
    });

    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'billing.recurring_service_periods',
      'correct_history',
    );
  });

  it('T079: service-period regeneration action surfaces conflict payloads when preserved edited or billed rows no longer match regenerated candidates', async () => {
    const editedOverride = buildRecurringServicePeriodRecord({
      recordId: 'rsp_override',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
      periodKey: 'period:2026-06-10:2026-07-10',
      lifecycleState: 'edited',
      servicePeriod: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'edit-1',
        supersedesRecordId: 'rsp_original',
      },
    });

    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_billed',
      scheduleKey: editedOverride.scheduleKey,
      periodKey: 'period:2026-07-10:2026-08-10',
      lifecycleState: 'billed',
      servicePeriod: {
        start: '2026-07-10',
        end: '2026-08-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-07-10',
        end: '2026-08-10',
        semantics: 'half_open',
      },
    });

    const plan = await previewRecurringServicePeriodRegeneration({
      existingRecords: [editedOverride, billedRecord],
      candidateRecords: [
        buildRecurringServicePeriodRecord({
          recordId: 'rsp_candidate',
          scheduleKey: editedOverride.scheduleKey,
          periodKey: editedOverride.periodKey,
          servicePeriod: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
          invoiceWindow: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
        }),
      ],
      regeneratedAt: '2026-03-18T20:05:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regen-2',
    });

    expect(plan).toMatchObject({
      preservedRecords: [editedOverride, billedRecord],
      conflicts: [
        {
          kind: 'service_period_mismatch',
          recordId: 'rsp_override',
        },
        {
          kind: 'missing_candidate',
          recordId: 'rsp_billed',
        },
      ],
    });
  });
});
