import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The capability probe is session-authenticated in-route. Calling `GET`
 * directly cannot show that edge middleware lets a browser session reach it
 * (middleware answers `401 API key required` for every `/api/v1/*` path that is
 * not exempted). This test sends the request through the real middleware and
 * dispatches to the real route handler only when middleware passes it on,
 * as Next.js does.
 */

const getSession = vi.hoisted(() => vi.fn());
const flag = vi.hoisted(() => vi.fn());

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
vi.mock('@alga-psa/auth', () => ({ getSession }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag }));

import middleware from 'server/src/middleware';
import {  } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { GET } from 'server/src/app/api/v1/capabilities/co-managed/route';

const PROBE = 'http://localhost:3000/api/v1/capabilities/co-managed';
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
const mspUser = { id: 'u1', user_type: 'internal', tenant: 'tenant-1' };

type Middleware = (req: NextRequest) => Promise<Response>;

/** Middleware first; the route runs only when middleware hands the request on. */
async function dispatch(url: string, auth: { user: typeof mspUser } | null): Promise<Response> {
  const req = Object.assign(new NextRequest(url), { auth });
  const res = await (middleware as unknown as Middleware)(req);
  if (res.headers.get('x-middleware-next') !== '1') return res;
  return GET();
}

describe('capability probe behind the real middleware', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    resetCapabilityRegistry();
    clearCapabilityCache();
    flag.mockResolvedValue(true);
    getSession.mockResolvedValue({ user: mspUser });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.FORCE_CAPABILITIES;
    vi.clearAllMocks();
  });

  it('a browser session without x-api-key reaches the handler (closed gate => the NotFound 404, not 401)', async () => {
    const res = await dispatch(PROBE, { user: mspUser });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('FORCE_CAPABILITIES=co-managed:on answers 200 through the middleware', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    const res = await dispatch(PROBE, { user: mspUser });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ capability: 'co-managed', tenantId: 'tenant-1', forced: 'on' });
  });

  it('FORCE_CAPABILITIES=co-managed:off closes it again through the middleware', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const res = await dispatch(PROBE, { user: mspUser });
    expect(res.status).toBe(404);
  });

  it('no session reaches the handler and gets its 401, not the API-key 401', async () => {
    getSession.mockResolvedValue(null);
    const res = await dispatch(PROBE, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('the exemption names the probe only: siblings and deeper paths under /api/v1/capabilities/ still need an API key', async () => {
    for (const url of [
      'http://localhost:3000/api/v1/capabilities/other',
      'http://localhost:3000/api/v1/capabilities/co-managed/extra',
      'http://localhost:3000/api/v1/capabilities/co-managed-evil',
      'http://localhost:3000/api/v1/capabilities',
    ]) {
      const res = await dispatch(url, { user: mspUser });
      expect(res.status, url).toBe(401);
      expect(await res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'API key required' } });
    }
    expect(getSession).not.toHaveBeenCalled();
  });

  it('the same harness still stops an unexempted v1 route at the API-key check', async () => {
    const res = await dispatch('http://localhost:3000/api/v1/boards', { user: mspUser });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'API key required' } });
    expect(getSession).not.toHaveBeenCalled();
  });
});
