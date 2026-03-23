import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('billing method canonicalization migration', () => {
  const migration = readRepoFile('server/migrations/20251016120000_update_billing_method_to_text.cjs');

  it('T001: hard-normalizes legacy per_unit values to usage and asserts no residual rows remain', () => {
    expect(migration).toContain(".where('billing_method', 'per_unit')");
    expect(migration).toContain(".update({ billing_method: 'usage' })");
    expect(migration).toContain(".count('* as count')");
    expect(migration).toContain('residual per_unit rows remain');
  });
});
