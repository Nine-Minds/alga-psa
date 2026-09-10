import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
import middleware from 'server/src/middleware';

afterEach(() => vi.unstubAllEnvs());

it('returns the v1 API error contract when the API key is absent', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('E2E_AUTH_BYPASS', 'false');
  const req = Object.assign(new NextRequest('http://localhost:3000/api/v1/boards'), { auth: null });
  const response = await (middleware as unknown as (req: NextRequest) => Promise<Response>)(req);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED', message: 'API key required' } });
});
