import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let projectReadGranted: boolean;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const getPortalVisibilityForUserMock = vi.fn();
const applyProjectVisibilityFilterMock = vi.fn((query: any) => query);
const tableMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (table: string) => tableMock(table),
    unscoped: (table: string) => tableMock(table),
    tenantJoin: (query: any) => query,
  }),
}));

vi.mock('@alga-psa/authorization/portal/visibility', () => ({
  applyProjectVisibilityFilter: (...args: any[]) => applyProjectVisibilityFilterMock(...args),
}));

vi.mock('../../lib/clientAuth', () => ({
  getPortalVisibilityForUser: (...args: any[]) => getPortalVisibilityForUserMock(...args),
}));

const uploadFileMock = vi.fn();
const validateFileUploadMock = vi.fn();
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    validateFileUpload: (...args: any[]) => validateFileUploadMock(...args),
    uploadFile: (...args: any[]) => uploadFileMock(...args),
  },
}));

vi.mock('@alga-psa/storage/config/storage', () => ({
  getUploadPolicy: async () => ({ maxFileSize: 500 * 1024 * 1024, allowedMimeTypes: ['*/*'] }),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getEntityImageUrlsBatch: vi.fn(async () => new Map()),
}));

function buildQuery(rows: any[]) {
  const query: any = {};
  for (const key of ['select', 'where', 'andWhere', 'whereIn', 'whereNull', 'whereRaw', 'orderBy', 'orderByRaw', 'groupBy', 'limit']) {
    query[key] = vi.fn(() => query);
  }
  query.first = vi.fn(async () => rows[0]);
  query.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

describe('client portal project detail actions enforce project:read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    currentUser = {
      user_id: 'portal-user-1',
      user_type: 'client',
      email: 'client@example.com',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
    projectReadGranted = false;

    createTenantKnexMock.mockResolvedValue({ knex: { raw: vi.fn() } as any });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback({} as any)
    );
    hasPermissionMock.mockImplementation(async () => projectReadGranted);
    getPortalVisibilityForUserMock.mockResolvedValue({ clientId: 'client-1', contactId: 'contact-1' });
    applyProjectVisibilityFilterMock.mockImplementation((query: any) => query);
    tableMock.mockImplementation((table: string) => {
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('getClientProjectPhases reads nothing without project:read', async () => {
    const { getClientProjectPhases } = await import('./client-project-details');

    const result = await getClientProjectPhases('project-1');

    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'portal-user-1', user_type: 'client', tenant: 'tenant-1' }),
      'project',
      'read',
      expect.anything()
    );
    expect(result).toBeNull();
    expect(getPortalVisibilityForUserMock).not.toHaveBeenCalled();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectTasks reads nothing without project:read', async () => {
    const { getClientProjectTasks } = await import('./client-project-details');

    expect(await getClientProjectTasks('project-1')).toBeNull();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectStatuses reads nothing without project:read', async () => {
    const { getClientProjectStatuses } = await import('./client-project-details');

    expect(await getClientProjectStatuses('project-1')).toBeNull();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientTaskDocuments refuses without project:read', async () => {
    const { getClientTaskDocuments } = await import('./client-project-details');

    expect(await getClientTaskDocuments('task-1')).toEqual({ success: false, error: 'Not authorized' });
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('uploadClientTaskDocument refuses without project:read', async () => {
    const { uploadClientTaskDocument } = await import('./client-project-details');

    const result = await uploadClientTaskDocument('task-1', new FormData());

    expect(result).toEqual({ success: false, error: 'Not authorized' });
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('getClientProjectPhases loads phases once project:read is granted', async () => {
    projectReadGranted = true;
    const phases = [{ phase_id: 'phase-1', order_key: 'a' }];
    tableMock.mockImplementation((table: string) => {
      if (table === 'projects') {
        return buildQuery([{ project_id: 'project-1', client_portal_config: { show_phases: true } }]);
      }
      if (table === 'project_phases') {
        return buildQuery(phases);
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const { getClientProjectPhases } = await import('./client-project-details');

    expect(await getClientProjectPhases('project-1')).toEqual({ phases });
  });

  describe('uploadClientTaskDocument transport cap and streaming', () => {
    const inserted: Record<string, any[]> = { documents: [], document_associations: [] };

    beforeEach(() => {
      projectReadGranted = true;
      inserted.documents.length = 0;
      inserted.document_associations.length = 0;
      tableMock.mockImplementation((table: string) => {
        if (table === 'project_tasks as pt') {
          return buildQuery([{
            project_id: 'project-1',
            client_portal_config: { show_tasks: true, visible_task_fields: ['document_uploads'] },
          }]);
        }
        if (table === 'documents' || table === 'document_associations') {
          return { insert: vi.fn(async (row: any) => { inserted[table]!.push(row); }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      });
    });

    it('streams the file into the ingest (no arrayBuffer, no second validator)', async () => {
      const { Readable } = await import('node:stream');
      uploadFileMock.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'video/mp4', file_size: 5 });
      const file = new File([Buffer.from('hello')], 'clip.mp4', { type: 'video/mp4' });
      const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer');
      const form = new FormData();
      form.set('file', file);

      const { uploadClientTaskDocument } = await import('./client-project-details');
      const result = await uploadClientTaskDocument('task-1', form);

      expect(result).toMatchObject({ success: true });
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(validateFileUploadMock).not.toHaveBeenCalled();
      expect(uploadFileMock.mock.calls[0]![1]).toBeInstanceOf(Readable);
      expect(inserted.documents[0]).toMatchObject({ file_id: 'f1', mime_type: 'video/mp4', file_size: 5 });
    });

    it('refuses a file larger than the server-action transport accepts, with the standard size message', async () => {
      const { serverActionFileLimitBytes } = await import('@alga-psa/storage/ingest/bufferedCap');
      const cap = serverActionFileLimitBytes();
      // A File reporting a size over the cap without allocating it.
      const file = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: cap + 1 });
      const form = new FormData();
      form.set('file', file);

      const { uploadClientTaskDocument } = await import('./client-project-details');
      const result = await uploadClientTaskDocument('task-1', form);

      // The cap in the message is the transport's, never the 500 MB provider max.
      expect(result).toEqual({ success: false, error: `File size exceeds limit of ${cap} bytes` });
      expect(uploadFileMock).not.toHaveBeenCalled();
    });

    it('the cap follows SERVER_ACTIONS_BODY_LIMIT up to the 100 MB proxy limit (200mb gives 100 MiB less 64 KiB), with no 25 MiB clamp', async () => {
      vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '200mb');
      try {
        // Next's proxy truncates every request body past proxyClientMaxBodySize (100mb), so a
        // 200mb action limit cannot carry more than that.
        const cap = 100 * 1024 * 1024 - 64 * 1024;
        const file = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
        Object.defineProperty(file, 'size', { value: cap + 1 });
        const form = new FormData();
        form.set('file', file);
        const { uploadClientTaskDocument } = await import('./client-project-details');
        const result = await uploadClientTaskDocument('task-1', form);
        // Refused at exactly the transport cap (the provider max in this suite is 500 MB), not at 25 MiB.
        expect(result).toEqual({ success: false, error: `File size exceeds limit of ${cap} bytes` });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
