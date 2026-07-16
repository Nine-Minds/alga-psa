import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConfiguration: vi.fn(),
  createTenantKnex: vi.fn(),
  deleteConfiguration: vi.fn(),
  getConfigurationForService: vi.fn(),
  getConfigurationsForPlan: vi.fn(),
  hasPermission: vi.fn(),
  transactionConnections: [] as unknown[],
  withTransaction: vi.fn(),
}));

let currentServiceId: string | undefined;
let systemManagedContract = false;

const makeBuilder = (table: string) => {
  const builder: any = {};
  builder.where = vi.fn((criteria: Record<string, unknown>) => {
    if (typeof criteria.service_id === 'string') {
      currentServiceId = criteria.service_id;
    }
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.first = vi.fn(async () => {
    if (table === 'contract_template_lines') return undefined;
    if (table === 'contract_lines') {
      return {
        contract_line_id: 'line-1',
        contract_line_type: 'Fixed',
        contract_id: 'contract-1',
      };
    }
    if (table === 'service_catalog') {
      return {
        service_id: currentServiceId,
        service_name: currentServiceId,
        is_active: true,
        item_kind: 'service',
        default_rate: 10000,
      };
    }
    if (table === 'contracts') {
      return { is_system_managed_default: systemManagedContract };
    }
    if (table === 'contract_line_services') return undefined;
    throw new Error(`Unexpected first() on ${table}`);
  });
  builder.insert = vi.fn(async () => undefined);
  builder.delete = vi.fn(async () => 1);
  builder.whereIn = vi.fn(() => builder);
  return builder;
};

const trx: any = vi.fn((table: string) => makeBuilder(table));
trx.fn = { now: vi.fn(() => new Date('2026-07-15T00:00:00Z')) };

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => mocks.createTenantKnex(...args),
  tenantDb: (connection: any) => ({
    table: (table: string) => connection(table),
  }),
  withTransaction: (...args: unknown[]) => mocks.withTransaction(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: unknown[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('../src/services/contractLineServiceConfigurationService', () => ({
  ContractLineServiceConfigurationService: class MockContractLineServiceConfigurationService {
    constructor(connection: unknown) {
      mocks.transactionConnections.push(connection);
    }

    getConfigurationForService(...args: unknown[]) {
      return mocks.getConfigurationForService(...args);
    }

    getConfigurationsForPlan(...args: unknown[]) {
      return mocks.getConfigurationsForPlan(...args);
    }

    createConfiguration(...args: unknown[]) {
      return mocks.createConfiguration(...args);
    }

    deleteConfiguration(...args: unknown[]) {
      return mocks.deleteConfiguration(...args);
    }
  },
}));

vi.mock('../src/actions/contractLineServiceConfigurationActions', () => ({}));

describe('applyContractLineServiceMembershipChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentServiceId = undefined;
    systemManagedContract = false;
    mocks.transactionConnections.length = 0;
    mocks.createTenantKnex.mockResolvedValue({ knex: { name: 'root-knex' } });
    mocks.deleteConfiguration.mockResolvedValue(true);
    mocks.hasPermission.mockResolvedValue(true);
    mocks.getConfigurationForService.mockResolvedValue(null);
    mocks.getConfigurationsForPlan.mockResolvedValue([]);
    mocks.withTransaction.mockImplementation(async (_db, callback) => callback(trx));
  });

  it('runs every staged addition in one transaction and propagates a later failure for rollback', async () => {
    mocks.createConfiguration
      .mockResolvedValueOnce('config-1')
      .mockRejectedValueOnce(new Error('second service failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { applyContractLineServiceMembershipChanges } = await import(
      '../src/actions/contractLineServiceActions'
    );

    try {
      await expect(applyContractLineServiceMembershipChanges('line-1', {
        additions: [
          {
            serviceId: 'service-1',
            quantity: 1,
            customRate: 10000,
            configurationType: 'Fixed',
            typeConfig: { base_rate: 10000 },
          },
          {
            serviceId: 'service-2',
            quantity: 1,
            customRate: 20000,
            configurationType: 'Fixed',
            typeConfig: { base_rate: 20000 },
          },
        ],
        removals: [],
      })).rejects.toThrow('second service failed');
    } finally {
      errorSpy.mockRestore();
    }

    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.createConfiguration).toHaveBeenCalledTimes(2);
    expect(mocks.transactionConnections).toEqual([trx, trx]);
  });

  it('removes every configuration for a service before adding the new membership', async () => {
    mocks.getConfigurationsForPlan.mockResolvedValue([
      { config_id: 'existing-main', service_id: 'existing-service' },
      { config_id: 'existing-bucket', service_id: 'existing-service' },
      { config_id: 'unrelated-config', service_id: 'unrelated-service' },
    ]);
    mocks.createConfiguration.mockResolvedValue('new-config');

    const { applyContractLineServiceMembershipChanges } = await import(
      '../src/actions/contractLineServiceActions'
    );

    await expect(applyContractLineServiceMembershipChanges('line-1', {
      additions: [{
        serviceId: 'new-service',
        quantity: 1,
        customRate: 20000,
        configurationType: 'Fixed',
        typeConfig: { base_rate: 20000 },
      }],
      removals: ['existing-service'],
    })).resolves.toBe(true);

    expect(mocks.withTransaction).toHaveBeenCalledOnce();
    expect(mocks.deleteConfiguration).toHaveBeenNthCalledWith(1, 'existing-main');
    expect(mocks.deleteConfiguration).toHaveBeenNthCalledWith(2, 'existing-bucket');
    expect(mocks.deleteConfiguration).toHaveBeenCalledTimes(2);
    expect(mocks.createConfiguration).toHaveBeenCalledOnce();
    expect(mocks.transactionConnections).toEqual([trx, trx]);
  });

  it('rejects contradictory membership input before opening a transaction', async () => {
    const { applyContractLineServiceMembershipChanges } = await import(
      '../src/actions/contractLineServiceActions'
    );

    await expect(applyContractLineServiceMembershipChanges('line-1', {
      additions: [{
        serviceId: 'service-1',
        configurationType: 'Fixed',
      }],
      removals: ['service-1'],
    })).resolves.toMatchObject({
      actionError: 'The same service cannot be added and removed in one contract line edit.',
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('preserves the system-managed contract authoring guard inside the batch transaction', async () => {
    systemManagedContract = true;
    const { applyContractLineServiceMembershipChanges } = await import(
      '../src/actions/contractLineServiceActions'
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(applyContractLineServiceMembershipChanges('line-1', {
        additions: [{ serviceId: 'service-1', configurationType: 'Fixed' }],
        removals: [],
      })).resolves.toEqual({
        actionError: 'System-managed default contracts are attribution-only; contract-line service configuration authoring is disabled.',
      });
    } finally {
      errorSpy.mockRestore();
    }

    expect(mocks.createConfiguration).not.toHaveBeenCalled();
  });
});
