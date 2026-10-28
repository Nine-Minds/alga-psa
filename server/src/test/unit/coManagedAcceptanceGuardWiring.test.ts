import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('awaiting-acceptance guard wiring', () => {
  it('withAuth enforces the lazy awaiting-acceptance check', () => {
    const src = read('packages/auth/src/lib/withAuth.ts');
    expect(src).toContain('isCoManagedAwaitingAcceptanceLazily');
    expect(src).toContain('allowBeforeCoManagedAcceptance');
  });

  it('authenticateApiKeyRequest enforces the same lazy check and maps it to CO_MANAGED_NOT_ACTIVE', () => {
    const src = read('server/src/lib/api/middleware/apiAuthMiddleware.ts');
    expect(src).toContain('isCoManagedAwaitingAcceptanceLazily');
    expect(read('server/src/lib/api/middleware/apiMiddleware.ts')).toContain('CO_MANAGED_NOT_ACTIVE');
  });
});
