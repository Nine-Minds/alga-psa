import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const withTransaction = vi.fn();

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

    await expect(removeClientContractLine('line-1')).rejects.toThrow(
      'Cannot deactivate contract line assignment before 2099-01-31 as it has been invoiced through that date.'
    );

    expect(knex).toHaveBeenCalledWith('invoice_charge_details as iid');
    expect(detailBuilder.andWhere).toHaveBeenCalledWith('clsc.contract_line_id', 'line-1');
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
      editClientContractLine('line-1', { contract_line_id: 'replacement-line-2' } as any)
    ).rejects.toThrow(
      'Cannot replace contract line assignment after it has authoritative recurring detail periods through 2025-01-31. End the current line and add a new contract line instead.'
    );

    expect(knex).toHaveBeenCalledWith('invoice_charge_details as iid');
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
