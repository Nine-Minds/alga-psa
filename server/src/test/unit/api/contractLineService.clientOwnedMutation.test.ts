import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransaction = vi.fn();
const repositoryAddContractLine = vi.fn();
const cloneTemplateContractLine = vi.fn();

class MockBaseService<T> {
  constructor(_config: unknown) {}

  async getKnex(): Promise<{ knex: unknown }> {
    throw new Error('getKnex mock not provided');
  }

  addUpdateAuditFields(data: Record<string, unknown>) {
    return { ...data };
  }

  addCreateAuditFields(data: Record<string, unknown>) {
    return { ...data };
  }
}

vi.mock('@alga-psa/db', () => ({
  BaseService: MockBaseService,
  withTransaction: (...args: any[]) => withTransaction(...args),
}));

vi.mock('@alga-psa/billing/models/contractLine', () => ({
  default: class ContractLine {},
}));

vi.mock('@alga-psa/billing/models/contractLineFixedConfig', () => ({
  default: class ContractLineFixedConfig {},
}));

vi.mock('@alga-psa/billing/services', () => ({
  ContractLineServiceConfigurationService: class ContractLineServiceConfigurationService {},
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/billing/utils/templateClone', () => ({
  cloneTemplateContractLine: (...args: any[]) => cloneTemplateContractLine(...args),
}));

vi.mock('server/src/lib/repositories/contractLineRepository', () => ({
  addContractLine: (...args: any[]) => repositoryAddContractLine(...args),
  removeContractLine: vi.fn(),
}));

