import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const cloneTemplateContractLineAsyncMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('../lib/billingHelpers', () => ({
  cloneTemplateContractLineAsync: (...args: any[]) => cloneTemplateContractLineAsyncMock(...args),
}));

function buildReadTrx(rows: any[]) {
  const trx = ((table: string) => {
    if (table !== 'contract_lines as cl') {
      throw new Error(`Unexpected read table: ${table}`);
    }

    const builder: any = {};
    builder.join = vi.fn(() => builder);
    builder.leftJoin = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.andWhere = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.orderBy = vi.fn().mockResolvedValue(rows);
    return builder;
  }) as any;

  trx.raw = vi.fn((value: string) => value);
  return trx;
}

function buildWriteTrx(params: { templateLine: Record<string, unknown>; insertMock: any }) {
  const { templateLine, insertMock } = params;

  const trx = ((table: string) => {
    if (table === 'client_contracts') {
      return {
        where: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({
            template_contract_id: 'template-contract-1',
            contract_id: 'live-contract-1',
          }),
        })),
      };
    }

    if (table === 'contract_lines') {
      return {
        where: vi.fn((criteria: Record<string, unknown>) => {
          if (
            criteria.contract_line_id === templateLine.contract_line_id &&
            criteria.tenant === 'tenant-1' &&
            !('contract_id' in criteria)
          ) {
            return {
              first: vi.fn().mockResolvedValue(templateLine),
            };
          }

          if (
            criteria.contract_id === 'live-contract-1' &&
            criteria.tenant === 'tenant-1' &&
            criteria.is_active === true
          ) {
            return {
              whereRaw: vi.fn(() => ({
                first: vi.fn().mockResolvedValue(null),
              })),
            };
          }

          throw new Error(`Unexpected contract_lines where criteria: ${JSON.stringify(criteria)}`);
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertMock(payload);
          return {
            returning: vi.fn().mockResolvedValue([{ contract_line_id: 'new-line-1' }]),
          };
        }),
      };
    }

    throw new Error(`Unexpected write table: ${table}`);
  }) as any;

  trx.raw = vi.fn(() => 'generated-contract-line-id');
  trx.fn = {
    now: vi.fn(() => 'NOW'),
  };

  return trx;
}

describe('clientContractLineActions recurring compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'user-1',
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    cloneTemplateContractLineAsyncMock.mockResolvedValue(undefined);
  });

  it('normalizes partially migrated recurring fields when reading and cloning client contract lines', async () => {
    const insertMock = vi.fn();

    withTransactionMock
      .mockImplementationOnce(async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(
          buildReadTrx([
            {
              tenant: 'tenant-1',
              client_contract_line_id: 'line-1',
              client_id: 'client-1',
              contract_line_id: 'line-1',
              contract_line_name: 'Managed Firewall',
              billing_frequency: 'Monthly',
              billing_timing: null,
              cadence_owner: null,
              start_date: '2026-01-08',
              end_date: null,
              is_active: true,
              client_contract_id: 'client-contract-1',
            },
          ]),
        ),
      )
      .mockImplementationOnce(async (_db: any, callback: (trx: any) => Promise<any>) =>
        callback(
          buildWriteTrx({
            templateLine: {
              contract_line_id: 'template-line-1',
              contract_line_name: 'Managed Firewall',
              description: 'Template line',
              billing_frequency: 'Monthly',
              contract_line_type: 'Fixed',
              service_category: 'service-cat-1',
              billing_timing: null,
              cadence_owner: null,
              custom_rate: 15000,
              display_order: 0,
              enable_proration: false,
              enable_overtime: false,
              overtime_rate: null,
              overtime_threshold: null,
              enable_after_hours_rate: false,
              after_hours_multiplier: null,
            },
            insertMock,
          }),
        ),
      );

    const { addClientContractLine, getClientContractLine } = await import('./clientContractLineActions');

    const readLines = await getClientContractLine('client-1');
    expect(readLines).toHaveLength(1);
    expect(readLines[0]).toMatchObject({
      billing_timing: 'arrears',
      cadence_owner: 'client',
      start_date: '2026-01-08',
      end_date: null,
      template_contract_id: null,
    });

    await addClientContractLine({
      client_id: 'client-1',
      client_contract_id: 'client-contract-1',
      contract_line_id: 'template-line-1',
      start_date: '2026-01-08',
      is_active: true,
    } as any);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billing_timing: 'arrears',
        cadence_owner: 'client',
      }),
    );
    expect(cloneTemplateContractLineAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateContractLineId: 'template-line-1',
        contractLineId: 'new-line-1',
      }),
    );
  });
});
