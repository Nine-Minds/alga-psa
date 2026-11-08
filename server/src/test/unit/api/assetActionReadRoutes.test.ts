import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  redactions: [] as string[],
  keyOnly: false,
  subjects: [] as any[],
  notesCalls: 0,
  softwareCalls: 0,
}));
const principal = vi.hoisted(() => ({
  user_id: 'asset-action-review-user',
  tenant: 'asset-action-review-tenant',
  user_type: 'internal',
}));
const softwareRows = vi.hoisted(() => ([
  {
    software_id: 'review-software',
    name: 'PRIVATE-SOFTWARE-NAME',
    publisher: 'Visible Publisher',
    category: 'Security',
    software_type: 'application',
    version: '1.0',
    install_date: '2026-10-15',
    size_bytes: 4938,
    first_seen_at: '2026-10-15T12:00:00Z',
    is_current: true,
    is_managed: true,
    is_security_relevant: true,
  },
]));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => principal),
  runWithApiKeyUser: vi.fn(async (_user: unknown, fn: () => Promise<unknown>) => fn()),
  withAuth: (fn: any) => (...args: any[]) => fn(principal, { tenant: principal.tenant }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn(principal, { tenant: principal.tenant }, ...args),
}));
vi.mock('@/lib/api/middleware/apiAuthMiddleware', () => ({
  authenticateApiKeyRequest: vi.fn(async (request: any) => {
    request.context = {
      user: principal,
      tenant: principal.tenant,
      userId: principal.user_id,
      apiKeyId: 'assigned-review-key',
    };
    return request;
  }),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    getAuthorizationRecord = vi.fn(async () => ({ id: 'review-asset', clientId: 'review-client' }));
  },
}));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async ({ subject }: any) => {
      state.subjects.push(subject);
      return {
        allowed: true,
        redactedFields: !state.keyOnly || subject.apiKeyId === 'assigned-review-key'
          ? state.redactions
          : [],
      };
    }),
  })),
}));
vi.mock('@alga-psa/assets/actions/assetNoteActions', () => ({
  getAssetNoteContent: vi.fn(async () => {
    state.notesCalls += 1;
    return {
      document: { document_id: 'review-document', document_name: 'PRIVATE-DOCUMENT-NAME', file_size: 4938 },
      blockData: [{ type: 'paragraph', text: 'PRIVATE-NOTE-CONTENT' }],
      lastUpdated: '2026-10-15',
    };
  }),
  saveAssetNote: vi.fn(async () => ({ document_id: 'PRIVATE-LINKED-DOCUMENT' })),
  deleteAssetNote: vi.fn(),
}));
vi.mock('@alga-psa/assets/actions/softwareActions', () => ({
  getAssetSoftwareForApi: vi.fn(async () => {
    state.softwareCalls += 1;
    return softwareRows;
  }),
}));

import * as notes from '../../../app/api/v1/assets/[id]/notes/route';
import * as software from '../../../app/api/v1/assets/[id]/software/route';
import { assertAssetRecordAccess } from '../../../lib/api/controllers/assetReadGuard';

beforeEach(() => {
  state.redactions = [];
  state.keyOnly = false;
  state.subjects = [];
  state.notesCalls = 0;
  state.softwareCalls = 0;
});

const call = (route: typeof notes | typeof software, query = '') => route.GET(
  new Request(`http://localhost/api/v1/assets/review-asset/${route === notes ? 'notes' : 'software'}${query}`, {
    headers: { 'x-api-key': 'key-secret' },
  }),
  { params: Promise.resolve({ id: 'review-asset' }) },
);

