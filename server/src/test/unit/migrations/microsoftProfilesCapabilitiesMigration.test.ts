import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('microsoft profiles capabilities migration', () => {
  const migration = readRepoFile('server/migrations/20260708110000_add_microsoft_profiles_capabilities.cjs');

  it('adds profile capabilities as a jsonb consumer array with an all-capabilities default', () => {
    expect(migration).toContain("hasColumn('microsoft_profiles', 'capabilities')");
    expect(migration).toContain("jsonb('capabilities')");
    expect(migration).toContain('notNullable()');
    expect(migration).toContain('["msp_sso","email","calendar","teams"]');
    expect(migration).toContain("'${DEFAULT_MICROSOFT_PROFILE_CAPABILITIES}'::jsonb");
  });

  it('backfills existing profiles to all capabilities and drops the column on rollback', () => {
    expect(migration).toContain('UPDATE microsoft_profiles');
    expect(migration).toContain('SET capabilities = ?::jsonb');
    expect(migration).toContain("dropColumn('capabilities')");
    expect(migration).toContain('exports.config = { transaction: false }');
  });
});
