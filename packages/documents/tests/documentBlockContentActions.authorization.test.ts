import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  authorizedDocument: vi.fn(),
  contentReads: 0,
  writes: [] as Array<{ table: string; operation: string; value: unknown }>,
  storedContent: {
    content_id: 'content-1',
    block_data: '{"secret":"stored-payload"}',
    version_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  redactedFields: [] as string[],
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: mocks.hasPermission,
  withAuth: (action: Function) => action,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now' } } }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => unknown) => callback({ fn: { now: () => 'now' } }),
  tenantDb: (_connection: unknown, _tenant: string) => ({
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        select: () => query,
        first: async () => {
          if (tableName === 'document_block_content') {
            mocks.contentReads += 1;
            return mocks.storedContent;
          }
          if (tableName === 'users') return undefined;
          return undefined;
        },
        update: (value: unknown) => {
          mocks.writes.push({ table: tableName, operation: 'update', value });
          const updated: any = {
            returning: async () => [{ content_id: 'content-1', block_data: (value as any)?.block_data, version_id: (value as any)?.version_id }],
            then: (resolve: (value: number) => unknown) => Promise.resolve(1).then(resolve),
          };
          return updated;
        },
        insert: (value: unknown) => {
          mocks.writes.push({ table: tableName, operation: 'insert', value });
          return { returning: async () => [{ content_id: 'new-content', block_data: (value as any)?.block_data, version_id: (value as any)?.version_id }] };
        },
      };
      return query;
    },
  }),
}));

vi.mock('../src/actions/documentActions', () => ({
  getAuthorizedDocumentById: mocks.authorizedDocument,
}));

vi.mock('../src/models/document', () => ({ default: {} }));
vi.mock('@alga-psa/documents/models/documentAssociation', () => ({ default: {} }));
vi.mock('../src/cache/CacheFactory', () => ({ CacheFactory: { getPreviewCache: () => ({ delete: vi.fn() }) } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: vi.fn() }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ permissionError: message }),
  isActionPermissionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'permissionError' in value),
}));
vi.mock('../src/actions/documentActionErrors', () => ({
  documentActionErrorFrom: () => null,
}));

import { getBlockContent, updateBlockContent } from '../src/actions/documentBlockContentActions';
import { publishEvent } from '@alga-psa/event-bus/publishers';

const user = { user_id: 'user-1', tenant: 'tenant-a', user_type: 'internal' } as any;
const invoke = (action: any, ...args: any[]) => action(...args);

describe('documents block content authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentReads = 0;
    mocks.writes.length = 0;
    mocks.storedContent = {
      content_id: 'content-1', block_data: '{"secret":"stored-payload"}', version_id: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    mocks.redactedFields = [];
    mocks.hasPermission.mockResolvedValue(true);
    mocks.authorizedDocument.mockImplementation(async () => {
      const authorizedDocument: Record<string, unknown> = {
        document_id: 'document-1', tenant: 'tenant-a', content: 'document content',
      };
      for (const field of mocks.redactedFields) delete authorizedDocument[field];
      return authorizedDocument;
    });
  });

  it('does not read or disclose stored block content when the authorizer redacts content', async () => {
    mocks.redactedFields = ['content'];

    const result = await invoke(getBlockContent, user, { tenant: 'tenant-a' }, 'document-1');

    expect(result).toBeNull();
    expect(mocks.contentReads).toBe(0);
  });

  it('returns stored block content when the authorized document retains content', async () => {
    const result = await invoke(getBlockContent, user, { tenant: 'tenant-a' }, 'document-1');

    expect(result).toMatchObject({ content_id: 'content-1', block_data: '{"secret":"stored-payload"}' });
    expect(mocks.contentReads).toBe(1);
  });

  it.each([
    ['empty', ''],
    ['nonempty', '{"body":"replacement"}'],
  ])('denies %s replacement under content redaction without writes or events', async (_label, block_data) => {
    const originalContent = structuredClone(mocks.storedContent);
    mocks.redactedFields = ['content'];

    const result = await invoke(updateBlockContent, user, { tenant: 'tenant-a' }, 'document-1', {
      block_data, user_id: 'spoofed-user',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
    expect(mocks.storedContent).toEqual(originalContent);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('does not create missing content when the authorized projection redacts content', async () => {
    mocks.storedContent = null as any;
    mocks.redactedFields = ['content'];

    const result = await invoke(updateBlockContent, user, { tenant: 'tenant-a' }, 'document-1', {
      block_data: { body: 'must not be inserted' }, user_id: 'spoofed-user',
    });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.writes).toHaveLength(0);
    expect(mocks.storedContent).toBeNull();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('permits an ordinary update when content redaction is removed', async () => {
    mocks.redactedFields = [];

    const result = await invoke(updateBlockContent, user, { tenant: 'tenant-a' }, 'document-1', {
      block_data: { body: 'replacement' }, user_id: 'spoofed-user',
    });

    expect(result).toMatchObject({ content_id: 'content-1', block_data: '{"body":"replacement"}' });
    expect(mocks.writes).toContainEqual(expect.objectContaining({ table: 'document_block_content', operation: 'update' }));
    expect(mocks.writes).toContainEqual(expect.objectContaining({
      table: 'documents', operation: 'update', value: expect.objectContaining({ edited_by: 'user-1' }),
    }));
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'USER_MENTIONED_IN_DOCUMENT',
      payload: expect.objectContaining({ userId: 'user-1' }),
    }));
  });
});
