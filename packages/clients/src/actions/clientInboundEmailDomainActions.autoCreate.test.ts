import { beforeEach, describe, expect, it, vi } from 'vitest';

const allowedMock = vi.fn();
let trxImpl: any;

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: (_knex: any, callback: (trx: any) => Promise<any>) => callback(trxImpl),
  tenantDb: (conn: any, tenant: string) => ({ table: (name: string) => conn(name).where({ tenant }) }),
}));
vi.mock('../lib/authHelpers', () => ({ hasMspPermission: (...args: any[]) => allowedMock(...args) }));

function makeTrx(returned: any) {
  const builder: any = {
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => returned ? [returned] : []),
  };
  const trx = vi.fn(() => builder);
  return { trx, builder };
}

describe('setClientInboundEmailDomainAutoCreateContacts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('denies callers without client update permission', async () => {
    allowedMock.mockResolvedValue(false);
    const { setClientInboundEmailDomainAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainAutoCreateContacts('client-1', 'domain-1', true))
      .resolves.toMatchObject({ permissionError: 'Permission denied: Cannot update clients' });
  });

  it('returns not found when the domain does not belong to the requested client', async () => {
    allowedMock.mockResolvedValue(true);
    const { trx, builder } = makeTrx(null);
    trxImpl = trx;
    const { setClientInboundEmailDomainAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainAutoCreateContacts('client-1', 'domain-other', true))
      .resolves.toMatchObject({ actionError: 'Inbound email domain not found.' });
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-1' });
    expect(builder.where).toHaveBeenCalledWith({ client_id: 'client-1', id: 'domain-other' });
  });

  it('updates the opt-in flag for a domain owned by the client', async () => {
    allowedMock.mockResolvedValue(true);
    const row = { id: 'domain-1', client_id: 'client-1', domain: 'example.com', auto_create_contacts: true };
    const { trx, builder } = makeTrx(row);
    trxImpl = trx;
    const { setClientInboundEmailDomainAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainAutoCreateContacts('client-1', 'domain-1', true)).resolves.toEqual(row);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ auto_create_contacts: true }));
  });
});
