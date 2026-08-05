import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createEditionGateResponseBody } from '@/lib/editionGating/types';
import { getEditionGateResponse } from '@/lib/editionGating/client';

describe('edition-gated API responses', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'community';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      feature: 'mcp' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/mcp/agents/route');
        return route.GET(new NextRequest('http://localhost/api/v1/mcp/agents'));
      },
    },
    {
      feature: 'platform-notifications' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/platform-notifications/route');
        return route.GET(new Request('http://localhost/api/v1/platform-notifications'));
      },
    },
    {
      feature: 'platform-reports' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/platform-reports/route');
        return route.GET(new Request('http://localhost/api/v1/platform-reports'));
      },
    },
    {
      feature: 'platform-feature-flags' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/platform-feature-flags/route');
        return route.GET(new Request('http://localhost/api/v1/platform-feature-flags'));
      },
    },
    {
      feature: 'tenant-management' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/tenant-management/tenants/route');
        return route.GET(new Request('http://localhost/api/v1/tenant-management/tenants'));
      },
    },
    {
      feature: 'appliance-installs' as const,
      invoke: async () => {
        const route = await import('@/app/api/v1/appliance-installs/route');
        return route.GET(new Request('http://localhost/api/v1/appliance-installs'));
      },
    },
  ])('returns the shared 403 contract for $feature', async ({ feature, invoke }) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(createEditionGateResponseBody(feature));
  });

  it('keeps discovery responses non-cacheable', async () => {
    const route = await import('@/app/.well-known/oauth-protected-resource/route');
    const response = await route.GET(
      new NextRequest('http://localhost/.well-known/oauth-protected-resource'),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.json()).resolves.toEqual(createEditionGateResponseBody('mcp'));
  });

  it('preserves OAuth error fields while exposing the shared signal', async () => {
    const route = await import('@/app/api/mcp/oauth/token/route');
    const response = await route.POST(
      new NextRequest('http://localhost/api/mcp/oauth/token', { method: 'POST' }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(body).toMatchObject({
      error: 'access_denied',
      error_description: 'MCP server is available with AlgaPSA Pro.',
      code: 'EE_REQUIRED',
      feature: 'mcp',
    });
  });

  it('does not classify genuine not-found or authorization responses as edition gates', () => {
    expect(getEditionGateResponse(404, { error: 'Not found' })).toBeNull();
    expect(getEditionGateResponse(401, { error: 'Unauthorized' })).toBeNull();
    expect(getEditionGateResponse(403, { error: 'Forbidden' })).toBeNull();
    expect(getEditionGateResponse(404, createEditionGateResponseBody('mcp'))).toBeNull();
    expect(
      getEditionGateResponse(403, {
        ...createEditionGateResponseBody('mcp'),
        upgrade: { product: 'AlgaPSA Pro', cta: 'View Plans', href: 'javascript:alert(1)' },
      }),
    ).toBeNull();
  });
});
