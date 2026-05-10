import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(relativeFile: string): string {
  return fs.readFileSync(path.join(here, relativeFile), 'utf8');
}

describe('MSP SSO regression contract', () => {
  it('T009/F023: MSP SSO defaults remain unchanged when authSurface is msp', () => {
    const source = read('SsoProviderButtons.tsx');

    expect(source).toContain("authSurface?: 'msp' | 'client_portal';");
    expect(source).toContain("const effectiveDiscoveryEndpoint = discoveryEndpoint ?? (authSurface === 'client_portal' ? '/api/auth/client-portal/sso/discover' : '/api/auth/msp/sso/discover');");
    expect(source).toContain("const effectiveResolveEndpoint = resolveEndpoint ?? (authSurface === 'client_portal' ? '/api/auth/client-portal/sso/resolve' : '/api/auth/msp/sso/resolve');");
    expect(source).toContain("const effectiveStorageKey = storageKey ?? (authSurface === 'client_portal' ? 'client_portal_sso_last_provider' : LAST_PROVIDER_STORAGE_KEY);");
    expect(source).toContain("user_type: authSurface === 'client_portal' ? 'client' : 'internal'");
  });
});
