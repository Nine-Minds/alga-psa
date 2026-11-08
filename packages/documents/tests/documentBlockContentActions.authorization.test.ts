import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  authorizedDocument: vi.fn(),
  contentReads: 0,
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
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => unknown) => callback({}),
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
          return undefined;
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
vi.mock('../src/cache/CacheFactory', () => ({ CacheFactory: {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: vi.fn() }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ permissionError: message }),
  isActionPermissionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'permissionError' in value),
}));
vi.mock('../src/actions/documentActionErrors', () => ({
  documentActionErrorFrom: () => null,
}));

import { getBlockContent } from '../src/actions/documentBlockContentActions';

const user = { user_id: 'user-1', tenant: 'tenant-a', user_type: 'internal' } as any;
const invoke = (action: any, ...args: any[]) => action(...args);

describe('documents block content authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contentReads = 0;
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
});
