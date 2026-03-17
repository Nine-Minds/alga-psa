import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE } from '@shared/billingClients/cadenceOwnerRollout';

const withTransaction = vi.fn();
const publishEvent = vi.fn();

class MockBaseService<T> {
  constructor(_config?: unknown) {}

  async getKnex(): Promise<{ knex: unknown }> {
    throw new Error('getKnex mock not provided');
  }

  addCreateAuditFields(data: Record<string, unknown>, context: { tenant: string }) {
    return {
      ...data,
      tenant: context.tenant,
    };
  }

  addUpdateAuditFields(data: Record<string, unknown>) {
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
  publishEvent: (...args: any[]) => publishEvent(...args),
}));

vi.mock('@alga-psa/billing/lib/billing/utils/templateClone', () => ({
  cloneTemplateContractLine: vi.fn(),
}));

vi.mock('server/src/lib/repositories/contractLineRepository', () => ({
  addContractLine: vi.fn(),
  removeContractLine: vi.fn(),
}));

describe('ContractLineService cadence owner handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks contract cadence on create during rollout and still defaults missing cadence_owner to client', async () => {
    let insertPayload: Record<string, unknown> | undefined;
    const knex = { scope: 'root-knex' };
    const trx = ((table: string) => {
      expect(table).toBe('contract_lines');
      return {
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          return {
            returning: async () => [{ contract_line_id: 'line-1' }],
          };
        },
      };
    }) as any;

    withTransaction.mockImplementation(async (receivedKnex, callback) => {
      expect(receivedKnex).toBe(knex);
      return callback(trx);
    });

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service, 'getById').mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_name: 'Managed Support',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      cadence_owner: 'client',
    } as any);

    await expect(service.create(
      {
        contract_line_name: 'Managed Support',
        billing_frequency: 'monthly',
        contract_line_type: 'Fixed',
        cadence_owner: 'contract',
      },
      context,
    )).rejects.toThrow(CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE);

    expect(insertPayload).toBeUndefined();

    await service.create(
      {
        contract_line_name: 'Managed Support',
        billing_frequency: 'monthly',
        contract_line_type: 'Fixed',
      },
      context,
    );

    expect(insertPayload?.cadence_owner).toBe('client');
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('blocks contract cadence on update during rollout', async () => {
    let updatePayload: Record<string, unknown> | undefined;
    const knex = { scope: 'root-knex' };
    const trx = ((table: string) => {
      expect(table).toBe('contract_lines');
      const builder = {
        where() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return {
            returning: async () => [{
              contract_line_id: 'line-1',
              contract_line_name: 'Managed Support',
              billing_frequency: 'monthly',
              contract_line_type: 'Fixed',
              service_category: null,
            }],
          };
        },
      };
      return builder;
    }) as any;

    withTransaction.mockImplementation(async (_receivedKnex, callback) => callback(trx));

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_type: 'Fixed',
    });

    await expect(service.update(
      'line-1',
      {
        cadence_owner: 'contract',
      },
      context,
    )).rejects.toThrow(CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE);

    expect(updatePayload).toBeUndefined();
  });

  it('backfills missing cadence_owner to client when updating a legacy row', async () => {
    let updatePayload: Record<string, unknown> | undefined;
    const knex = { scope: 'root-knex' };
    const trx = ((table: string) => {
      expect(table).toBe('contract_lines');
      const builder = {
        where() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return {
            returning: async () => [{
              contract_line_id: 'line-1',
              contract_line_name: 'Managed Support',
              billing_frequency: 'monthly',
              contract_line_type: 'Fixed',
              service_category: null,
              cadence_owner: null,
            }],
          };
        },
      };
      return builder;
    }) as any;

    withTransaction.mockImplementation(async (_receivedKnex, callback) => callback(trx));

    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_type: 'Fixed',
      cadence_owner: undefined,
    });

    const updated = await service.update(
      'line-1',
      {
        contract_line_name: 'Managed Support',
      } as any,
      context,
    );

    expect(updatePayload?.cadence_owner).toBe('client');
    expect(updated.cadence_owner).toBe('client');
  });
});
