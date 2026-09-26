import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Every export of a 'use server' module is a callable endpoint; secret values must stay server-side.
describe('tenant secret server actions', () => {
  it('never resolve a plaintext secret value', () => {
    const source = readFileSync(resolve(__dirname, 'tenant-secret-actions.ts'), 'utf8');
    expect(source).not.toContain('resolveSecretForRuntime');
    expect(source).not.toMatch(/\.getValue\(/);
    expect(source).not.toMatch(/\.getTenantSecret\(/);
  });
});
