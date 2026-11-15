import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode } from '@auth/core/jwt';
import { getSessionCookieName } from '@alga-psa/auth/session';

// The EE Playwright helpers mint the session cookie the app under test reads.
// If one of them builds the name by hand it writes a cookie nothing reads (or
// one a portless runtime parses as a chunk and clears), and every
// authenticated spec on a ported base URL signs itself out.

vi.mock('@alga-psa/db/tenantDb', () => ({ tenantDb: vi.fn() }));
vi.mock('../../lib/testing/tenant-test-factory', () => ({ createTestTenant: vi.fn() }));
vi.mock('../integration/utils/playwrightDatabaseConfig', () => ({ PLAYWRIGHT_DB_CONFIG: {} }));

const { PlaywrightAuthSessionHelper } = await import('../integration/helpers/playwrightAuthSessionHelper');
const { establishTenantSession } = await import('../integration/utils/auth-helpers');
const { setInternalSessionCookie } = await import('../integration/utils/internalAdminTestAuth');

const SECRET = 'playwright-helper-test-secret';
const COOKIE_ENV = ['NEXTAUTH_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'PORT', 'APP_PORT', 'EXPOSE_SERVER_PORT', 'EE_BASE_URL'];

type WrittenCookie = { name: string; value: string };

function fakePage() {
  const written: WrittenCookie[] = [];
  const page = {
    context: () => ({ addCookies: async (cookies: WrittenCookie[]) => { written.push(...cookies); } }),
    addInitScript: vi.fn(),
  };
  return { page: page as any, written };
}

const tenantData = {
  tenant: { tenantId: 'tenant-1' },
  adminUser: { userId: 'user-1', email: 'Admin@Example.com', firstName: 'Ada', lastName: 'Admin' },
} as any;

const HELPERS: Array<[string, (page: any, baseUrl: string) => Promise<unknown>]> = [
  ['PlaywrightAuthSessionHelper.authenticate', (page, baseUrl) =>
    PlaywrightAuthSessionHelper.authenticate(page, tenantData, { baseUrl })],
  ['establishTenantSession', (page, baseUrl) => establishTenantSession(page, tenantData, baseUrl)],
  ['setInternalSessionCookie', (page, baseUrl) =>
    setInternalSessionCookie(page, { user_id: 'user-1', email: 'admin@example.com', tenant: 'tenant-1' }, baseUrl)],
];

beforeEach(() => {
  for (const key of COOKIE_ENV) vi.stubEnv(key, undefined as unknown as string);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXTAUTH_SECRET', SECRET);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function decodesUnder(written: WrittenCookie[], name: string): Promise<boolean> {
  const cookie = written.find((candidate) => candidate.name === name);
  if (!cookie) return false;
  const token = await decode({ token: cookie.value, secret: SECRET, salt: name });
  return token?.sub === 'user-1';
}

describe.each(HELPERS)('%s', (_label, run) => {
  it('writes the runtime session cookie for a ported base URL, salted with that name', async () => {
    const { page, written } = fakePage();
    await run(page, 'http://localhost:3911');

    expect(await decodesUnder(written, 'authjs-port-3911.session-token')).toBe(true);
    // The pre-fix `<name>.<port>` shape is what a portless runtime treats as a chunk.
    expect(written.map((cookie) => cookie.name)).not.toContain('authjs.session-token.3911');
  });

  it('follows the configured public URL exactly as the runtime does', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:4100');
    const runtimeName = getSessionCookieName();
    expect(runtimeName).toBe('authjs-port-4100.session-token');

    const { page, written } = fakePage();
    await run(page, 'http://localhost:3911');

    expect(await decodesUnder(written, runtimeName)).toBe(true);
  });
});
