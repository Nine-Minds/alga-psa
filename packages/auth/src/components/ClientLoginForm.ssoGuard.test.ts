import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(fileName: string): string {
  return fs.readFileSync(path.join(here, fileName), 'utf8');
}

describe('Client portal login SSO behavior contract', () => {
  it('T007: keeps SSO hidden until client-portal tenant context is available', () => {
    const source = read('ClientLoginForm.tsx');
    expect(source).toContain('{(tenantSlug || portalDomain) ? (');
    expect(source).toContain('<SsoProviderButtons');
  });

  it('T007: wires client portal discovery/resolution context into SSO provider buttons', () => {
    const source = read('ClientLoginForm.tsx');
    expect(source).toContain('callbackUrl={callbackUrl}');
    expect(source).toContain('tenantHint={tenantSlug}');
    expect(source).toContain('portalDomainHint={portalDomain}');
    expect(source).toContain('authSurface="client_portal"');
  });
});
