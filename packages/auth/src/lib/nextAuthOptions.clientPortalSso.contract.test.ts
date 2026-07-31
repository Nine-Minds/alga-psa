import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'nextAuthOptions.ts'), 'utf8');

describe('NextAuth client portal SSO contract', () => {
  it('T006: OAuth client sign-in can derive callback_url from state and compute vanity handoff redirect', () => {
    expect(source).toContain("const callbackUrl = parseStateValue(rawState, 'callback_url');");
    expect(source).toContain("providerId && providerId !== 'credentials' && extendedUser?.user_type === 'client'");
    expect(source).toContain("console.warn('[signIn] failed to compute OAuth client portal redirect'");
    expect(source).toContain('const vanityRedirect = await computeVanityRedirect({');
  });

  it('T006/F021: client portal SSO discovery and resolution cookies are cleared after OAuth completion handling', () => {
    expect(source).toContain('async function clearClientPortalSsoStateCookies(): Promise<void>');
    expect(source).toContain('store.delete(CLIENT_PORTAL_SSO_DISCOVERY_COOKIE);');
    expect(source).toContain('store.delete(CLIENT_PORTAL_SSO_RESOLUTION_COOKIE);');
    expect(source).toContain('await clearClientPortalSsoStateCookies();');
  });
});
