import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DENIED = { success: false, error: 'Permission denied: Cannot update settings' };

const hasPermission = vi.fn();
const getConnection = vi.fn();
const uploadEntityImage = vi.fn();
const deleteEntityImage = vi.fn();
const linkEntityImageFromDocument = vi.fn();
const recropEntityLogo = vi.fn();
const settingsFirst = vi.fn();
const settingsUpdate = vi.fn();
const settingsInsert = vi.fn();

let currentUser: Record<string, unknown> = { user_id: 'user-1', user_type: 'internal' };

async function loadActions() {
  vi.resetModules();
  vi.doMock('@alga-psa/auth', () => ({
    hasPermission,
    withAuth:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn(currentUser, { tenant: 'tenant-1' }, ...args),
  }));
  vi.doMock('@alga-psa/db', () => ({
    getConnection,
    tenantDb: () => ({
      table: () => {
        const query: Record<string, unknown> = { first: settingsFirst, update: settingsUpdate, insert: settingsInsert };
        // Document lookups (select/where/whereIn) resolve to no rows.
        query.select = () => query;
        query.where = () => Promise.resolve([]);
        query.whereIn = () => Promise.resolve([]);
        return query;
      },
    }),
  }));
  vi.doMock('@alga-psa/storage', () => ({
    uploadEntityImage,
    deleteEntityImage,
    linkEntityImageFromDocument,
    recropEntityLogo,
    parseLogoCrop: (crop: unknown) => crop ?? null,
  }));
  return import('./tenantLogoActions');
}

const crop = { x: 0, y: 0, width: 10, height: 10 };
const logoForm = () => {
  const form = new FormData();
  form.set('logo', new File(['x'], 'logo.png', { type: 'image/png' }));
  return form;
};

type Invoke = (a: Awaited<ReturnType<typeof loadActions>>, tenantId: string) => Promise<unknown>;
const mutators: Array<[string, Invoke]> = [
  ['uploadTenantLogo', (a, t) => a.uploadTenantLogo(t, logoForm(), 'wide')],
  ['recropTenantLogo', (a, t) => a.recropTenantLogo(t, 'default', crop)],
  ['deleteTenantLogo', (a, t) => a.deleteTenantLogo(t, 'default')],
  ['linkDocumentAsTenantLogo', (a, t) => a.linkDocumentAsTenantLogo(t, 'doc-1', 'default')],
];

function expectNoWrites() {
  expect(uploadEntityImage).not.toHaveBeenCalled();
  expect(deleteEntityImage).not.toHaveBeenCalled();
  expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
  expect(recropEntityLogo).not.toHaveBeenCalled();
  expect(settingsUpdate).not.toHaveBeenCalled();
  expect(settingsInsert).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { user_id: 'user-1', user_type: 'internal' };
  getConnection.mockResolvedValue({ fn: { now: () => 'now()' } });
  settingsFirst.mockResolvedValue({ settings: {} });
  settingsUpdate.mockResolvedValue(1);
  settingsInsert.mockResolvedValue([1]);
  uploadEntityImage.mockResolvedValue({ success: true, imageUrl: '/img', documentId: 'doc-9' });
  deleteEntityImage.mockResolvedValue({ success: true });
  linkEntityImageFromDocument.mockResolvedValue({ success: true, imageUrl: '/img', documentId: 'doc-1' });
  recropEntityLogo.mockResolvedValue({ success: true, imageUrl: '/img' });
});

describe.each(mutators)('%s settings:update guard', (_name, invoke) => {
  it('denies an internal user without settings:update and writes nothing', async () => {
    hasPermission.mockResolvedValue(false);
    const actions = await loadActions();

    expect(await invoke(actions, 'tenant-1')).toEqual(DENIED);
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'settings', 'update', expect.anything());
    expectNoWrites();
  });

  it('fails closed when the permission check itself errors', async () => {
    hasPermission.mockRejectedValue(new Error('db down'));
    const actions = await loadActions();

    expect(await invoke(actions, 'tenant-1')).toEqual(DENIED);
    expectNoWrites();
  });

  it('allows an internal user with settings:update', async () => {
    hasPermission.mockResolvedValue(true);
    const actions = await loadActions();

    expect(await invoke(actions, 'tenant-1')).toMatchObject({ success: true });
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'settings', 'update', expect.anything());
    expect(settingsUpdate.mock.calls.length + settingsInsert.mock.calls.length).toBe(1);
  });

  it('rejects a tenantId that is not the authenticated tenant, even with the permission', async () => {
    hasPermission.mockResolvedValue(true);
    const actions = await loadActions();

    expect(await invoke(actions, 'tenant-2')).toEqual(DENIED);
    expectNoWrites();
  });

  it('still refuses non-internal users before any write', async () => {
    hasPermission.mockResolvedValue(true);
    currentUser = { user_id: 'user-2', user_type: 'client' };
    const actions = await loadActions();

    expect(await invoke(actions, 'tenant-1')).toMatchObject({ success: false });
    expectNoWrites();
  });
});

describe('storage calls use the authenticated tenant', () => {
  it('passes the context tenant as both entity id and tenant', async () => {
    hasPermission.mockResolvedValue(true);
    const actions = await loadActions();

    await actions.uploadTenantLogo('tenant-1', logoForm(), 'wide');
    await actions.deleteTenantLogo('tenant-1', 'default');
    await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default');
    await actions.recropTenantLogo('tenant-1', 'default', crop);

    expect(uploadEntityImage.mock.calls[0].slice(0, 5)).toEqual(['tenant', 'tenant-1', expect.anything(), 'user-1', 'tenant-1']);
    expect(deleteEntityImage.mock.calls[0].slice(0, 4)).toEqual(['tenant', 'tenant-1', 'user-1', 'tenant-1']);
    expect(linkEntityImageFromDocument.mock.calls[0].slice(0, 4)).toEqual(['tenant', 'tenant-1', 'user-1', 'tenant-1']);
    expect(recropEntityLogo.mock.calls[0].slice(0, 4)).toEqual(['tenant', 'tenant-1', 'user-1', 'tenant-1']);
  });
});

describe('guard placement contract', () => {
  const source = readFileSync(resolve(__dirname, 'tenantLogoActions.ts'), 'utf8');

  it.each(mutators.map(([name]) => name))('%s runs the guard before its try block and any write', (name) => {
    const start = source.indexOf(`export const ${name}`);
    const body = source.slice(start, source.indexOf('\n});', start));
    const guard = body.indexOf('guardTenantLogoWrite(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('try {'));
    for (const write of ['uploadEntityImage(', 'deleteEntityImage(', 'linkEntityImageFromDocument(', 'recropEntityLogo(', 'writeBrandingLogoUrl(', 'getConnection(']) {
      const at = body.indexOf(write);
      if (at !== -1) expect(guard).toBeLessThan(at);
    }
  });

  it('gates through settings:update on the action connection', () => {
    expect(source).toContain("hasPermission(user, 'settings', 'update', knex)");
  });
});
