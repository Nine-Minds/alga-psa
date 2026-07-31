import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'reconcileBucketUsageHandler.ts'), 'utf8');

describe('reconcile bucket usage handler tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bucket usage roots', () => {
    expect(source).toContain('tenantDb(knex, tenantId)');
    expect(source).toContain(".table('bucket_usage')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain(".where('tenant', tenantId)");
    expect(source).not.toContain('.where({ tenant: tenantId');
  });
});
