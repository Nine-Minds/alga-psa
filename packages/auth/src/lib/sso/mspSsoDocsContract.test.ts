import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ssoDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(ssoDir, '../../../../..');

function read(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8');
}

describe('MSP SSO docs and comments contracts', () => {
  it('T060: resolver route includes explicit anti-enumeration guidance comments', () => {
    const routeSource = read(
      path.resolve(repoRoot, 'server/src/app/api/auth/msp/sso/resolve/route.ts')
    );

    expect(routeSource).toContain('Anti-enumeration rule: every failure path must return the exact same response shape/message.');
    expect(routeSource).toContain('Anti-enumeration rule: lookup outcomes only affect internal source selection, never external messaging.');
  });

  it('T053: .env.example documents unresolved-domain MSP fallback usage for GOOGLE_OAUTH_* and MICROSOFT_OAUTH_*', () => {
    const envExample = read(path.resolve(repoRoot, '.env.example'));

    expect(envExample).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(envExample).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(envExample).toContain('MICROSOFT_OAUTH_CLIENT_ID');
    expect(envExample).toContain('MICROSOFT_OAUTH_CLIENT_SECRET');
    expect(envExample).toContain('fallback for MSP SSO');
  });

  it('T052: integration docs describe Providers-first setup order including login-domain setup', () => {
    const doc = read(path.resolve(repoRoot, 'docs/integrations/provider-setup-order.md'));

    expect(doc).toContain('Configure provider credentials first');
    expect(doc).toContain('Configure MSP SSO login domains');
    expect(doc).toContain('Settings -> Integrations -> Providers');
    expect(doc).toContain('Google');
    expect(doc).toContain('Microsoft');
  });
});
