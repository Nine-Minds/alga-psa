import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@alga-psa/auth/rbac';

const CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE =
  'Contract-owned cadence and mixed-cadence billing are not enabled during the client-cadence rollout.';

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
const presetCreate = vi.fn();
const presetUpdate = vi.fn();
vi.mock('../src/models/contractLinePreset', () => ({
  default: {
    findById: (...args: any[]) => presetFindById(...args),
    create: (...args: any[]) => presetCreate(...args),
    update: (...args: any[]) => presetUpdate(...args),
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
    presetCreate.mockImplementation(async (_trx: any, _tenant: string, preset: any) => ({
      preset_id: 'preset-created',
      ...preset,
    }));
    presetUpdate.mockImplementation(async (_trx: any, _tenant: string, _presetId: string, preset: any) => ({
      preset_id: 'preset-updated',
      ...preset,
    }));
    presetServiceGetByPresetId.mockResolvedValue([]);
    presetFixedConfigGetByPresetId.mockResolvedValue({
      base_rate: 5000,
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
  });

  it('T106 and T233: createCustomContractLine persists explicit client cadence_owner and defaults missing cadence and timing values to the shared recurring authoring policy', async () => {
    const { createCustomContractLine } = await import('../src/actions/contractLinePresetActions');

    await createCustomContractLine('contract-1', {
      contract_line_name: 'Managed Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      cadence_owner: 'client',
      billing_timing: 'advance',
      enable_proration: true,
      base_rate: 15000,
      services: [{ service_id: 'svc-1', quantity: 1 }],
    });

    expect(contractLineCreate.mock.calls[0]?.[1]).toMatchObject({
      cadence_owner: 'client',
      billing_timing: 'advance',
      contract_line_name: 'Managed Services',
    });
    expect(fixedConfigUpsert.mock.calls[0]?.[0]).toMatchObject({
      enable_proration: true,
      billing_cycle_alignment: 'prorated',
    });

    await createCustomContractLine('contract-1', {
      contract_line_name: 'Fallback Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      services: [{ service_id: 'svc-2', quantity: 1 }],
    });

    expect(contractLineCreate.mock.calls[1]?.[1]).toMatchObject({
      cadence_owner: 'client',
      billing_timing: 'arrears',
      contract_line_name: 'Fallback Services',
    });
    expect(fixedConfigUpsert.mock.calls[1]?.[0]).toMatchObject({
      enable_proration: false,
      billing_cycle_alignment: 'start',
    });
  });

  it('preserves explicit client cadence overrides when copying presets into live contract lines', async () => {
    presetFindById.mockResolvedValue({
      preset_id: 'preset-1',
      preset_name: 'Preset Services',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      cadence_owner: 'contract',
      minimum_billable_time: null,
      round_up_to_nearest: null,
    });

    const { copyPresetToContractLine } = await import('../src/actions/contractLinePresetActions');

    await copyPresetToContractLine('contract-1', 'preset-1', {
      cadence_owner: 'client',
    });

    expect(contractLineCreate).toHaveBeenCalledWith(
      currentTrx,
      expect.objectContaining({
        cadence_owner: 'client',
        contract_line_name: 'Preset Services',
      })
    );
  });

  it('T118: preset copies use stored cadence_owner defaults instead of inferring cadence from billing_cycle_alignment', async () => {
    const { copyPresetToContractLine } = await import('../src/actions/contractLinePresetActions');

    presetFindById.mockResolvedValueOnce({
      preset_id: 'preset-2',
      preset_name: 'Client Schedule Preset',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      cadence_owner: 'client',
      minimum_billable_time: null,
      round_up_to_nearest: null,
    });

    await copyPresetToContractLine('contract-1', 'preset-2');

    expect(contractLineCreate).toHaveBeenLastCalledWith(
      currentTrx,
      expect.objectContaining({
        cadence_owner: 'client',
        billing_timing: 'advance',
        contract_line_name: 'Client Schedule Preset',
      })
    );
    expect(presetFixedConfigGetByPresetId).toHaveBeenLastCalledWith(currentTrx, 'preset-2');
  });

  it('T143: action-layer contract line creation paths reject staged mixed-cadence writes during rollout', async () => {
    const { createCustomContractLine, copyPresetToContractLine } = await import('../src/actions/contractLinePresetActions');

    await expect(
      createCustomContractLine('contract-1', {
        contract_line_name: 'Blocked Contract Cadence',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        cadence_owner: 'contract',
        services: [{ service_id: 'svc-1', quantity: 1 }],
      }),
    ).rejects.toThrow(CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE);

    expect(contractLineCreate).not.toHaveBeenCalled();

    presetFindById.mockResolvedValueOnce({
      preset_id: 'preset-contract',
      preset_name: 'Contract Anniversary Preset',
      contract_line_type: 'Fixed',
      billing_frequency: 'monthly',
      cadence_owner: 'contract',
      minimum_billable_time: null,
      round_up_to_nearest: null,
    });

    await expect(copyPresetToContractLine('contract-1', 'preset-contract')).rejects.toThrow(
      CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE,
    );

    expect(contractLineCreate).not.toHaveBeenCalled();
  });
});
