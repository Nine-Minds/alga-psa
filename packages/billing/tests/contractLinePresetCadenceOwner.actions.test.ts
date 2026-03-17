import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@alga-psa/auth/rbac';

const createTenantKnex = vi.fn();
let currentTrx: any;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: async (_knex: unknown, fn: any) => fn(currentTrx),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

const analyticsCapture = vi.fn();
vi.mock('../src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => ({
    analytics: { capture: analyticsCapture },
    AnalyticsEvents: {
      BILLING_RULE_CREATED: 'billing_rule_created',
      BILLING_RULE_UPDATED: 'billing_rule_updated',
    },
  })),
}));

const contractLineCreate = vi.fn();
vi.mock('../src/models/contractLine', () => ({
  default: {
    create: (...args: any[]) => contractLineCreate(...args),
  },
}));

const presetFindById = vi.fn();
vi.mock('../src/models/contractLinePreset', () => ({
  default: {
    findById: (...args: any[]) => presetFindById(...args),
  },
}));

const presetServiceGetByPresetId = vi.fn();
vi.mock('../src/models/contractLinePresetService', () => ({
  default: {
    getByPresetId: (...args: any[]) => presetServiceGetByPresetId(...args),
  },
}));

const presetFixedConfigGetByPresetId = vi.fn();
vi.mock('../src/models/contractLinePresetFixedConfig', () => ({
  default: {
    getByPresetId: (...args: any[]) => presetFixedConfigGetByPresetId(...args),
  },
}));

const fixedConfigUpsert = vi.fn();
vi.mock('../src/models/contractLineFixedConfig', () => ({
  default: vi.fn().mockImplementation(() => ({
    upsert: (...args: any[]) => fixedConfigUpsert(...args),
  })),
}));

const createConfiguration = vi.fn();
vi.mock('../src/services/contractLineServiceConfigurationService', () => ({
  ContractLineServiceConfigurationService: vi.fn().mockImplementation(() => ({
    createConfiguration: (...args: any[]) => createConfiguration(...args),
  })),
}));

const makeTrx = () => {
  const contractLinesBuilder: any = {};
  contractLinesBuilder.where = vi.fn(() => contractLinesBuilder);
  contractLinesBuilder.count = vi.fn(() => contractLinesBuilder);
  contractLinesBuilder.first = vi.fn(async () => ({ count: '0' }));
  contractLinesBuilder.update = vi.fn(async () => 1);

  const contractLineServicesInsert = vi.fn(async () => []);

  const trx: any = vi.fn((table: string) => {
    if (table === 'contract_lines') {
      return contractLinesBuilder;
    }

    if (table === 'contract_line_services') {
      return {
        insert: contractLineServicesInsert,
      };
    }

    throw new Error(`Unexpected table access: ${table}`);
  });

  trx.fn = {
    now: vi.fn(() => 'now'),
  };

  return {
    trx,
    contractLineServicesInsert,
  };
};

describe('contract line cadence_owner action persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockReturnValue(true);
    const { trx } = makeTrx();
    currentTrx = trx;
    createTenantKnex.mockResolvedValue({ knex: {} });
    contractLineCreate.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_line_name: 'Managed Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
    });
    presetServiceGetByPresetId.mockResolvedValue([]);
    presetFixedConfigGetByPresetId.mockResolvedValue({
      base_rate: 5000,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
  });

  it('T106: createCustomContractLine persists explicit cadence_owner and defaults missing values to client', async () => {
    const { createCustomContractLine } = await import('../src/actions/contractLinePresetActions');

    await createCustomContractLine('contract-1', {
      contract_line_name: 'Managed Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      cadence_owner: 'contract',
      base_rate: 15000,
      services: [{ service_id: 'svc-1', quantity: 1 }],
    });

    expect(contractLineCreate.mock.calls[0]?.[1]).toMatchObject({
      cadence_owner: 'contract',
      contract_line_name: 'Managed Services',
    });

    await createCustomContractLine('contract-1', {
      contract_line_name: 'Fallback Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      services: [{ service_id: 'svc-2', quantity: 1 }],
    });

    expect(contractLineCreate.mock.calls[1]?.[1]).toMatchObject({
      cadence_owner: 'client',
      contract_line_name: 'Fallback Services',
    });
  });

  it('persists cadence_owner overrides when copying presets into live contract lines', async () => {
    presetFindById.mockResolvedValue({
      preset_id: 'preset-1',
      preset_name: 'Preset Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      minimum_billable_time: null,
      round_up_to_nearest: null,
    });

    const { copyPresetToContractLine } = await import('../src/actions/contractLinePresetActions');

    await copyPresetToContractLine('contract-1', 'preset-1', {
      cadence_owner: 'contract',
    });

    expect(contractLineCreate).toHaveBeenCalledWith(
      currentTrx,
      expect.objectContaining({
        cadence_owner: 'contract',
        contract_line_name: 'Preset Services',
      })
    );
  });
});
