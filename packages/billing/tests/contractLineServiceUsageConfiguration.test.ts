import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  baseCreate: vi.fn(),
  usageCreate: vi.fn(),
}));

vi.mock('../src/models/contractLineServiceConfiguration', () => ({
  default: class MockContractLineServiceConfiguration {
    create(...args: unknown[]) {
      return mocks.baseCreate(...args);
    }
  },
}));

vi.mock('../src/models/contractLineServiceUsageConfig', () => ({
  default: class MockContractLineServiceUsageConfig {
    create(...args: unknown[]) {
      return mocks.usageCreate(...args);
    }
  },
}));

vi.mock('../src/models/contractLineServiceFixedConfig', () => ({
  default: class MockContractLineServiceFixedConfig {},
}));

vi.mock('../src/models/contractLineServiceHourlyConfig', () => ({
  default: class MockContractLineServiceHourlyConfig {},
}));

vi.mock('../src/models/contractLineServiceBucketConfig', () => ({
  default: class MockContractLineServiceBucketConfig {},
}));

describe('ContractLineServiceConfigurationService usage configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.baseCreate.mockResolvedValue('config-1');
    mocks.usageCreate.mockResolvedValue(true);
  });

  it('passes the selected usage base rate to the persisted type configuration', async () => {
    const trx = {
      transaction: async (callback: (nestedTrx: unknown) => Promise<unknown>) => callback(trx),
    } as any;
    const { ContractLineServiceConfigurationService } = await import(
      '../src/services/contractLineServiceConfigurationService'
    );
    const service = new ContractLineServiceConfigurationService(trx, 'tenant-1');

    await service.createConfiguration(
      {
        tenant: 'tenant-1',
        contract_line_id: 'line-1',
        service_id: 'usage-service',
        configuration_type: 'Usage',
        custom_rate: 25000,
        quantity: 1,
      },
      {
        unit_of_measure: 'item',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: 25000,
      },
    );

    expect(mocks.usageCreate).toHaveBeenCalledWith({
      config_id: 'config-1',
      unit_of_measure: 'item',
      enable_tiered_pricing: false,
      minimum_usage: 0,
      base_rate: 25000,
    });
  });
});