const putNotes = async () => {
  const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
  vi.mocked(saveAssetNote).mockClear();
  return notes.PUT(new Request('http://localhost/api/v1/assets/review-asset/notes', {
    method: 'PUT',
    headers: { 'x-api-key': 'key-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ blockData: [{ type: 'paragraph', text: 'updated' }] }),
  }),
  { params: Promise.resolve({ id: 'review-asset' }) },
  );
};

describe('action-backed asset REST reads retain key-scoped projections', () => {
  it('applies a key-scoped whole-asset rule before reading the resource', async () => {
    state.keyOnly = true;
    state.redactions = ['assets'];
    await expect(assertAssetRecordAccess(
      { user: principal, tenant: principal.tenant, apiKeyId: 'assigned-review-key' } as any,
      'review-asset',
      { getAuthorizationRecord: async () => ({ id: 'review-asset' }) },
    )).rejects.toMatchObject({ statusCode: 404 });
  });

  for (const [name, route] of [['notes', notes], ['software', software]] as const) {
    it(`${name} visible control returns its readable data`, async () => {
      const response = await call(route);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).toContain(name === 'notes' ? 'PRIVATE-NOTE-CONTENT' : 'PRIVATE-SOFTWARE-NAME');
    });

    it(`${name} carries the API-key identity and suppresses the asset before loading data`, async () => {
      state.keyOnly = true;
      state.redactions = ['assets'];
      const response = await call(route);
      expect(response.status).toBe(404);
      expect(state.notesCalls + state.softwareCalls).toBe(0);
      expect(state.subjects.at(-1)?.apiKeyId).toBe('assigned-review-key');
    });
  }

  it.each(['documents.document_name', 'fields.documents.document_name'])(
    'notes document metadata honors %s while retaining readable content', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.document).not.toHaveProperty('document_name');
      expect(data.blockData).toEqual([{ type: 'paragraph', text: 'PRIVATE-NOTE-CONTENT' }]);
    },
  );

  it.each(['documents', 'documents.document_id'])(
    'notes omit document and block content when %s is suppressed', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('PRIVATE-DOCUMENT-NAME');
      expect(body).not.toContain('PRIVATE-NOTE-CONTENT');
    },
  );

  it.each(['document_associations', 'document_associations.association_id'])(
    'notes omit block content when its association is suppressed by %s', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('PRIVATE-NOTE-CONTENT');
    },
  );

  it('software hides the catalog name while preserving visible fields', async () => {
    state.keyOnly = true;
    state.redactions = ['software_catalog.name'];
    const response = await call(software);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty('name');
    expect(data[0].publisher).toBe('Visible Publisher');
  });

  it('does not search using a hidden catalog name', async () => {
    state.keyOnly = true;
    state.redactions = ['software_catalog.name'];
    const response = await call(software, '?search=PRIVATE-SOFTWARE-NAME');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it.each([
    'asset_software',
    'asset_software.software_id',
    'asset_software.asset_id',
    'software_catalog',
    'software_catalog.software_id',
  ])(
    'software records suppressed by %s do not affect rows, pagination, or totals', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(software, '?page=2&limit=1');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination).toMatchObject({ page: 2, limit: 1, total: 0, totalPages: 0 });
      expect(body.summary.total_installed).toBe(0);
      expect(body.summary.security_software_count).toBe(0);
      expect(body.summary.managed_software_count).toBe(0);
    },
  );

  it('does not filter on a hidden category or derive its aggregate', async () => {
    state.keyOnly = true;
    state.redactions = ['software_catalog.category'];
    const response = await call(software, '?category=Security');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.summary.by_category).toBeNull();
  });
});

