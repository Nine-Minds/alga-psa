import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

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

  describe('malformed ids', () => {
    const BAD = ['not-a-uuid', '', "x' or '1'='1"];
    const GOOD = '00000000-0000-4000-8000-000000000001';

    it.each(BAD)('get/update/delete with noticeId %j return not_found and touch no DB lib', async (bad) => {
      grant('read', 'update');
      expect(await (getClientPortalNotice as any)(bad)).toEqual({ success: false, code: 'not_found' });
      expect(await (updateClientPortalNotice as any)(bad, input)).toEqual({ success: false, code: 'not_found' });
      expect(await (deleteClientPortalNotice as any)(bad)).toEqual({ success: false, code: 'not_found' });
      noWrites();
    });

    it('create with a non-UUID target id returns invalid_targets without findMissingTargetIds', async () => {
      grant('update');
      const res = await (createClientPortalNotice as any)({
        ...input, audience_type: 'clients', audience_client_ids: [GOOD, 'nope'],
      });
      expect(res).toEqual({ success: false, code: 'invalid_targets', missingTargetIds: ['nope'] });
      expect(dbLib.findMissingTargetIds).not.toHaveBeenCalled();
      expect(dbLib.insertNotice).not.toHaveBeenCalled();
    });

    it('update with a non-UUID tag id returns invalid_targets without findMissingTargetIds', async () => {
      grant('update');
      const res = await (updateClientPortalNotice as any)(GOOD, {
        ...input, audience_type: 'tags', audience_tag_ids: ['bad-tag'],
      });
      expect(res).toMatchObject({ success: false, code: 'invalid_targets', missingTargetIds: ['bad-tag'] });
      expect(dbLib.findMissingTargetIds).not.toHaveBeenCalled();
      expect(dbLib.updateNotice).not.toHaveBeenCalled();
    });

    it('preview refuses an unknown audienceType and non-UUID targetIds', async () => {
      grant('read');
      expect(await (previewClientPortalNoticeAudience as any)({ audienceType: 'bogus', targetIds: [] }))
        .toEqual({ success: false, code: 'invalid_audience_type' });
      expect(await (previewClientPortalNoticeAudience as any)({ audienceType: 'tags', targetIds: ['x'] }))
        .toEqual({ success: false, code: 'invalid_targets', missingTargetIds: ['x'] });
      expect(dbLib.previewAudienceClientNames).not.toHaveBeenCalled();
    });
  });

  it('proceeds for an MSP user with permission', async () => {
    grant('read');
    dbLib.listNoticesWithAudience.mockResolvedValue([]);
    expect(await calls.list()).toEqual([]);
  });
});

describe('exported signatures expose the permission-error branch', () => {
  // Compile-time only (checked by tsc): ActionPermissionError is `never`, so the refusal must be
  // the structural ActionPermissionErrorShape. A cast that hides it makes these fail to compile.
  it('every action result includes { permissionError: string }', () => {
    type Refusal = { permissionError: string };
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof listClientPortalNotices>>>();
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof getClientPortalNotice>>>();
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof createClientPortalNotice>>>();
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof updateClientPortalNotice>>>();
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof deleteClientPortalNotice>>>();
    expectTypeOf<Refusal>().toExtend<Awaited<ReturnType<typeof previewClientPortalNoticeAudience>>>();
  });
});
