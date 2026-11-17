import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// F012 (alga-2026-0002996): one session-minting function serves the NextAuth jwt sign-in path
// and the custom-domain exchange. Behavioural parity is asserted in
// server/src/app/api/auth/domain-session/route.parity.test.ts; this pins the wiring so a
// future edit cannot quietly fork the claim list again.

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('session minting wiring', () => {
  it('mints the jwt-callback sign-in token with mintSessionToken, not an inline claim list', () => {
    const source = read('./nextAuthOptions.ts');
    expect(source).toContain('await mintSessionToken({ token, user: extendedUser })');
    // The identity / plan claims live in the shared function only.
    expect(source).not.toMatch(/token\.proToken\s*=/);
    expect(source).not.toMatch(/token\.product_code\s*=/);
    expect(source).not.toMatch(/UserSession\.create\(/);
  });

  it('mints the exchanged session with the same function for every surface', () => {
    const route = read('../../../../server/src/app/api/auth/domain-session/route.ts');
    expect(route).toContain('mintSessionToken(');
    expect(route).toContain('loadSessionUser(');
    expect(route).not.toContain('userSnapshot');
    expect(route).not.toMatch(/UserSession\.create\(/);
  });

  it('keeps the legacy client-portal exchange and handoff paths as re-exports of the neutral ones', () => {
    expect(read('../../../../server/src/app/api/client-portal/domain-session/route.ts'))
      .toContain("from '../../auth/domain-session/route'");
    expect(read('../../../../server/src/app/auth/client-portal/handoff/page.tsx'))
      .toContain("from '../../handoff/page'");
  });

  it('no longer stores a user snapshot on the OTT', () => {
    expect(read('./PortalDomainSessionToken.ts')).not.toContain('userSnapshot');
  });
});