describe('ContractLineService client-owned mutation paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T044: API/service contract-line mutation paths continue to work for client-owned non-template contracts after cloning and owner enforcement', async () => {
    const knex = { scope: 'root-knex' };
    const trx = { scope: 'transaction-knex' };
    const mapping = {
      tenant: 'tenant-1',
      contract_id: 'cloned-contract-1',
      contract_line_id: 'cloned-line-1',
      custom_rate: 149.5,
      display_order: 0,
      billing_timing: 'arrears',
      created_at: '2026-03-16T00:00:00.000Z',
    };

    withTransaction.mockImplementation(async (receivedKnex, callback) => {
      expect(receivedKnex).toBe(knex);
      return callback(trx);
    });
    repositoryAddContractLine.mockResolvedValue(mapping);

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    const validateContractExists = vi
      .spyOn(service as any, 'validateContractExists')
      .mockResolvedValue(undefined);
    const getExistingPlan = vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'template-line-1',
    });

    const result = await service.addContractLine(
      'cloned-contract-1',
      'template-line-1',
      149.5,
      context
    );

    expect(validateContractExists).toHaveBeenCalledWith('cloned-contract-1', context, trx);
    expect(getExistingPlan).toHaveBeenCalledWith('template-line-1', context, trx);
    expect(repositoryAddContractLine).toHaveBeenCalledWith(
      trx,
      'tenant-1',
      'cloned-contract-1',
      'template-line-1',
      149.5
    );
    expect(result).toEqual(mapping);
  });

  it('deactivates a client-owned cloned line without touching client_contract_lines', async () => {
    const observedTables: string[] = [];
    let updatePayload: Record<string, unknown> | undefined;
    const knex = { scope: 'root-knex' };
    const trx = ((table: string) => {
      observedTables.push(table);

      if (table === 'contract_lines as cl') {
        const builder = {
          join() {
            return builder;
          },
          where() {
            return builder;
          },
          select() {
            return builder;
          },
          async first() {
            return { client_id: 'client-1' };
          },
        };

        return builder;
      }

      if (table === 'contract_lines') {
        const builder = {
          where() {
            return builder;
          },
          async update(payload: Record<string, unknown>) {
            updatePayload = payload;
            return 1;
          },
        };

        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    withTransaction.mockImplementation(async (receivedKnex, callback) => {
      expect(receivedKnex).toBe(knex);
      return callback(trx);
    });

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    const validateSafeUnassignment = vi
      .spyOn(service as any, 'validateSafeUnassignment')
      .mockResolvedValue(undefined);

    await service.unassignPlanFromClient('live-line-1', context);

    expect(validateSafeUnassignment).toHaveBeenCalledWith('live-line-1', 'client-1', context, trx);
    expect(updatePayload).toMatchObject({ is_active: false });
    expect(observedTables).not.toContain('client_contract_lines');
  });

  it('rejects only duplicate cloned template assignments inside the target client-owned contract', async () => {
    const observedTables: string[] = [];
    const observedWhereClauses: Array<[string, unknown]> = [];
    const trx = ((table: string) => {
      observedTables.push(table);

      if (table !== 'contract_lines') {
        throw new Error(`Unexpected table ${table}`);
      }

      const builder = {
        where(column: string, value: unknown) {
          observedWhereClauses.push([column, value]);
          return builder;
        },
        async first() {
          return { contract_line_id: 'existing-line-1' };
        },
      };

      return builder;
    }) as any;

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();

    await expect(
      (service as any).validateNoOverlappingAssignments(
        {
          client_id: 'client-1',
          contract_line_id: 'template-line-1',
          start_date: '2026-03-19T00:00:00.000Z',
          service_category: 'managed-services',
        },
        {
          contract_line_name: 'Managed Support',
          description: 'Primary recurring support',
          billing_frequency: 'monthly',
          contract_line_type: 'Fixed',
          service_category: 'managed-services',
          billing_timing: 'arrears',
          cadence_owner: 'client',
          custom_rate: 175,
        },
        'client-contract-1',
        { tenant: 'tenant-1', userId: 'user-1' },
        trx,
      ),
    ).rejects.toThrow('Client contract already has an active cloned line matching this template assignment');

    expect(observedTables).toEqual(['contract_lines']);
    expect(observedWhereClauses).toContainEqual(['contract_id', 'client-contract-1']);
    expect(observedWhereClauses).toContainEqual(['contract_line_name', 'Managed Support']);
    expect(observedWhereClauses).toContainEqual(['description', 'Primary recurring support']);
    expect(observedWhereClauses).toContainEqual(['billing_timing', 'arrears']);
    expect(observedWhereClauses).toContainEqual(['cadence_owner', 'client']);
    expect(observedWhereClauses).toContainEqual(['custom_rate', 175]);
  });

  it('T113: assignPlanToClient does not backfill template_contract_id on client_contracts when provenance is missing', async () => {
    const knex = { scope: 'root-knex' };
    const observedTables: string[] = [];
    const clientContractsUpdate = vi.fn();

    const trx = ((table: string) => {
      observedTables.push(table);

      if (table === 'client_contracts') {
        const builder = {
          where() {
            return builder;
          },
          async first() {
            return {
              template_contract_id: null,
              contract_id: 'live-contract-1',
            };
          },
          update: clientContractsUpdate,
        };
        return builder;
      }

      if (table === 'contract_lines') {
        const builder = {
          insert() {
            return builder;
          },
          async returning() {
            return [{ contract_line_id: 'new-line-1', contract_id: 'live-contract-1' }];
          },
        };
        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    withTransaction.mockImplementation(async (receivedKnex, callback) => {
      expect(receivedKnex).toBe(knex);
      return callback(trx);
    });

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'template-line-1',
      contract_line_name: 'Template Line',
      description: 'Template description',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      service_category: 'managed-services',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      custom_rate: 175,
      display_order: 0,
      enable_proration: false,
      enable_overtime: false,
      overtime_rate: null,
      overtime_threshold: null,
      enable_after_hours_rate: false,
      after_hours_multiplier: null,
    });
    vi.spyOn(service as any, 'validateClientExists').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'validateNoOverlappingAssignments').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'generateClientPlanLinks').mockReturnValue([]);

    await service.assignPlanToClient(
      {
        client_contract_id: 'client-contract-1',
        client_id: 'client-1',
        contract_line_id: 'template-line-1',
        start_date: '2026-03-20',
        end_date: null,
        custom_rate: null,
      } as any,
      context,
    );

    expect(observedTables).toContain('client_contracts');
    expect(clientContractsUpdate).not.toHaveBeenCalled();
    expect(cloneTemplateContractLine).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        templateContractId: 'live-contract-1',
      }),
    );
  });
});
