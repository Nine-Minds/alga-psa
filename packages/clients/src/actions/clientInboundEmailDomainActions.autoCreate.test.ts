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

function makeTrx(rowsById: Record<string, any>) {
  const builder: any = {
    where: vi.fn((criteria: any) => {
      if (criteria?.id) builder.lastId = criteria.id;
      return builder;
    }),
    update: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => rowsById[builder.lastId] ? [rowsById[builder.lastId]] : []),
  };
  const trx = vi.fn(() => builder);
  return { trx, builder };
}

describe('setClientInboundEmailDomainsAutoCreateContacts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('denies callers without client update permission', async () => {
    allowedMock.mockResolvedValue(false);
    const { setClientInboundEmailDomainsAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainsAutoCreateContacts('client-1', [{ domainId: 'domain-1', enabled: true }]))
      .resolves.toMatchObject({ permissionError: 'Permission denied: Cannot update clients' });
  });

  it('returns not found when a domain does not belong to the requested client', async () => {
    allowedMock.mockResolvedValue(true);
    const { trx, builder } = makeTrx({});
    trxImpl = trx;
    const { setClientInboundEmailDomainsAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainsAutoCreateContacts('client-1', [{ domainId: 'domain-other', enabled: true }]))
      .resolves.toMatchObject({ actionError: 'Inbound email domain not found.' });
    expect(builder.where).toHaveBeenCalledWith({ tenant: 'tenant-1' });
    expect(builder.where).toHaveBeenCalledWith({ client_id: 'client-1', id: 'domain-other' });
  });

  it('updates every staged opt-in flag for domains owned by the client', async () => {
    allowedMock.mockResolvedValue(true);
    const on = { id: 'domain-1', client_id: 'client-1', domain: 'example.com', auto_create_contacts: true };
    const off = { id: 'domain-2', client_id: 'client-1', domain: 'example.org', auto_create_contacts: false };
    const { trx, builder } = makeTrx({ 'domain-1': on, 'domain-2': off });
    trxImpl = trx;
    const { setClientInboundEmailDomainsAutoCreateContacts } = await import('./clientInboundEmailDomainActions');
    await expect(setClientInboundEmailDomainsAutoCreateContacts('client-1', [
      { domainId: 'domain-1', enabled: true },
      { domainId: 'domain-2', enabled: false },
    ])).resolves.toEqual([on, off]);
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ auto_create_contacts: true }));
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ auto_create_contacts: false }));
  });
});
