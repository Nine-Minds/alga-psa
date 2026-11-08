import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  authorizedDocument: vi.fn(),
  authorizeAssociation: vi.fn(),
  table: vi.fn(),
  writes: [] as Array<{ table: string; operation: string; value: unknown; tenant: string }>,
  contentReads: 0,
  content: null as any,
  redactedFields: [] as string[],
  targetExists: true,
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: mocks.hasPermission,
  withAuth: (action: Function) => action,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentById: mocks.authorizedDocument,
}));

vi.mock('@shared/lib/documentAuthorization', () => ({
  canAuthorizeDocumentAssociation: mocks.authorizeAssociation,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => unknown) => callback({ fn: { now: () => 'now' } }),
  tenantDb: (_connection: unknown, tenant: string) => ({
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        select: () => query,
        first: async () => tableName === 'document_block_content'
          ? (mocks.contentReads++, mocks.content)
          : tableName === 'tickets' || tableName === 'clients' || tableName === 'contacts' || tableName === 'assets' || tableName === 'project_tasks' || tableName === 'client_contracts'
            ? (mocks.targetExists ? { exists: true } : undefined)
            : undefined,
        insert: (value: unknown) => {
          mocks.writes.push({ table: tableName, operation: 'insert', value, tenant });
          const inserted: any = {
            returning: async () => [{ content_id: 'new-content', block_data: (value as any)?.block_data, version_id: (value as any)?.version_id }],
            then: (resolve: (value: unknown) => unknown) => Promise.resolve([{ content_id: 'new-content' }]).then(resolve),
          };
          return inserted;
        },
        update: (value: unknown) => {
          mocks.writes.push({ table: tableName, operation: 'update', value, tenant });
          return {
            returning: async () => [{ content_id: 'content-1', block_data: (value as any)?.block_data, version_id: (value as any)?.version_id }],
            then: (resolve: (value: number) => unknown) => Promise.resolve(1).then(resolve),
          };
        },
      };
      return query;
    },
  }),
}));

import { createBlockDocument, getBlockContent, updateBlockContent } from './blockContentActions';

const internalUser = { user_id: 'authenticated-user', tenant: 'tenant-a', user_type: 'internal' } as any;
const portalUser = { user_id: 'portal-user', tenant: 'tenant-a', user_type: 'client', clientId: 'client-a' } as any;
const invoke = (action: any, ...args: any[]) => action(...args);

