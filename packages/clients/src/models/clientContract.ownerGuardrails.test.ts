import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBuilder = () => {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.whereNot = vi.fn(() => builder);
  builder.first = vi.fn();
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.returning = vi.fn();
  return builder;
};

const mockCreateTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mockCreateTenantKnex,
}));

describe('ClientContract ownership guardrails', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('T015: rejects assigning a non-template contract owned by a different client', async () => {
    const clientsBuilder = createBuilder();
    const contractsBuilder = createBuilder();

    clientsBuilder.first.mockResolvedValue({ client_id: 'client-1' });
    contractsBuilder.first.mockResolvedValue({
      contract_id: 'contract-1',
      is_active: true,
      is_template: false,
      owner_client_id: 'client-2',
    });

    const db = vi.fn((table: string) => {
      if (table === 'clients') return clientsBuilder;
      if (table === 'contracts') return contractsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateTenantKnex.mockResolvedValue({ knex: db, tenant: 'tenant-1' });

    const { default: ClientContract } = await import('./clientContract');

    await expect(
      ClientContract.assignContractToClient(
        'client-1',
        'contract-1',
        '2026-01-01',
        null,
        undefined,
        'tenant-1'
      )
    ).rejects.toThrow(
      'Contract contract-1 belongs to a different client and cannot be assigned to client client-1'
    );
  });

  it('T016: rejects repointing an existing assignment to a contract owned by a different client', async () => {
    const clientContractsBuilder = createBuilder();
    const contractsBuilder = createBuilder();

    contractsBuilder.first.mockResolvedValue({
      contract_id: 'contract-2',
      is_template: false,
      owner_client_id: 'client-2',
    });

    const db = vi.fn((table: string) => {
      if (table === 'client_contracts') return clientContractsBuilder;
      if (table === 'contracts') return contractsBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    mockCreateTenantKnex.mockResolvedValue({ knex: db, tenant: 'tenant-1' });

    const { default: ClientContract } = await import('./clientContract');
    vi.spyOn(ClientContract, 'getById').mockResolvedValue({
      client_contract_id: 'cc-1',
      client_id: 'client-1',
      contract_id: 'contract-1',
      start_date: '2026-01-01',
      end_date: null,
      is_active: true,
      tenant: 'tenant-1',
    } as any);

    await expect(
      ClientContract.updateClientContract(
        'cc-1',
        { contract_id: 'contract-2' } as any,
        'tenant-1'
      )
    ).rejects.toThrow(
      'Contract contract-2 belongs to a different client and cannot be assigned to client client-1'
    );
  });
});
