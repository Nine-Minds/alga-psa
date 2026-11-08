import { beforeEach, describe, expect, it, vi } from 'vitest';
const withTransaction = vi.fn();
const publishEvent = vi.fn();

class MockBaseService<T> {
  constructor(_config?: unknown) {}

  async getKnex(): Promise<{ knex: unknown }> {
    throw new Error('getKnex mock not provided');
  }

  async addCreateAuditFields(_conn: unknown, data: Record<string, unknown>, context: { tenant: string }) {
    return {
      ...data,
      tenant: context.tenant,
    };
  }

  // Real BaseService drops audit columns the table lacks (contract_lines has no created_by/updated_by).
  async filterAuditFields(_conn: unknown, data: Record<string, unknown>) {
    return data;
  }

  async addUpdateAuditFields(_conn: unknown, data: Record<string, unknown>) {
    return { ...data };
  }
}

vi.mock('@alga-psa/db', () => ({
  BaseService: MockBaseService,
  withTransaction: (...args: any[]) => withTransaction(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
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
  publishUnregisteredEventType: (...args: any[]) => publishEvent(...args),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
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

  it('allows contract cadence on create and still defaults missing cadence_owner to client', async () => {
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

    await service.create(
      {
        contract_line_name: 'Managed Support',
        billing_frequency: 'monthly',
        contract_line_type: 'Fixed',
        cadence_owner: 'contract',
      },
      context,
    );

    expect(insertPayload?.cadence_owner).toBe('contract');

    await service.create(
      {
        contract_line_name: 'Managed Support',
        billing_frequency: 'monthly',
        contract_line_type: 'Fixed',
      },
      context,
    );

    expect(insertPayload?.cadence_owner).toBe('client');
    expect(publishEvent).toHaveBeenCalledTimes(2);
  });

  it('allows contract cadence on update', async () => {
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

    await service.update(
      'line-1',
      {
        cadence_owner: 'contract',
      },
      context,
    );

    expect(updatePayload?.cadence_owner).toBe('contract');
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
  function updateHarness(existing: Record<string, unknown>) {
    const captured: { payload?: Record<string, unknown> } = {};
    const knex = { scope: 'root-knex' };
    const trx = ((_table: string) => {
      const builder = {
        where() {
          return builder;
        },
        // attachPrepaidBlocks reads the Prepaid Block overlay after the update.
        whereIn() {
          return builder;
        },
        select: async () => [],
        update(payload: Record<string, unknown>) {
          captured.payload = payload;
          return { returning: async () => [{ ...existing, ...payload }] };
        },
      };
      return builder;
    }) as any;
    withTransaction.mockImplementation(async (_receivedKnex, callback) => callback(trx));
    return { knex, captured };
  }

  it('resets inherited advance timing to arrears when a Fixed advance line is changed to Hourly (REST path)', async () => {
    const { knex, captured } = updateHarness({ contract_line_id: 'line-1', billing_frequency: 'monthly' });
    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_type: 'Fixed',
      billing_timing: 'advance',
      cadence_owner: 'client',
    });

    await service.update('line-1', { contract_line_type: 'Hourly' } as any, { tenant: 'tenant-1', userId: 'user-1' } as any);

    expect(captured.payload?.billing_timing).toBe('arrears');
  });

  it('rejects explicit advance on an Hourly line (REST path)', async () => {
    const { knex, captured } = updateHarness({ contract_line_id: 'line-1' });
    const { ContractLineService } = await import('server/src/lib/api/services/ContractLineService');
    const service = new ContractLineService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getExistingPlan').mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_type: 'Hourly',
      billing_timing: 'arrears',
      cadence_owner: 'client',
    });

    await expect(
      service.update('line-1', { billing_timing: 'advance' } as any, { tenant: 'tenant-1', userId: 'user-1' } as any),
    ).rejects.toThrow(/advance/i);
    expect(captured.payload).toBeUndefined();
  });
});
