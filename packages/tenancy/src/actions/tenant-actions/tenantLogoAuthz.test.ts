import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DENIED = { success: false, error: 'Permission denied: Cannot update settings' };

const hasPermission = vi.fn();
const authorizeAndRedactDocuments = vi.fn();
const getConnection = vi.fn();
const withTransaction = vi.fn();
const uploadEntityImage = vi.fn();
const deleteEntityImage = vi.fn();
const linkEntityImageFromDocument = vi.fn();
const recropEntityLogo = vi.fn();
const settingsFirst = vi.fn();
const settingsUpdate = vi.fn();
const settingsInsert = vi.fn();
const documentFirst = vi.fn();
const sourceDocument = {
  tenant: 'tenant-1',
  document_id: 'doc-1',
  document_name: 'source.png',
  file_id: 'file-1',
  mime_type: 'image/png',
};

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
  vi.doMock('@shared/lib/documentAuthorization', () => ({ authorizeAndRedactDocuments }));
  vi.doMock('@alga-psa/db', () => ({
    getConnection,
    withTransaction,
    tenantDb: () => ({
      table: (tableName: string) => {
        const query: Record<string, unknown> = {
          first: tableName === 'documents' ? documentFirst : settingsFirst,
          update: settingsUpdate,
          insert: settingsInsert,
        };
        // Queries are chainable; document and settings results are controlled below.
        query.select = () => query;
        query.where = () => query;
        query.whereIn = () => Promise.resolve([]);
        query.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve([]).then(resolve, reject);
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
  hasPermission.mockResolvedValue(true);
  getConnection.mockResolvedValue({ fn: { now: () => 'now()' } });
  withTransaction.mockImplementation(async (_knex, callback) => callback({ isTransaction: true }));
  documentFirst.mockResolvedValue(sourceDocument);
  authorizeAndRedactDocuments.mockResolvedValue([sourceDocument]);
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
    expect(linkEntityImageFromDocument.mock.calls[0][4]).toEqual({
      sourceDocument: {
        tenant: 'tenant-1',
        documentId: 'doc-1',
        fileId: 'file-1',
        documentName: 'source.png',
        mimeType: 'image/png',
      },
      logoVariant: 'default',
      contextName: 'tenant_logo',
    });
    expect(recropEntityLogo.mock.calls[0].slice(0, 4)).toEqual(['tenant', 'tenant-1', 'user-1', 'tenant-1']);
  });
});

describe('linkDocumentAsTenantLogo source authorization', () => {
  it('denies a settings updater without document:read before calling storage', async () => {
    hasPermission.mockImplementation(async (_user, resource, action) =>
      resource === 'settings' && action === 'update');
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default')).toEqual({
      success: false,
      error: 'Permission denied: Cannot read documents',
    });
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'settings', 'update', expect.anything());
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'document', 'read', expect.anything());
    expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsInsert).not.toHaveBeenCalled();
  });

  it('denies a document reader whose retained attachment fails instance authorization', async () => {
    hasPermission.mockResolvedValue(true);
    const retainedAttachment = { ...sourceDocument, attachment_state: 'removed', attachment_id: 'attachment-1' };
    documentFirst.mockResolvedValue(retainedAttachment);
    authorizeAndRedactDocuments.mockResolvedValue([]);
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default')).toEqual({
      success: false,
      error: 'Permission denied: Cannot read documents',
    });
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'document', 'read', expect.anything());
    expect(authorizeAndRedactDocuments).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      currentUser,
      [retainedAttachment],
    );
    expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsInsert).not.toHaveBeenCalled();
  });

  it('denies a source whose byte fields are redacted by the instance authorizer', async () => {
    hasPermission.mockResolvedValue(true);
    authorizeAndRedactDocuments.mockResolvedValue([{ ...sourceDocument, file_id: undefined }]);
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default')).toEqual({
      success: false,
      error: 'Permission denied: Cannot read documents',
    });
    expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsInsert).not.toHaveBeenCalled();
  });

  it('denies when the tenant-scoped source document does not exist', async () => {
    documentFirst.mockResolvedValue(undefined);
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'missing-doc', 'default')).toEqual({
      success: false,
      error: 'Permission denied: Cannot read documents',
    });
    expect(authorizeAndRedactDocuments).not.toHaveBeenCalled();
    expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsInsert).not.toHaveBeenCalled();
  });

  it('denies by default when instance authorization throws', async () => {
    authorizeAndRedactDocuments.mockRejectedValue(new Error('authorization unavailable'));
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default')).toEqual({
      success: false,
      error: 'Permission denied: Cannot read documents',
    });
    expect(linkEntityImageFromDocument).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsInsert).not.toHaveBeenCalled();
  });

  it('links a source image when the caller can read it', async () => {
    hasPermission.mockResolvedValue(true);
    const actions = await loadActions();

    expect(await actions.linkDocumentAsTenantLogo('tenant-1', 'doc-1', 'default')).toMatchObject({
      success: true,
      message: 'Logo linked successfully',
    });
    expect(hasPermission).toHaveBeenCalledWith(currentUser, 'document', 'read', expect.anything());
    expect(authorizeAndRedactDocuments).toHaveBeenCalled();
    expect(linkEntityImageFromDocument).toHaveBeenCalledWith('tenant', 'tenant-1', 'user-1', 'tenant-1', {
      sourceDocument: {
        tenant: 'tenant-1',
        documentId: 'doc-1',
        fileId: 'file-1',
        documentName: 'source.png',
        mimeType: 'image/png',
      },
      logoVariant: 'default',
      contextName: 'tenant_logo',
    });
    expect(settingsUpdate.mock.calls.length + settingsInsert.mock.calls.length).toBe(1);
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
