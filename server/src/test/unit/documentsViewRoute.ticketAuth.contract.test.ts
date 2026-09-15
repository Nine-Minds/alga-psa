import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestScenario = {
  allowTicketAccess: boolean;
  fileMissing?: boolean;
};

const scenario = vi.hoisted<TestScenario>(() => ({
  allowTicketAccess: true,
}));

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getConnectionMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const createProviderMock = vi.hoisted(() => vi.fn());
const fileStoreFindByIdMock = vi.hoisted(() => vi.fn());
const getAuthorizedDocumentByFileIdMock = vi.hoisted(() => vi.fn());
// Models the real helper: the tenant is only visible to code running inside the callback.
const tenantScope = vi.hoisted(() => ({ active: null as string | null }));
const runWithTenantMock = vi.hoisted(() => vi.fn(async (tenant: string, callback: () => Promise<unknown>) => {
  tenantScope.active = tenant;
  try {
    return await callback();
  } finally {
    tenantScope.active = null;
  }
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: async (knex: any, callback: (trx: any) => Promise<unknown>) => callback(knex),
  runWithTenant: runWithTenantMock,
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentByFileId: getAuthorizedDocumentByFileIdMock,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
  withTransaction: async (knex: any, callback: (trx: any) => Promise<unknown>) => callback(knex),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: createProviderMock,
  },
  FileStoreModel: {
    findById: fileStoreFindByIdMock,
  },
}));

type QueryState = {
  whereClauses: Array<Record<string, unknown>>;
  whereInClauses: Array<{ key: string; values: unknown[] }>;
};

function makeKnexMock(testScenario: TestScenario) {
  const knex = ((table: string) => {
    const state: QueryState = {
      whereClauses: [],
      whereInClauses: [],
    };
    const builder: any = {
      where(arg1: any, arg2?: any) {
        if (typeof arg1 === 'object' && arg1 !== null) {
          state.whereClauses.push(arg1);
        } else if (typeof arg1 === 'string') {
          state.whereClauses.push({ [arg1]: arg2 });
        }
        return builder;
      },
      andWhere(arg1: any, arg2?: any) {
        if (typeof arg1 === 'function') {
          // Route uses callback-scoped conditions; this mock only needs final branch outcomes.
          return builder;
        }
        return builder.where(arg1, arg2);
      },
      whereIn(key: string, values: unknown[]) {
        state.whereInClauses.push({ key, values });
        return builder;
      },
      join() {
        return builder;
      },
      leftJoin() {
        return builder;
      },
      select(..._columns: string[]) {
        return builder;
      },
      first(..._columns: string[]) {
        const result = resolveQueryResult(table, state, testScenario);
        if (Array.isArray(result)) {
          return Promise.resolve(result[0] || null);
        }
        return Promise.resolve(result ?? null);
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(resolveQueryResult(table, state, testScenario)).then(
          onFulfilled,
          onRejected
        );
      },
    };

    return builder;
  }) as any;

  return knex;
}

function resolveQueryResult(table: string, state: QueryState, testScenario: TestScenario): any {
  if (table === 'external_files') {
    if (testScenario.fileMissing) {
      return null;
    }
    return {
      file_id: 'file-1',
      tenant: 'tenant-1',
      is_deleted: false,
      mime_type: 'image/png',
      file_size: 4,
      storage_path: 'tenant-1/file-1.png',
    };
  }

  if (table === 'documents') {
    return { document_id: 'doc-1', file_id: 'file-1' };
  }

  if (table === 'document_associations') {
    const logoLookup = state.whereClauses.some(
      (clause) => clause.entity_type === 'tenant' && clause.is_entity_logo === true
    );
    if (logoLookup) {
      return null;
    }
    return [{ entity_id: 'ticket-1', entity_type: 'ticket' }];
  }

  if (table === 'contacts') {
    return { client_id: 'client-1' };
  }

  if (table === 'tickets') {
    return testScenario.allowTicketAccess ? { ticket_id: 'ticket-1' } : null;
  }

  if (table === 'users') {
    return null;
  }

  return null;
}

function makeReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.close();
    },
  });
}

