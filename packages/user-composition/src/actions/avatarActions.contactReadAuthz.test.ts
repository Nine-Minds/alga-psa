import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-session' };
let contacts: string[] = ['contact-1'];
const hasPermissionMock = vi.fn();
const getContactAvatarUrlMock = vi.fn();
const getEntityImageUrlsBatchMock = vi.fn();
const tenantDbMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    if (!currentUser) throw new Error('User not authenticated');
    return action(currentUser, { tenant: 'tenant-session' }, ...args);
  },
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  tenantDb: (...args: any[]) => tenantDbMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('../lib/avatarUtils', () => ({
  getUserAvatarUrl: vi.fn(),
  getContactAvatarUrl: (...args: any[]) => getContactAvatarUrlMock(...args),
  getClientLogoUrl: vi.fn(),
  getEntityImageUrlsBatch: (...args: any[]) => getEntityImageUrlsBatchMock(...args),
}));

describe('contact avatar read action authorization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    currentUser = { user_id: 'internal-1', user_type: 'internal', tenant: 'tenant-session' };
    contacts = ['contact-1'];
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: any, callback: (trx: any) => unknown) => callback({}));
    tenantDbMock.mockImplementation((_trx: any, tenant: string) => {
      if (tenant !== 'tenant-session') throw new Error(`unexpected tenant ${tenant}`);
      return { table: () => {
        const query: any = {};
        query.select = () => query;
        query.whereIn = (_column: string, ids: string[]) => {
          query.ids = ids;
          return query;
        };
        query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
          contacts.filter((id) => query.ids.includes(id)).map((contact_name_id) => ({ contact_name_id })),
        ).then(resolve);
        return query;
      } };
    });
    getContactAvatarUrlMock.mockResolvedValue('/api/documents/view/file-1?t=1');
    getEntityImageUrlsBatchMock.mockImplementation(async (_type: string, ids: string[], tenant: string) =>
      new Map(ids.map((id) => [id, `/api/documents/view/${id}?tenant=${tenant}`])),
    );
  });

  async function actions() {
    return await import('./avatarActions');
  }

  it.each(['single', 'batch'] as const)('requires authentication for %s reads', async (surface) => {
    currentUser = null;
    const module = await actions();
    await expect(surface === 'single'
      ? module.getContactAvatarUrlAction('contact-1', 'tenant-session')
      : module.getContactAvatarUrlsBatchAction(['contact-1'], 'tenant-session'))
      .rejects.toThrow('User not authenticated');
    expect(getContactAvatarUrlMock).not.toHaveBeenCalled();
    expect(getEntityImageUrlsBatchMock).not.toHaveBeenCalled();
  });

  it.each(['single', 'batch'] as const)('denies same-tenant contacts without contact:read on %s reads before URL resolution', async (surface) => {
    hasPermissionMock.mockResolvedValue(false);
    const module = await actions();
    const result = surface === 'single'
      ? await module.getContactAvatarUrlAction('contact-1', 'tenant-session')
      : (await module.getContactAvatarUrlsBatchAction(['contact-1'], 'tenant-session')).get('contact-1');
    expect(result).toBeNull();
    expect(getContactAvatarUrlMock).not.toHaveBeenCalled();
    expect(getEntityImageUrlsBatchMock).not.toHaveBeenCalled();
  });

  it.each(['single', 'batch'] as const)('denies a foreign-tenant contact even when that tenant is supplied to %s', async (surface) => {
    contacts = [];
    const module = await actions();
    const result = surface === 'single'
      ? await module.getContactAvatarUrlAction('foreign-contact', 'tenant-foreign')
      : (await module.getContactAvatarUrlsBatchAction(['foreign-contact'], 'tenant-foreign')).get('foreign-contact');
    expect(result).toBeNull();
    expect(tenantDbMock).toHaveBeenCalledWith({}, 'tenant-session');
    expect(getContactAvatarUrlMock).not.toHaveBeenCalled();
    expect(getEntityImageUrlsBatchMock).not.toHaveBeenCalled();
  });

  it.each(['single', 'batch'] as const)('returns authorized same-tenant avatar URLs on %s reads', async (surface) => {
    const module = await actions();
    const result = surface === 'single'
      ? await module.getContactAvatarUrlAction('contact-1', 'tenant-foreign')
      : (await module.getContactAvatarUrlsBatchAction(['contact-1'], 'tenant-foreign')).get('contact-1');
    expect(result).toContain('/api/documents/view/');
    if (surface === 'single') {
      expect(getContactAvatarUrlMock).toHaveBeenCalledWith('contact-1', 'tenant-session');
      expect(getEntityImageUrlsBatchMock).not.toHaveBeenCalled();
    } else {
      expect(getEntityImageUrlsBatchMock).toHaveBeenCalledWith('contact', ['contact-1'], 'tenant-session');
      expect(getContactAvatarUrlMock).not.toHaveBeenCalled();
    }
  });

  it('preserves client portal access to the authenticated user’s own contact', async () => {
    currentUser = { user_id: 'client-1', user_type: 'client', contact_id: 'contact-1', tenant: 'tenant-session' };
    const module = await actions();
    await expect(module.getContactAvatarUrlAction('contact-1')).resolves.toBe('/api/documents/view/file-1?t=1');
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });
});
