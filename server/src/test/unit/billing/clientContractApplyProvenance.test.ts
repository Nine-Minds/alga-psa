import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const withTransaction = vi.fn();
const cloneTemplateContractLineAsync = vi.fn();

const getById = vi.fn();
const getContractLines = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: (...args: any[]) => withTransaction(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../../../../../packages/clients/src/models/clientContract.ts', () => ({
  default: {
    getById: (...args: any[]) => getById(...args),
    getContractLines: (...args: any[]) => getContractLines(...args),
  },
}));

vi.mock('../../../../../packages/clients/src/lib/billingHelpers.ts', () => ({
  cloneTemplateContractLineAsync: (...args: any[]) => cloneTemplateContractLineAsync(...args),
}));

describe('client contract apply provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnex.mockResolvedValue({ knex: {} });
    cloneTemplateContractLineAsync.mockResolvedValue(undefined);
  });

  it('T003: applyContractToClient uses explicit template provenance and does not infer template source from contract_id', async () => {
    getById.mockResolvedValue({
      client_contract_id: 'client-contract-1',
      contract_id: 'live-contract-1',
      template_contract_id: 'template-contract-1',
      start_date: '2026-03-20',
    });
    getContractLines.mockResolvedValue([
      {
        contract_line_id: 'line-1',
        custom_rate: 180,
      },
    ]);

    const trx = { scope: 'trx' } as any;
    withTransaction.mockImplementation(async (_knex: unknown, callback: any) => callback(trx));

    const { applyContractToClient } = await import('../../../../../packages/clients/src/actions/clientContractActions.ts');

    await applyContractToClient('client-contract-1');

    expect(cloneTemplateContractLineAsync).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        templateContractId: 'template-contract-1',
        templateContractLineId: 'line-1',
      }),
    );
  });

  it('T005: applyContractToClient fails closed when template provenance is missing', async () => {
    getById.mockResolvedValue({
      client_contract_id: 'client-contract-1',
      contract_id: 'live-contract-1',
      template_contract_id: null,
      start_date: '2026-03-20',
    });
    getContractLines.mockResolvedValue([
      {
        contract_line_id: 'line-1',
        custom_rate: 180,
      },
    ]);

    const trx = { scope: 'trx' } as any;
    withTransaction.mockImplementation(async (_knex: unknown, callback: any) => callback(trx));

    const { applyContractToClient } = await import('../../../../../packages/clients/src/actions/clientContractActions.ts');

    await expect(applyContractToClient('client-contract-1')).rejects.toThrow(
      'Client contract client-contract-1 is missing template provenance (template_contract_id) required for template clone operations',
    );

    expect(cloneTemplateContractLineAsync).not.toHaveBeenCalled();
  });
});
