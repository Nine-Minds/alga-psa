import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const hasPermission = vi.fn();
const randomUUID = vi.fn();

vi.mock('node:crypto', () => ({
  randomUUID: (...args: any[]) => randomUUID(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermission(...args),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: {},
}));

function buildKnexForDraftCreation(sourceRow: Record<string, unknown>) {
  const insertedContracts: Record<string, unknown>[] = [];
  const insertedClientContracts: Record<string, unknown>[] = [];
  const clientContractUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

  const sourceBuilder: any = {};
  sourceBuilder.join = vi.fn(() => sourceBuilder);
  sourceBuilder.where = vi.fn(() => sourceBuilder);
  sourceBuilder.select = vi.fn(() => sourceBuilder);
  sourceBuilder.first = vi.fn(async () => sourceRow);

  const contractsBuilder: any = {};
  contractsBuilder.where = vi.fn(() => contractsBuilder);
  contractsBuilder.first = vi.fn(async () => null);
  contractsBuilder.insert = vi.fn(async (data: Record<string, unknown>) => {
    insertedContracts.push(data);
  });

  const clientContractsBuilder: any = {};
  let lastClientContractsWhere: Record<string, unknown> = {};
  clientContractsBuilder.where = vi.fn((criteria: Record<string, unknown>) => {
    lastClientContractsWhere = criteria;
    return clientContractsBuilder;
  });
  clientContractsBuilder.first = vi.fn(async () => null);
  clientContractsBuilder.insert = vi.fn(async (data: Record<string, unknown>) => {
    insertedClientContracts.push(data);
  });
  clientContractsBuilder.update = vi.fn(async (data: Record<string, unknown>) => {
    clientContractUpdates.push({ where: lastClientContractsWhere, data });
  });

  const trx: any = vi.fn((table: string) => {
    if (table === 'client_contracts as cc') {
      return sourceBuilder;
    }
    if (table === 'contracts') {
      return contractsBuilder;
    }
    if (table === 'client_contracts') {
      return clientContractsBuilder;
    }
    throw new Error(`Unexpected table ${table}`);
  });

  const knex: any = vi.fn();
  knex.schema = {
    hasTable: vi.fn(async () => true),
    hasColumn: vi.fn(async () => true),
  };
  knex.transaction = async (callback: (trx: any) => Promise<unknown>) => callback(trx);

  return {
    knex,
    insertedContracts,
    insertedClientContracts,
    clientContractUpdates,
  };
}

describe('renewalsQueueActions create draft behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermission.mockResolvedValue(true);
    randomUUID
      .mockReturnValueOnce('draft-contract-id')
      .mockReturnValueOnce('draft-client-contract-id');
  });

  it('T043: still creates and links a renewal draft contract after owner-client enforcement', async () => {
    const sourceRow = {
      client_contract_id: 'source-client-contract-id',
      client_id: 'client-1',
      contract_id: 'source-contract-id',
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      status: 'pending',
      created_draft_contract_id: null,
      template_contract_id: 'template-1',
      renewal_mode: 'manual',
      notice_period_days: 30,
      renewal_term_months: 12,
      use_tenant_renewal_defaults: true,
      contract_name: 'Managed IT Services',
      contract_description: 'Renewal source',
      billing_frequency: 'monthly',
      currency_code: 'USD',
    };

    const {
      knex,
      insertedContracts,
      insertedClientContracts,
      clientContractUpdates,
    } = buildKnexForDraftCreation(sourceRow);
    createTenantKnex.mockResolvedValue({ knex });

    const { createRenewalDraftForQueueItem } = await import('@alga-psa/billing/actions/renewalsQueueActions');
    const result = await createRenewalDraftForQueueItem('source-client-contract-id', 'Carry forward');

    expect(result).toEqual({
      client_contract_id: 'source-client-contract-id',
      created_draft_contract_id: 'draft-contract-id',
      draft_client_contract_id: 'draft-client-contract-id',
    });
    expect(insertedContracts[0]).toMatchObject({
      tenant: 'tenant-1',
      contract_id: 'draft-contract-id',
      owner_client_id: 'client-1',
      contract_name: 'Managed IT Services (Renewal Draft)',
      status: 'draft',
      is_active: false,
      is_template: false,
    });
    expect(insertedClientContracts[0]).toMatchObject({
      tenant: 'tenant-1',
      client_contract_id: 'draft-client-contract-id',
      client_id: 'client-1',
      contract_id: 'draft-contract-id',
      template_contract_id: 'template-1',
      renewal_mode: 'manual',
      notice_period_days: 30,
      renewal_term_months: 12,
      use_tenant_renewal_defaults: true,
      is_active: false,
    });
    expect(clientContractUpdates[0]).toMatchObject({
      where: {
        tenant: 'tenant-1',
        client_contract_id: 'source-client-contract-id',
      },
      data: expect.objectContaining({
        created_draft_contract_id: 'draft-contract-id',
        last_action: 'create_renewal_draft',
        last_action_by: 'user-1',
        last_action_note: 'Carry forward',
      }),
    });
  });
});
