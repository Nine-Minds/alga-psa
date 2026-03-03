import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8');
}

describe('Client portal auth contract', () => {
  it('T045: client portal auth does not wire MSP discovery/resolve endpoints', () => {
    const clientLoginSource = read('packages/auth/src/components/ClientLoginForm.tsx');
    const clientPortalRouteSource = read('server/src/app/auth/client-portal/signin/page.tsx');

    expect(clientLoginSource).not.toContain('/api/auth/msp/sso/discover');
    expect(clientLoginSource).not.toContain('/api/auth/msp/sso/resolve');
    expect(clientPortalRouteSource).not.toContain('/api/auth/msp/sso/discover');
    expect(clientPortalRouteSource).not.toContain('/api/auth/msp/sso/resolve');
  });
});
