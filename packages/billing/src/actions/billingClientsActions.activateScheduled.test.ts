import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class ContractAlreadyActiveScheduledError extends Error {
    readonly startDate: string;
    constructor(startDate: string) {
      super(`Contract is already active and starts on ${startDate}; there is nothing to activate.`);
      this.name = 'ContractAlreadyActiveScheduledError';
      this.startDate = startDate;
    }
  }
  return {
    ContractAlreadyActiveScheduledError,
    activateClientContractAssignment: vi.fn(),
    syncRecurringServicePeriodsForContract: vi.fn(),
    publishWorkflowEvent: vi.fn(),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'billing-user' }, { tenant: 'tenant-test' }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, work: (trx: unknown) => unknown) => work({})),
  tenantDb: () => ({
    table: () => {
      const query: any = {
        andWhere: () => query,
        first: async () => ({ is_system_managed_default: false }),
      };
      return query;
    },
    tenantJoin: vi.fn(),
  }),
}));
vi.mock('@alga-psa/shared/billingClients', () => ({
  ContractAlreadyActiveScheduledError: mocks.ContractAlreadyActiveScheduledError,
  activateClientContractAssignment: mocks.activateClientContractAssignment,
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(),
  getClientLogoUrlsBatch: vi.fn(),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: mocks.publishWorkflowEvent }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildContractCreatedPayload: vi.fn() }));
vi.mock('./recurringServicePeriodSync', () => ({
  syncRecurringServicePeriodsForContract: mocks.syncRecurringServicePeriodsForContract,
}));

import { activateClientContractForBilling } from './billingClientsActions';

describe('activateClientContractForBilling for an already-active scheduled contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an expected, localizable action error instead of throwing', async () => {
    mocks.activateClientContractAssignment.mockRejectedValue(
      new mocks.ContractAlreadyActiveScheduledError('2099-10-22'),
    );

    const result = await (activateClientContractForBilling as any)('client-contract-1');

    expect(result).toEqual({
      actionError: 'Contract is already active and starts on 2099-10-22; there is nothing to activate.',
      messageKey: 'msp/billing:errors.clientContract.alreadyActiveScheduled',
      messageParams: { startDate: '2099-10-22' },
    });
    expect(mocks.syncRecurringServicePeriodsForContract).not.toHaveBeenCalled();
    expect(mocks.publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('still rethrows unexpected errors', async () => {
    mocks.activateClientContractAssignment.mockRejectedValue(new Error('boom'));
    await expect((activateClientContractForBilling as any)('client-contract-1')).rejects.toThrow('boom');
  });
});
