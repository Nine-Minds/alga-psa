import { beforeEach, describe, expect, it, vi } from 'vitest';

const withTransaction = vi.fn();
const repositoryAddContractLine = vi.fn();

class MockBaseService<T> {
  constructor(_config: unknown) {}

  async getKnex(): Promise<{ knex: unknown }> {
    throw new Error('getKnex mock not provided');
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
  cloneTemplateContractLine: vi.fn(),
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
});
