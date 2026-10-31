import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Edge middleware and the edge Auth.js instance read the session cookie. They
// agree with NextAuth and Express only because they take the name from the
// shared function; a literal written into either would pass every other test.

const envSnapshot = { ...process.env };
const capturedConfigs: Array<{ cookies?: { sessionToken?: { name?: string } } }> = [];

vi.mock('next-auth', () => ({
  default: (config: (typeof capturedConfigs)[number]) => {
    capturedConfigs.push(config);
    return { auth: () => undefined };
  },
}));

const ENVIRONMENTS: Array<{ label: string; env: Record<string, string | undefined>; expected: string }> = [
  { label: 'development, ported public URL', env: { NODE_ENV: 'development', NEXTAUTH_URL: 'http://localhost:3003' }, expected: 'authjs-port-3003.session-token' },
  { label: 'production http, ported', env: { NODE_ENV: 'production', NEXTAUTH_URL: 'http://psa.local:8080', PORT: '3000' }, expected: 'authjs-port-8080.session-token' },
  { label: 'production https, ported', env: { NODE_ENV: 'production', NEXTAUTH_URL: 'https://psa.example.com:8443', PORT: '3000' }, expected: '__Secure-authjs-port-8443.session-token' },
  { label: 'production https, portless', env: { NODE_ENV: 'production', NEXTAUTH_URL: 'https://psa.example.com', PORT: '3000' }, expected: '__Secure-authjs.session-token' },
];

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'PORT', 'APP_PORT', 'EXPOSE_SERVER_PORT']) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as any)[key];
    else (process.env as any)[key] = value;
  }
}

beforeEach(() => {
  vi.resetModules();
  capturedConfigs.length = 0;
  process.env.NEXTAUTH_SECRET = 'test-secret';
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

describe.each(ENVIRONMENTS)('edge Auth.js instance: $label', ({ env, expected }) => {
  it('reads the session cookie the shared function names', async () => {
    applyEnv(env);
    const { getSessionCookieName } = await import('./sessionCookies');
    const { auth } = await import('@alga-psa/auth/nextauth/edge-auth');

    auth();

    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0].cookies?.sessionToken?.name).toBe(expected);
    expect(capturedConfigs[0].cookies?.sessionToken?.name).toBe(getSessionCookieName());
  });
});

describe('edge middleware', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const middlewareSource = fs.readFileSync(path.join(repoRoot, 'server/src/middleware.ts'), 'utf8');
  const edgeAuthSource = fs.readFileSync(path.join(repoRoot, 'packages/auth/src/nextauth/edge-auth.ts'), 'utf8');
  // Any string literal that spells an Auth.js / next-auth cookie name.
  const COOKIE_NAME_LITERAL = /(['"`])[^'"`\n]*(?:authjs|next-auth)[.-][^'"`\n]*\1/;

  it('takes the session cookie name from the shared function and the edge instance', () => {
    expect(middlewareSource).toContain("import { getSessionCookieName } from './lib/auth/sessionCookies';");
    expect(middlewareSource).toContain("import { auth } from './app/api/auth/[...nextauth]/edge-auth';");
    expect(middlewareSource).toMatch(/const sessionCookieName = getSessionCookieName\(\);/);
  });

  it('spells no cookie name of its own', () => {
    expect(middlewareSource).not.toMatch(COOKIE_NAME_LITERAL);
    expect(edgeAuthSource).not.toMatch(COOKIE_NAME_LITERAL);
  });

  it('routes the server edge-auth module to the package instance', () => {
    const serverEdgeAuth = fs.readFileSync(
      path.join(repoRoot, 'server/src/app/api/auth/[...nextauth]/edge-auth.ts'),
      'utf8',
    );
    expect(serverEdgeAuth.trim()).toBe("export { auth } from '@alga-psa/auth/nextauth/edge-auth';");
  });
});
