import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(fileName: string): string {
  return fs.readFileSync(path.join(here, fileName), 'utf8');
}

describe('Client portal login SSO guard', () => {
  it('T047: client portal login remains unchanged with SSO section disabled/commented', () => {
    const source = read('ClientLoginForm.tsx');

    expect(source).toContain('SSO not supported for client portal');
    expect(source).toContain('<SsoProviderButtons');
    expect(source).toContain('/* SSO not supported for client portal');
  });

  it('T047: client portal flow keeps SSO affordances disabled in end-to-end contract', () => {
    const source = read('ClientLoginForm.tsx');

    expect(source).toContain('SSO not supported for client portal');
    expect(source).toContain('callbackUrl={callbackUrl}');
    expect(source).toContain('tenantHint={tenantSlug}');
  });
});
