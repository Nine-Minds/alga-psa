import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  pending: new Set<string>(),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  getAuthorizedDocumentById: vi.fn(),
  createTenantKnex: vi.fn(),
  validateApiKeyAnyTenant: vi.fn(),
  findUserByIdForApi: vi.fn(),
}));

vi.mock('@/lib/api/coManagedWorkspaceDenial', async () => {
  const { NextResponse } = await import('next/server');
  return {
    coManagedWorkspaceDenial: async (tenant: string) =>
      mocks.pending.has(tenant)
        ? NextResponse.json({ error: { code: 'CO_MANAGED_NOT_ACTIVE' } }, { status: 409 })
        : null,
  };
});
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => ({ table: () => ({ where: () => ({ select: () => ({ first: async () => undefined }) }) }) }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({ convertBlockNoteToMarkdown: () => '' }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: mocks.findUserByIdForApi }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: { validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant },
}));
vi.mock('@/lib/api/middleware/apiMiddleware', () => ({ assertInternalApiUser: () => undefined }));
vi.mock('server/src/lib/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentById: mocks.getAuthorizedDocumentById,
}));

import { GET } from '../../../app/api/documents/[documentId]/content/route';

const call = (headers: Record<string, string> = {}) =>
  GET(new NextRequest('http://localhost/api/documents/d1/content', { headers }), {
    params: Promise.resolve({ documentId: 'd1' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.clear();
  mocks.pending.add('workspace');
  mocks.hasPermission.mockResolvedValue(true);
  mocks.getAuthorizedDocumentById.mockResolvedValue(null);
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
});

describe('document content route before co-managed acceptance', () => {
  it('refuses a session caller of a pending workspace before permission or document reads', async () => {
    mocks.getCurrentUser.mockResolvedValue({ user_id: 'u', tenant: 'workspace' });
    const response = await call();
    expect(response.status).toBe(409);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.getAuthorizedDocumentById).not.toHaveBeenCalled();
  });

  it('refuses an API-key caller of a pending workspace before permission or document reads', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.validateApiKeyAnyTenant.mockResolvedValue({ tenant: 'workspace', user_id: 'u' });
    mocks.findUserByIdForApi.mockResolvedValue({ user_id: 'u', tenant: 'workspace' });
    const response = await call({ 'x-api-key': 'k' });
    expect(response.status).toBe(409);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.getAuthorizedDocumentById).not.toHaveBeenCalled();
  });

  it('lets a non-pending tenant proceed to the permission and document checks', async () => {
    mocks.getCurrentUser.mockResolvedValue({ user_id: 'u', tenant: 'ordinary' });
    const response = await call();
    expect(response.status).toBe(404);
    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
    expect(mocks.getAuthorizedDocumentById).toHaveBeenCalledTimes(1);
  });
});
