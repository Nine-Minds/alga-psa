import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { UnauthorizedError } from '@/lib/api/middleware/apiMiddleware';
import { ApiMetadataController } from '@/lib/api/controllers/ApiMetadataController';

const runWithTenantMock = vi.hoisted(() => vi.fn(async (_tenant: string, callback: () => Promise<Response> | Response) => callback()));
const createTenantKnexMock = vi.hoisted(() => vi.fn(async () => ({
  knex: {
    fn: { now: () => new Date() },
  },
  tenant: 'tenant-stub',
})));

vi.mock('@/lib/db', () => ({
  runWithTenant: runWithTenantMock,
}));

vi.mock('server/src/lib/db', () => ({
  runWithTenant: runWithTenantMock,
  createTenantKnex: createTenantKnexMock,
}));

describe('ApiMetadataController.getDocs', () => {
  beforeEach(() => {
    runWithTenantMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildRequest(url: string): NextRequest {
    const base = new Request(url, {
      headers: {
        'x-api-key': 'test-key',
      },
    });
    return new NextRequest(base);
  }

  it('returns rendered documentation HTML when format is omitted', async () => {
    const controller = new ApiMetadataController();
    const handler = controller.getDocs();
    const request = buildRequest('http://example.com/api/v1/meta/docs');

    vi.spyOn(controller as any, 'generateSwaggerUI').mockReturnValue('<html><body>Docs</body></html>');
    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(request, {
        context: {
          tenant: 'tenant-123',
          user: { user_id: 'user-1' },
        },
      }),
    );
    vi.spyOn(controller as any, 'checkPermission').mockResolvedValue(undefined);

    const response = await handler(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<body>Docs</body>');
    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-123', expect.any(Function));
  });

  it('redirects to the OpenAPI endpoint when format is not html', async () => {
    const controller = new ApiMetadataController();
    const handler = controller.getDocs();
    const request = buildRequest('http://example.com/api/v1/meta/docs?format=json');

    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(request, {
        context: {
          tenant: 'tenant-abc',
          user: { user_id: 'user-2' },
        },
      }),
    );
    vi.spyOn(controller as any, 'checkPermission').mockResolvedValue(undefined);

    const response = await handler(request);

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get('location')).toBe('http://example.com/api/v1/meta/openapi');
    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-abc', expect.any(Function));
  });

  it('translates authentication failures into API errors', async () => {
    const controller = new ApiMetadataController();
    const handler = controller.getDocs();
    const request = buildRequest('http://example.com/api/v1/meta/docs');

    vi.spyOn(controller as any, 'authenticate').mockRejectedValue(new UnauthorizedError('Invalid key'));

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(runWithTenantMock).not.toHaveBeenCalled();
  });
});
