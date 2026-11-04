import { AsyncLocalStorage } from 'node:async_hooks';
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({
  user: { tenant: 'authenticated-tenant' } as { tenant: string } | null,
  permitted: true,
  document: { file_id: 'file-id' } as object | undefined,
  download: vi.fn(),
}));
const tenantContext = new AsyncLocalStorage<string>();
vi.mock('@alga-psa/db', () => ({
  runWithTenant: (tenant: string, callback: () => Promise<unknown>) => tenantContext.run(tenant, callback),
  tenantDb: (_knex: unknown, tenant: string) => {
    expect(tenant).toBe('authenticated-tenant');
    return { table: () => ({ where: () => ({ first: async () => fixture.document }) }) };
  },
}));
vi.mock('server/src/lib/auth/session', () => ({ getCurrentUser: async () => fixture.user }));
vi.mock('server/src/lib/db', () => ({ createTenantKnex: async (tenant: string) => ({ knex: {}, tenant }) }));
vi.mock('server/src/lib/utils/documentPermissionUtils', () => ({ canAccessDocument: async () => fixture.permitted }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: (...args: unknown[]) => fixture.download(...args) } }));

beforeEach(() => {
  fixture.user = { tenant: 'authenticated-tenant' };
  fixture.document = { file_id: 'file-id' };
  fixture.permitted = true;
  fixture.download.mockReset().mockImplementation(async () => {
    if (tenantContext.getStore() !== 'authenticated-tenant') throw new Error('tenant context not found');
    return { buffer: Buffer.from('original bytes'), metadata: { original_name: 'review.txt', mime_type: 'text/plain' } };
  });
});

async function download() {
  const { GET } = await import('@/app/api/files/[fileId]/download/route');
  return GET(new NextRequest('http://app.test/api/files/file-id/download'), { params: Promise.resolve({ fileId: 'file-id' }) });
}

it('serves authorized bytes under the session tenant and restores the caller context', async () => {
  await tenantContext.run('unrelated-request', async () => {
    const response = await download();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('original bytes');
    expect(tenantContext.getStore()).toBe('unrelated-request');
  });
  expect(fixture.download).toHaveBeenCalledExactlyOnceWith('file-id');
});

it.each(['unauthenticated', 'missing', 'forbidden'])('does not read storage when %s', async denial => {
  if (denial === 'unauthenticated') fixture.user = null;
  if (denial === 'missing') fixture.document = undefined;
  if (denial === 'forbidden') fixture.permitted = false;
  expect((await download()).status).toBe(denial === 'unauthenticated' ? 401 : 404);
  expect(fixture.download).not.toHaveBeenCalled();
});
