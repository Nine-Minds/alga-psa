import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let contactExists: boolean;
let linkedContactExists: boolean;
const hasPermissionMock = vi.fn();
const uploadEntityImageMock = vi.fn();
const deleteEntityImageMock = vi.fn();
const tenantDbMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(currentUser, { tenant: 'tenant-session' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (...args: any[]) => tenantDbMock(...args),
}));

vi.mock('@alga-psa/storage', () => ({
  uploadEntityImage: (...args: any[]) => uploadEntityImageMock(...args),
  deleteEntityImage: (...args: any[]) => deleteEntityImageMock(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function buildQuery(firstResult: any) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.first = vi.fn(async () => firstResult);
  return query;
}

describe('client portal contact avatar action authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    currentUser = { user_id: 'internal-1', user_type: 'internal' };
    contactExists = true;
    linkedContactExists = false;
    hasPermissionMock.mockResolvedValue(false);
    uploadEntityImageMock.mockResolvedValue({ success: true, imageUrl: '/avatar.png' });
    deleteEntityImageMock.mockResolvedValue({ success: true });
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: any, callback: (trx: any) => unknown) => callback({}));
    tenantDbMock.mockImplementation((trx: any, tenant: string) => ({
      table: (name: string) => {
        const query = buildQuery(name === 'contacts'
          ? (contactExists ? { contact_name_id: 'contact-target' } : undefined)
          : (linkedContactExists ? { user_id: currentUser.user_id } : undefined));
        return query;
      },
    }));
  });

  it('rejects restricted internal upload and deletion before storage side effects', async () => {
    const { uploadContactAvatar, deleteContactAvatar } = await import('./clientUserActions');
    const formData = new FormData();
    formData.set('avatar', new Blob(['avatar']), 'avatar.png');

    expect(await uploadContactAvatar('contact-target', formData)).toMatchObject({ success: false });
    expect(await deleteContactAvatar('contact-target')).toMatchObject({ success: false });
    expect(hasPermissionMock).toHaveBeenCalledWith(currentUser, 'contact', 'update', {});
    expect(uploadEntityImageMock).not.toHaveBeenCalled();
    expect(deleteEntityImageMock).not.toHaveBeenCalled();
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('allows internal contact:update callers to upload and delete', async () => {
    currentUser = { user_id: 'internal-1', user_type: 'internal' };
    hasPermissionMock.mockResolvedValue(true);
    const { uploadContactAvatar, deleteContactAvatar } = await import('./clientUserActions');
    const formData = new FormData();
    formData.set('avatar', new Blob(['avatar']), 'avatar.png');

    expect(await uploadContactAvatar('contact-target', formData)).toMatchObject({ success: true });
    expect(await deleteContactAvatar('contact-target')).toEqual({ success: true });
    expect(uploadEntityImageMock).toHaveBeenCalledTimes(1);
    expect(deleteEntityImageMock).toHaveBeenCalledTimes(1);
  });

  it('allows a client user to manage their own session-tenant contact', async () => {
    currentUser = { user_id: 'portal-1', user_type: 'client', contact_id: 'contact-target' };
    const { uploadContactAvatar, deleteContactAvatar } = await import('./clientUserActions');
    const formData = new FormData();
    formData.set('avatar', new Blob(['avatar']), 'avatar.png');

    expect(await uploadContactAvatar('contact-target', formData)).toMatchObject({ success: true });
    expect(await deleteContactAvatar('contact-target')).toEqual({ success: true });
    expect(uploadEntityImageMock).toHaveBeenCalledTimes(1);
    expect(deleteEntityImageMock).toHaveBeenCalledTimes(1);
  });

  it('denies another contact, including contacts linked outside the session tenant', async () => {
    currentUser = { user_id: 'portal-1', user_type: 'client', contact_id: 'contact-own' };
    const { uploadContactAvatar, deleteContactAvatar } = await import('./clientUserActions');
    const formData = new FormData();
    formData.set('avatar', new Blob(['avatar']), 'avatar.png');

    expect(await uploadContactAvatar('contact-target', formData)).toMatchObject({ success: false });
    expect(await deleteContactAvatar('contact-target')).toMatchObject({ success: false });
    expect(tenantDbMock).toHaveBeenCalledWith({}, 'tenant-session');
    expect(uploadEntityImageMock).not.toHaveBeenCalled();
    expect(deleteEntityImageMock).not.toHaveBeenCalled();
  });

  it('does not mutate storage for a contact ID absent from the session tenant', async () => {
    currentUser = { user_id: 'portal-1', user_type: 'client', contact_id: 'contact-target' };
    contactExists = false;
    const { uploadContactAvatar, deleteContactAvatar } = await import('./clientUserActions');
    const formData = new FormData();
    formData.set('avatar', new Blob(['avatar']), 'avatar.png');

    expect(await uploadContactAvatar('contact-target', formData)).toMatchObject({ success: false, message: 'Contact not found' });
    expect(await deleteContactAvatar('contact-target')).toMatchObject({ success: false, message: 'Contact not found' });
    expect(uploadEntityImageMock).not.toHaveBeenCalled();
    expect(deleteEntityImageMock).not.toHaveBeenCalled();
  });
});