describe('asset note source provenance', () => {
  it('visible control retains document identity, block content and content timestamp', async () => {
    const response = await call(notes);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.document.document_id).toBe('review-document');
    expect(data.blockData).toEqual([{ type: 'paragraph', text: 'PRIVATE-NOTE-CONTENT' }]);
    expect(data.lastUpdated).toBe('2026-10-15');
  });

  it.each(['notes_document_id', 'assets.notes_document_id', 'values.notes_document_id', 'fields.assets.notes_document_id'])(
    'does not disclose a document identity copied from hidden asset foreign key %s', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('review-document');
      expect(body).not.toContain('PRIVATE-NOTE-CONTENT');
    },
  );

  it.each(['document_block_content.block_data', 'fields.document_block_content.block_data', 'values.block_data'])(
    'does not disclose content copied from hidden source %s', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(JSON.stringify(data)).not.toContain('PRIVATE-NOTE-CONTENT');
      expect(data.document.document_id).toBe('review-document');
      expect(data.document.document_name).toBe('PRIVATE-DOCUMENT-NAME');
    },
  );

  it.each(['document_block_content', 'document_block_content.content_id', 'document_block_content.document_id'])(
    'does not serialize suppressed note content from %s', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(JSON.stringify(data)).not.toContain('PRIVATE-NOTE-CONTENT');
      expect(data.document.document_id).toBe('review-document');
    },
  );

  it.each(['document_block_content.updated_at', 'fields.document_block_content.updated_at'])(
    'does not disclose lastUpdated copied from %s', async (alias) => {
      state.keyOnly = true;
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.lastUpdated ?? null).toBeNull();
      expect(data.blockData).toEqual([{ type: 'paragraph', text: 'PRIVATE-NOTE-CONTENT' }]);
    },
  );

  it.each(['assets.documents.file_size', 'values.documents.file_size', 'fields.assets.documents.file_size'])(
    'retains the canonical document child scope for %s', async (alias) => {
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.document).not.toHaveProperty('file_size');
      expect(data.document.document_name).toBe('PRIVATE-DOCUMENT-NAME');
      expect(data.blockData).toEqual([{ type: 'paragraph', text: 'PRIVATE-NOTE-CONTENT' }]);
    },
  );

  it.each(['values.documents', 'assets.documents.document_id', 'fields.assets.documents.document_id'])(
    'retains document suppression under its original parent namespace %s', async (alias) => {
      state.redactions = [alias];
      const response = await call(notes);
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(data.document).toBeNull();
      expect(data.blockData).toBeNull();
      expect(data.lastUpdated).toBeNull();
    },
  );

  it('does not mutate action results while applying source redactions', async () => {
    const { getAssetNoteContent } = await import('@alga-psa/assets/actions/assetNoteActions');
    const content = {
      document: { document_id: 'review-document', document_name: 'Private name' },
      blockData: [{ text: 'Original content' }],
      lastUpdated: '2026-10-15',
    };
    const original = structuredClone(content);
    vi.mocked(getAssetNoteContent).mockResolvedValueOnce(content as any);
    state.redactions = ['assets.notes_document_id'];

    const response = await call(notes);
    expect((await response.json()).data).toEqual({ document: null, blockData: null, lastUpdated: null });
    expect(content).toEqual(original);
  });
});

describe('asset note mutation response uses the retained document source graph', () => {
  it('retains the linked document identity as a visible control and performs the write', async () => {
    const response = await putNotes();
    expect(response.status).toBe(200);
    expect((await response.json()).data.document_id).toBe('PRIVATE-LINKED-DOCUMENT');
    const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
    expect(saveAssetNote).toHaveBeenCalledTimes(1);
  });

  it.each([
    'assets.documents.document_id',
    'values.documents.document_id',
    'fields.assets.documents.document_id',
    'values.documents',
  ])('does not disclose the linked document under %s while preserving the write', async (alias) => {
    state.keyOnly = true;
    state.redactions = [alias];
    const response = await putNotes();
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE-LINKED-DOCUMENT');
    const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
    expect(saveAssetNote).toHaveBeenCalledTimes(1);
  });
});

describe('asset note mutation response projection', () => {
  const put = async (redactions: string[]) => {
    state.keyOnly = true;
    state.redactions = redactions;
    const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
    vi.mocked(saveAssetNote).mockClear();
    vi.mocked(saveAssetNote).mockResolvedValueOnce({ document_id: 'PRIVATE-LINKED-DOCUMENT' } as any);
    return notes.PUT(new Request('http://localhost/api/v1/assets/review-asset/notes', {
      method: 'PUT',
      headers: { 'x-api-key': 'key-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ blockData: [] }),
    }), { params: Promise.resolve({ id: 'review-asset' }) });
  };

  it('returns readable mutation metadata for a visible control', async () => {
    const response = await put([]);
    expect(response.status).toBe(200);
    expect((await response.json()).data.document_id).toBe('PRIVATE-LINKED-DOCUMENT');
    const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
    expect(saveAssetNote).toHaveBeenCalled();
  });

  it.each(['assets.notes_document_id', 'values.notes_document_id', 'documents.document_id'])(
    'does not disclose a linked document hidden by %s while retaining write execution', async (alias) => {
      const response = await put([alias]);
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain('PRIVATE-LINKED-DOCUMENT');
      const { saveAssetNote } = await import('@alga-psa/assets/actions/assetNoteActions');
      expect(saveAssetNote).toHaveBeenCalled();
      expect(state.subjects.at(-1)?.apiKeyId).toBe('assigned-review-key');
    },
  );
});
