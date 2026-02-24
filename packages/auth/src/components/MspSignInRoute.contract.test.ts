import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8');
}

describe('MSP sign-in route and callback contracts', () => {
  it('T054: preserves the /auth/msp/signin route contract', () => {
    const pageSource = read('server/src/app/auth/msp/signin/page.tsx');
    const clientPortalSource = read('packages/auth/src/components/ClientPortalSignIn.tsx');

    expect(pageSource).toContain('targetPortalSigninUrl="/auth/msp/signin"');
    expect(clientPortalSource).toContain('href="/auth/msp/signin"');
  });

  it('T055: keeps callbackUrl passthrough/default behavior for MSP sign-in', () => {
    const pageSource = read('server/src/app/auth/msp/signin/page.tsx');
    const mspSource = read('packages/auth/src/components/MspSignIn.tsx');

    expect(pageSource).toContain("const callbackUrl = typeof params?.callbackUrl === 'string' ? params.callbackUrl : '/msp/dashboard';");
    expect(mspSource).toContain("const callbackUrl = searchParams?.get('callbackUrl') || '/msp/dashboard';");
    expect(mspSource).toContain('callbackUrl={callbackUrl}');
  });
});
