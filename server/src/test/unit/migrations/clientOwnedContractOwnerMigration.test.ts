import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('client-owned contract owner migration', () => {
  it('T001: adds contracts.owner_client_id without rewriting template ownership semantics', () => {
    const migration = readRepoFile(
      'server/migrations/20260316120000_add_contract_owner_client_id.cjs'
    );

    expect(migration).toContain("table.uuid('owner_client_id').nullable()");
    expect(migration).toContain('FOREIGN KEY (tenant, owner_client_id)');
    expect(migration).toContain('REFERENCES clients(tenant, client_id)');
    expect(migration).not.toContain('UPDATE contracts');
    expect(migration).not.toContain('is_template = true');
  });
});
