import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8');
}

describe('MSP SSO CE/EE parity contract', () => {
  it('T048/T058: uses discovery + resolver endpoints in both CE and EE provider button implementations', () => {
    const ceSource = read('packages/auth/src/components/SsoProviderButtons.tsx');
    const eeSource = read('ee/server/src/components/auth/SsoProviderButtons.tsx');

    for (const source of [ceSource, eeSource]) {
      expect(source).toContain('/api/auth/msp/sso/discover');
      expect(source).toContain('/api/auth/msp/sso/resolve');
      expect(source).toContain('msp_sso_last_provider');
    }
  });
});
