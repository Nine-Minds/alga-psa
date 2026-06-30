import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const withTransaction = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  withTransaction: (...args: any[]) => withTransaction(...args),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  withAuthCheck: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

// Grant the MSP permission gate so the domain guards under test actually run.
vi.mock('../../../../../packages/clients/src/lib/authHelpers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  assertMspPermission: vi.fn(async () => {}),
}));

function createCanonicalDetailBuilder(servicePeriodEnd: string) {
  const builder: any = {
    join: vi.fn(() => builder),
    where: vi.fn(() => builder),
    andWhere: vi.fn(() => builder),
    whereNotNull: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    first: vi.fn(async () => ({ service_period_end: servicePeriodEnd })),
  };

  return builder;
}

// Mutations now require an assignment-scoped composite identity:
// contract-<client_contract_id>-<contract_line_id>
const CLIENT_CONTRACT_ID = '11111111-1111-1111-1111-111111111111';
const CONTRACT_LINE_ID = '22222222-2222-2222-2222-222222222222';
const ASSIGNMENT_SCOPED_LINE_ID = `contract-${CLIENT_CONTRACT_ID}-${CONTRACT_LINE_ID}`;

describe('client contract line mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T202: removeClientContractLine uses canonical recurring detail periods when enforcing billed-through deactivation guards', async () => {
    const detailBuilder = createCanonicalDetailBuilder('2099-01-31');
    const knex = vi.fn((table: string) => {
      if (table === 'invoice_charge_details as iid') {
        return detailBuilder;
      }

      throw new Error(`Unexpected table ${table}`);
    });

    createTenantKnex.mockResolvedValue({ knex });

    const { removeClientContractLine } = await import('@alga-psa/clients/actions/clientContractLineActions');

    await expect(removeClientContractLine(ASSIGNMENT_SCOPED_LINE_ID)).rejects.toThrow(
      'Cannot deactivate contract line assignment before 2099-01-31 as it has been invoiced through that date.'
    );

    expect(knex).toHaveBeenCalledWith('invoice_charge_details as iid');
    expect(detailBuilder.andWhere).toHaveBeenCalledWith('clsc.contract_line_id', ASSIGNMENT_SCOPED_LINE_ID);
    expect(detailBuilder.first).toHaveBeenCalledWith('iid.service_period_end');
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('T202: editClientContractLine blocks replacement when canonical recurring detail periods already exist', async () => {
    const detailBuilder = createCanonicalDetailBuilder('2025-01-31');
    const knex = vi.fn((table: string) => {
      if (table === 'invoice_charge_details as iid') {
        return detailBuilder;
      }

      throw new Error(`Unexpected table ${table}`);
    });

    createTenantKnex.mockResolvedValue({ knex });

    const { editClientContractLine } = await import('@alga-psa/clients/actions/clientContractLineActions');

    await expect(
      editClientContractLine(ASSIGNMENT_SCOPED_LINE_ID, { contract_line_id: 'replacement-line-2' } as any)
    ).rejects.toThrow(
      'Cannot replace contract line assignment after it has authoritative recurring detail periods through 2025-01-31. End the current line and add a new contract line instead.'
    );

    expect(knex).toHaveBeenCalledWith('invoice_charge_details as iid');
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
