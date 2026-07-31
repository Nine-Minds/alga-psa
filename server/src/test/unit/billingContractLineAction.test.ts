import { describe, it, expect, afterEach, vi } from 'vitest';
import { getContractLines, createContractLine } from '@alga-psa/billing/actions/contractLineAction';
import ContractLine from '@alga-psa/billing/models/contractLine';
import { IContractLine } from '@alga-psa/types';

vi.mock('@alga-psa/billing/models/contractLine');

// The actions resolve their connection and transactions through @alga-psa/db.
vi.mock('@alga-psa/db', () => {
  const trx = Object.assign(vi.fn().mockReturnThis(), { raw: vi.fn() });
  return {
    createTenantKnex: vi.fn(async () => ({ knex: vi.fn(), tenant: 'test-tenant' })),
    withTransaction: vi.fn(async (_knex: any, handler: any) => handler(trx)),
    runWithTenant: vi.fn(async (_tenant: string, cb: any) => cb()),
    getCurrentTenantId: vi.fn(() => 'test-tenant'),
    getTenantContext: vi.fn(async () => 'test-tenant'),
    getTenantIdBySlug: vi.fn(async () => 'test-tenant'),
    registerAfterCommit: vi.fn(),
  };
});

// Permission checks now go through @alga-psa/auth/rbac inside the transaction.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// Analytics + permission helpers used by the billing actions.
vi.mock('@alga-psa/billing/lib/authHelpers', () => ({
  getCurrentUserAsync: vi.fn(async () => ({ user_id: 'test-user-id' })),
  getSessionAsync: vi.fn(async () => null),
  hasPermissionAsync: vi.fn(async () => true),
  getAnalyticsAsync: vi.fn(async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: { BILLING_RULE_CREATED: 'billing_rule_created' },
  })),
  trackAnalyticsEventAsync: vi.fn(async () => undefined),
}));

// Recurring service-period sync runs after create; keep the unit DB-free.
vi.mock('@alga-psa/billing/actions/recurringServicePeriodSync', () => ({
  syncRecurringServicePeriodsForContractLine: vi.fn(async () => undefined),
}));

describe('Contract Line Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getContractLines', () => {
    it('should return all contract lines', async () => {
      const mockContractLines: IContractLine[] = [
        {
          contract_line_id: '1',
          contract_line_name: 'Basic',
          billing_frequency: 'monthly',
          is_custom: false,
          contract_line_type: 'Fixed'
        },
        {
          contract_line_id: '2',
          contract_line_name: 'Pro',
          billing_frequency: 'yearly',
          is_custom: false,
          contract_line_type: 'Hourly'
        },
      ];

      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(mockContractLines);

      const result = await getContractLines();

      // Production normalizes recurring storage onto each returned line.
      expect(result).toEqual(mockContractLines.map((line) => ({
        ...line,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      })));
      expect(ContractLine.getAll).toHaveBeenCalled();
    });

    it('should throw an error if fetching contract lines fails', async () => {
      (ContractLine.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      // Production preserves the original Error message when the model throws.
      await expect(getContractLines()).rejects.toThrow('Database error');
    });
  });

  describe('createContractLine', () => {
    it('should create a new contract line', async () => {
      const newContractLine: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Contract Line',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      const createdContractLine: IContractLine = { ...newContractLine, contract_line_id: '3' };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdContractLine);

      const result = await createContractLine(newContractLine);

      // Production enriches the created line with normalized recurring storage.
      expect(result).toEqual({
        ...createdContractLine,
        billing_timing: 'arrears',
        cadence_owner: 'client',
      });
      // Production resolves the recurring authoring policy before persisting.
      expect(ContractLine.create).toHaveBeenCalledWith(
        expect.anything(),
        {
          ...newContractLine,
          billing_timing: 'arrears',
          cadence_owner: 'client',
        }
      );
    });

    it('should throw an error if creating a contract line fails', async () => {
      const newContractLine: Omit<IContractLine, 'contract_line_id'> = {
        contract_line_name: 'New Contract Line',
        billing_frequency: 'monthly',
        is_custom: true,
        contract_line_type: 'Fixed',
      };

      (ContractLine.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      // Production preserves the original Error message when the model throws.
      await expect(createContractLine(newContractLine)).rejects.toThrow('Database error');
    });
  });
});
