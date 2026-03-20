import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const createTenantKnex = vi.fn();
const withTransaction = vi.fn();
const cloneTemplateContractLineAsync = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: (...args: any[]) => withTransaction(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  withAuthCheck: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../../../../../packages/clients/src/lib/billingHelpers.ts', () => ({
  cloneTemplateContractLineAsync: (...args: any[]) => cloneTemplateContractLineAsync(...args),
}));

function createAddClientContractLineTrx(options?: { templateContractId?: string | null }) {
  const createdLine = { contract_line_id: 'generated-line-id' };
  const templateLine = {
    contract_line_name: 'Managed Service',
    description: 'Primary recurring support',
    billing_frequency: 'Monthly',
    contract_line_type: 'Fixed',
    service_category: 'category-1',
    billing_timing: 'arrears',
    cadence_owner: 'client',
    custom_rate: 175,
    display_order: 0,
    enable_proration: true,
    enable_overtime: false,
    overtime_rate: null,
    overtime_threshold: null,
    enable_after_hours_rate: false,
    after_hours_multiplier: null,
  };

  let contractLineFirstCall = 0;
  const contractLinesBuilder: any = {
    where: vi.fn(() => contractLinesBuilder),
    whereRaw: vi.fn(() => contractLinesBuilder),
    first: vi.fn(async () => {
      contractLineFirstCall += 1;
      return contractLineFirstCall === 1 ? templateLine : null;
    }),
    insert: vi.fn(() => contractLinesBuilder),
    returning: vi.fn(async () => [createdLine]),
  };

  const clientContractsBuilder: any = {
    where: vi.fn(() => clientContractsBuilder),
    first: vi.fn(async () => ({
      contract_id: 'client-contract-template-target',
      template_contract_id:
        options && 'templateContractId' in options ? options.templateContractId : 'template-contract-1',
    })),
  };

  const trx: any = vi.fn((table: string) => {
    if (table === 'client_contracts') {
      return clientContractsBuilder;
    }

    if (table === 'contract_lines') {
      return contractLinesBuilder;
    }

    throw new Error(`Unexpected table ${table}`);
  });

  trx.fn = {
    now: vi.fn(() => '2026-03-17T00:00:00.000Z'),
  };
  trx.raw = vi.fn(() => 'generated-line-id');

  return {
    trx,
    createdLine,
    contractLinesBuilder,
    clientContractsBuilder,
  };
}

describe('client contract line replacement identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T203: addClientContractLine creates a fresh contract line identity so a superseded billed line can be replaced without mutating historical recurring detail periods', async () => {
    const { trx, contractLinesBuilder } = createAddClientContractLineTrx();

    createTenantKnex.mockResolvedValue({ knex: {} });
    withTransaction.mockImplementation(async (_knex: unknown, callback: any) => callback(trx));

    const { addClientContractLine } = await import('../../../../../packages/clients/src/actions/clientContractLineActions.ts');

    await addClientContractLine({
      client_id: 'client-1',
      client_contract_id: 'client-contract-1',
      contract_line_id: 'template-line-1',
      start_date: '2026-04-01',
      end_date: null,
      is_active: true,
      service_category: 'category-1',
      custom_rate: 200,
    } as any);

    expect(trx.raw).toHaveBeenCalledWith('gen_random_uuid()');
    expect(contractLinesBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contract_line_id: 'generated-line-id',
        contract_id: 'client-contract-template-target',
      })
    );
    expect(cloneTemplateContractLineAsync).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        templateContractLineId: 'template-line-1',
        contractLineId: 'generated-line-id',
        templateContractId: 'template-contract-1',
      })
    );
  });

  it('T008: addClientContractLine fails closed when template provenance is missing instead of falling back to contract_id', async () => {
    const { trx, contractLinesBuilder } = createAddClientContractLineTrx({ templateContractId: null });

    createTenantKnex.mockResolvedValue({ knex: {} });
    withTransaction.mockImplementation(async (_knex: unknown, callback: any) => callback(trx));

    const { addClientContractLine } = await import('../../../../../packages/clients/src/actions/clientContractLineActions.ts');

    await expect(
      addClientContractLine({
        client_id: 'client-1',
        client_contract_id: 'client-contract-1',
        contract_line_id: 'template-line-1',
        start_date: '2026-04-01',
        end_date: null,
        is_active: true,
      } as any),
    ).rejects.toThrow(
      'Client contract client-contract-1 is missing template provenance (template_contract_id) required to clone template contract lines',
    );

    expect(contractLinesBuilder.insert).not.toHaveBeenCalled();
    expect(cloneTemplateContractLineAsync).not.toHaveBeenCalled();
  });

  it('T203: server assignPlanToClient keeps renewed/replacement assignments on fresh line ids instead of mutating the superseded line source', () => {
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/lib/api/services/ContractLineService.ts'),
      'utf8'
    );

    expect(serviceSource).toContain(
      'Renewed or replacement assignments must create a fresh line identity'
    );
    expect(serviceSource).toContain('const newContractLineId = uuidv4();');
    expect(serviceSource).toContain('contract_line_id: newContractLineId,');
    expect(serviceSource).toContain('contractLineId: newContractLineId,');
  });
});