describe('documents view route ticket authorization contract', () => {
  beforeEach(() => {
    scenario.allowTicketAccess = true;
    scenario.fileMissing = false;
    vi.clearAllMocks();

    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      user_type: 'client',
      tenant: 'tenant-1',
      contact_id: 'contact-1',
    });

    getConnectionMock.mockResolvedValue(makeKnexMock(scenario));
    createTenantKnexMock.mockResolvedValue({
      tenant: 'tenant-1',
      knex: makeKnexMock(scenario),
    });
    getAuthorizedDocumentByFileIdMock.mockImplementation(async () => (
      scenario.allowTicketAccess
        ? {
            document_id: 'doc-1',
            file_id: 'file-1',
            document_name: 'Ticket screenshot',
            is_client_visible: true,
          }
        : null
    ));
    createProviderMock.mockResolvedValue({
      getReadStream: vi.fn().mockResolvedValue(makeReadableStream()),
    });
    fileStoreFindByIdMock.mockResolvedValue(null);
  });

  it('T014: allows ticket-associated contact/client user to view file', async () => {
    vi.resetModules();
    const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');

    const response = await GET(
      new NextRequest('http://localhost:3000/api/documents/view/file-1'),
      { params: Promise.resolve({ fileId: 'file-1' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 404, not 500, when no live file record exists', async () => {
    scenario.fileMissing = true;
    // FileStoreModel.findById resolves its tenant from async context and throws without one.
    fileStoreFindByIdMock.mockImplementation(async () => {
      if (!tenantScope.active) throw new Error('tenant context not found');
      return null;
    });
    const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/documents/view/file-1'),
      { params: Promise.resolve({ fileId: 'file-1' }) } as any
    );
    expect(response.status).toBe(404);
    // The fallback lookup resolves its tenant from async context, so it must run inside it.
    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(fileStoreFindByIdMock).toHaveBeenCalledWith(expect.anything(), 'file-1');
  });

  it('serves a file the tenant-scoped fallback finds when the unscoped lookup misses', async () => {
    scenario.fileMissing = true;
    fileStoreFindByIdMock.mockImplementation(async () => {
      if (!tenantScope.active) throw new Error('tenant context not found');
      return {
      file_id: 'file-1',
      tenant: 'tenant-1',
      is_deleted: false,
      mime_type: 'image/png',
      file_size: 4,
      storage_path: 'tenant-1/file-1.png',
      };
    });
    const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/documents/view/file-1'),
      { params: Promise.resolve({ fileId: 'file-1' }) } as any
    );
    expect(response.status).toBe(200);
  });

  it('resolves a document id to the document\'s current file', async () => {
    scenario.fileMissing = true;
    fileStoreFindByIdMock.mockImplementation(async (_knex: unknown, id: string) => {
      if (!tenantScope.active) throw new Error('tenant context not found');
      return id === 'file-1'
        ? { file_id: 'file-1', tenant: 'tenant-1', is_deleted: false, mime_type: 'image/png', file_size: 4, storage_path: 'tenant-1/file-1.png' }
        : null;
    });
    const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/documents/view/doc-1'),
      { params: Promise.resolve({ fileId: 'doc-1' }) } as any
    );
    expect(response.status).toBe(200);
    expect(fileStoreFindByIdMock).toHaveBeenCalledWith(expect.anything(), 'doc-1');
    expect(fileStoreFindByIdMock).toHaveBeenCalledWith(expect.anything(), 'file-1');
    // Authorization runs against the resolved file, not the id in the URL.
    expect(getAuthorizedDocumentByFileIdMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.anything(), 'file-1');
  });

  it('T013: rejects ticket file view when contact/client user lacks ticket association access', async () => {
    scenario.allowTicketAccess = false;
    createTenantKnexMock.mockResolvedValue({
      tenant: 'tenant-1',
      knex: makeKnexMock(scenario),
    });

    vi.resetModules();
    const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');

    const response = await GET(
      new NextRequest('http://localhost:3000/api/documents/view/file-1'),
      { params: Promise.resolve({ fileId: 'file-1' }) }
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe('Forbidden');
    expect(createProviderMock).not.toHaveBeenCalled();
  });
});
