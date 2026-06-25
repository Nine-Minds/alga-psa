import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userClientActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('user client actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the users client-info root', () => {
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'users as u'");
    expect(source).toContain("alias: 'u'");

    expect(source).not.toMatch(/trx\('users as u'\)\s*\./);
    expect(source).not.toMatch(/\.where\('u\.tenant', tenant\)/);
  });
});
