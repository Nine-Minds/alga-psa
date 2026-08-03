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

  it('T006b: OAuth client sign-in computes vanity redirect even when state lacks callback_url', () => {
    // Auth.js drops the OAuth state from the account object, so the branch must
    // not depend on a state-smuggled callback_url to reach computeVanityRedirect.
    expect(source).toContain("const callbackUrl = metadata.callbackUrl ?? '/client-portal/dashboard';");
  });

  it('T006/F021: client portal SSO discovery and resolution cookies are cleared after OAuth completion handling', () => {
    expect(source).toContain('async function clearClientPortalSsoStateCookies(): Promise<void>');
    expect(source).toContain('store.delete(CLIENT_PORTAL_SSO_DISCOVERY_COOKIE);');
    expect(source).toContain('store.delete(CLIENT_PORTAL_SSO_RESOLUTION_COOKIE);');
    expect(source).toContain('await clearClientPortalSsoStateCookies();');
  });
});