describe('block content action authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writes.length = 0;
    mocks.contentReads = 0;
    mocks.redactedFields = [];
    mocks.content = { content_id: 'content-1', block_data: '{"secret":"stored-payload"}' };
    mocks.targetExists = true;
    mocks.hasPermission.mockResolvedValue(true);
    mocks.authorizedDocument.mockImplementation(async () => {
      const authorizedDocument: Record<string, unknown> = {
        document_id: 'document-1', tenant: 'tenant-a', content: 'document content',
      };
      for (const field of mocks.redactedFields) delete authorizedDocument[field];
      return authorizedDocument;
    });
    mocks.authorizeAssociation.mockResolvedValue(true);
  });

  it('denies reads when the document authorizer rejects an internal user', async () => {
    mocks.authorizedDocument.mockResolvedValue(null);

    const result = await invoke(getBlockContent, internalUser, { tenant: 'tenant-a' }, 'document-1');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
  });

  it('returns block content after RBAC and document relationship authorization succeed', async () => {
    const result = await invoke(getBlockContent, internalUser, { tenant: 'tenant-a' }, 'document-1');

    expect(result).toMatchObject({ content_id: 'content-1', block_data: '{"secret":"stored-payload"}' });
    expect(mocks.authorizedDocument).toHaveBeenCalledWith(expect.anything(), 'tenant-a', internalUser, 'document-1');
  });

  it('does not read or disclose stored block content when the authorizer redacts content', async () => {
    mocks.redactedFields = ['content'];

    const result = await invoke(getBlockContent, internalUser, { tenant: 'tenant-a' }, 'document-1');

    expect(result).toBeNull();
    expect(mocks.contentReads).toBe(0);
  });

  it('denies portal reads outside the user client boundary', async () => {
    mocks.authorizedDocument.mockResolvedValue(null);

    const result = await invoke(getBlockContent, portalUser, { tenant: 'tenant-a' }, 'other-client-document');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
  });

  it('denies unauthorized updates, including creation of missing block content, without writes', async () => {
    mocks.authorizedDocument.mockResolvedValue(null);
    mocks.content = null;

    const result = await invoke(updateBlockContent, internalUser, { tenant: 'tenant-a' }, 'private-document', {
      block_data: { changed: true }, user_id: 'spoofed-user',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
  });

  it('denies associations the authenticated user cannot read before creating a document or content', async () => {
    mocks.hasPermission.mockImplementation(async (user: any, resource: string, action: string) =>
      resource === 'document' && action === 'create'
    );

    const result = await invoke(createBlockDocument, internalUser, { tenant: 'tenant-a' }, {
      document_name: 'Forbidden', block_data: { body: 'secret' }, user_id: 'spoofed-user',
      entityId: 'ticket-outside-access', entityType: 'ticket',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
  });

  it('denies a target record rejected by the document relationship authorizer before writes', async () => {
    mocks.authorizeAssociation.mockResolvedValue(false);

    const result = await invoke(createBlockDocument, internalUser, { tenant: 'tenant-a' }, {
      document_name: 'Forbidden association', block_data: {}, user_id: 'spoofed-user',
      entityId: 'ticket-other-client', entityType: 'ticket',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.authorizeAssociation).toHaveBeenCalledWith(expect.anything(), 'tenant-a', internalUser, 'ticket-other-client', 'ticket');
    expect(mocks.writes).toHaveLength(0);
  });

  it('creates authorized content for an existing document and attributes the update to the session user', async () => {
    mocks.content = null;

    const result = await invoke(updateBlockContent, internalUser, { tenant: 'tenant-a' }, 'document-1', {
      block_data: { body: 'saved' }, user_id: 'spoofed-user',
    });

    expect(result).toMatchObject({ content_id: 'new-content' });
    expect(mocks.writes).toContainEqual(expect.objectContaining({
      table: 'document_block_content', operation: 'insert', tenant: 'tenant-a',
    }));
    expect(mocks.writes).toContainEqual(expect.objectContaining({
      table: 'documents', operation: 'update', tenant: 'tenant-a',
      value: expect.objectContaining({ edited_by: 'authenticated-user' }),
    }));
  });

  it('creates an authorized association with authenticated creator attribution', async () => {
    const result = await invoke(createBlockDocument, internalUser, { tenant: 'tenant-a' }, {
      document_name: 'Allowed', block_data: { body: 'note' }, user_id: 'spoofed-user',
      entityId: 'ticket-a', entityType: 'ticket',
    });

    expect(result).toMatchObject({ document_id: expect.any(String), content_id: expect.any(String) });
    expect(mocks.writes.find(write => write.table === 'documents')?.value).toMatchObject({
      user_id: 'authenticated-user', created_by: 'authenticated-user', tenant: 'tenant-a',
    });
    expect(mocks.writes.find(write => write.table === 'document_associations')?.value).toMatchObject({
      entity_id: 'ticket-a', entity_type: 'ticket', tenant: 'tenant-a',
    });
  });

  it('rejects unresolved tenant association targets without writes', async () => {
    mocks.targetExists = false;

    const result = await invoke(createBlockDocument, internalUser, { tenant: 'tenant-a' }, {
      document_name: 'Unknown target', block_data: {}, user_id: 'spoofed-user',
      entityId: 'missing-ticket', entityType: 'ticket',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
  });

  it('rejects runtime association types outside the supported authorization map', async () => {
    const result = await invoke(createBlockDocument, internalUser, { tenant: 'tenant-a' }, {
      document_name: 'Unsupported association', block_data: {}, user_id: 'spoofed-user',
      entityId: 'opportunity-1', entityType: 'opportunity' as any,
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
  });
});
