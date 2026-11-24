import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
const { hasPermissionMock, createTenantKnexMock, withTransactionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(), createTenantKnexMock: vi.fn(), withTransactionMock: vi.fn(),
}));
const dbLib = vi.hoisted(() => ({
  listNoticesWithAudience: vi.fn(),
  getNoticeDetail: vi.fn(),
  insertNotice: vi.fn(),
  updateNotice: vi.fn(),
  deleteNotice: vi.fn(),
  previewAudienceClientNames: vi.fn(),
  findMissingTargetIds: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: vi.fn(),
}));
vi.mock('../../lib/clientPortalNoticesDb', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ...dbLib,
}));

import {
  createClientPortalNotice, deleteClientPortalNotice, getClientPortalNotice,
  listClientPortalNotices, previewClientPortalNoticeAudience, updateClientPortalNotice,
} from './clientPortalNoticeActions';

const input: any = {
  severity: 'info', content: { default: { message: 'Hi' } }, dismissible: true, audience_type: 'all',
};
const calls: Record<string, () => Promise<any>> = {
  list: () => (listClientPortalNotices as any)(),
  get: () => (getClientPortalNotice as any)('n1'),
  preview: () => (previewClientPortalNoticeAudience as any)({ audienceType: 'all', targetIds: [] }),
  create: () => (createClientPortalNotice as any)(input),
  update: () => (updateClientPortalNotice as any)('n1', input),
  delete: () => (deleteClientPortalNotice as any)('n1'),
};

function grant(...allowed: string[]) {
  hasPermissionMock.mockImplementation(async (_u: any, _r: string, action: string) => allowed.includes(action));
}

describe('client portal notice actions: permission guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'u1', tenant: 't1', user_type: 'internal' };
    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 't1' });
    withTransactionMock.mockImplementation(async (_k: any, cb: any) => cb({}));
  });

  const noWrites = () => {
    expect(withTransactionMock).not.toHaveBeenCalled();
    for (const fn of Object.values(dbLib)) expect(fn).not.toHaveBeenCalled();
  };

  it.each(['create', 'update', 'delete'])('%s without settings:update returns a keyed permissionError and writes nothing', async (name) => {
    grant('read');
    expect(await calls[name]()).toMatchObject({
      permissionError: expect.any(String),
      messageKey: 'client-portal:errors.access.settingsUpdate',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(currentUser, 'settings', 'update', expect.anything());
    noWrites();
  });

  it.each(['list', 'get'])('%s without settings:read is refused', async (name) => {
    grant('update');
    expect(await calls[name]()).toMatchObject({ messageKey: 'client-portal:errors.access.settingsRead' });
    noWrites();
  });

  it('preview without settings:read is refused', async () => {
    grant('update');
    expect(await calls.preview()).toMatchObject({ messageKey: 'client-portal:errors.access.settingsRead' });
    noWrites();
  });

  it.each(Object.keys(calls))('%s refuses client portal users before any permission check', async (name) => {
    currentUser = { ...currentUser, user_type: 'client' };
    grant('read', 'update');
    expect(await calls[name]()).toMatchObject({ messageKey: 'client-portal:errors.access.mspOnly' });
    expect(hasPermissionMock).not.toHaveBeenCalled();
    noWrites();
  });

  it('proceeds for an MSP user with permission', async () => {
    grant('read');
    dbLib.listNoticesWithAudience.mockResolvedValue([]);
    expect(await calls.list()).toEqual([]);
  });
});
