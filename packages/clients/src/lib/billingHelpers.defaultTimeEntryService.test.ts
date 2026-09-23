import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateClientBillingSettings = vi.fn();
const mockHasPermission = vi.fn(async (..._args: unknown[]) => true);

class MockInvalidDefaultTimeEntryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDefaultTimeEntryServiceError';
  }
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({})),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => null }) }) }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => (...args: unknown[]) =>
    (fn as (...a: unknown[]) => unknown)({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  withAuthCheck: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

// billingHelpers pulls a large barrel; provide exactly the runtime exports it
// imports, overriding the writer under test and its typed error.
vi.mock('@alga-psa/shared/billingClients', () => {
  const names = [
    'addTaxRate', 'applyClientCadenceChange', 'canClientOverrideTaxSource',
    'cloneTemplateContractLine', 'createDefaultTaxSettings', 'createNextBillingCycle',
    'createService', 'deleteService', 'getActiveTaxRegions', 'getClientBillingCycleAnchor',
    'getClientBillingSettings', 'getClientTaxExemptStatus', 'getClientTaxSettings',
    'getContractLines', 'getContractLineServices', 'getContracts', 'getDefaultInvoiceTemplate',
    'getEffectiveTaxSourceForClient', 'getInvoiceTemplates', 'getServiceCategories',
    'getServices', 'getServiceTypesForSelection', 'getTaxRates', 'normalizeAnchorSettingsForCycle',
    'previewBillingHistoryBootstrap', 'previewBillingPeriodsForSchedule',
    'previewClientCadenceScheduleChange', 'resolveCreditDrawdownPolicy', 'setClientTemplate',
    'updateClientTaxExemptStatus', 'updateClientTaxSettings', 'updateService',
  ];
  const mod: Record<string, unknown> = {};
  for (const name of names) mod[name] = vi.fn();
  mod.updateClientBillingSettings = (...args: unknown[]) => mockUpdateClientBillingSettings(...args);
  mod.InvalidDefaultTimeEntryServiceError = MockInvalidDefaultTimeEntryServiceError;
  return mod;
});

const { updateClientContractLineSettingsAsync } = await import('./billingHelpers');

describe('updateClientContractLineSettingsAsync default time-entry service guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockResolvedValue(true);
    mockUpdateClientBillingSettings.mockResolvedValue(undefined);
  });

  it('returns success when the shared writer accepts the value', async () => {
    const result = await updateClientContractLineSettingsAsync('client-1', {
      defaultTimeEntryServiceId: 'service-client',
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockUpdateClientBillingSettings).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'client-1',
      expect.objectContaining({ defaultTimeEntryServiceId: 'service-client' })
    );
  });

  it('returns an actionable error and no success when the shared writer rejects the value', async () => {
    mockUpdateClientBillingSettings.mockRejectedValueOnce(
      new MockInvalidDefaultTimeEntryServiceError(
        'The default time-entry service must be covered by an active contract for this client.'
      )
    );

    const result = await updateClientContractLineSettingsAsync('client-1', {
      defaultTimeEntryServiceId: 'client-inapplicable-service',
    } as never);

    expect(result).toMatchObject({ actionError: expect.any(String) });
    expect(result).not.toHaveProperty('success');
  });

  it('clears the client default without rejecting', async () => {
    const result = await updateClientContractLineSettingsAsync('client-1', {
      defaultTimeEntryServiceId: null,
    } as never);

    expect(result).toEqual({ success: true });
    expect(mockUpdateClientBillingSettings).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'client-1',
      expect.objectContaining({ defaultTimeEntryServiceId: null })
    );
  });
});
