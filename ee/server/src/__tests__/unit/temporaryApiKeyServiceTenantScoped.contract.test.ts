import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../services/temporaryApiKeyService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('temporary API key service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-specific api key reads and updates', () => {
    const tenantScopedSection = sectionBetween('static async issueForAiSession', 'static async cleanupExpiredAiKeys');

    expect(source).toContain("import { tenantDb, withAdminTransaction } from '@alga-psa/db';");
    expect(tenantScopedSection).toContain('const db = tenantDb(knex, tenant);');
    expect(tenantScopedSection).toContain("db.table('api_keys')");
    expect(tenantScopedSection).not.toContain('createTenantScopedQuery');

    expect(tenantScopedSection).not.toMatch(/knex\('api_keys'\)\s*\./);
    expect(tenantScopedSection).not.toMatch(/\.where\(\{\s*tenant: tenantId/);
    expect(tenantScopedSection).not.toMatch(/api_key_id: apiKeyId,\s*tenant: tenantId/);
  });

  it('keeps the expired-key cleanup visibly admin-wide', () => {
    const cleanupSection = sectionBetween('static async cleanupExpiredAiKeys', '\n}\n');

    expect(cleanupSection).toContain('withAdminTransaction');
    expect(cleanupSection).toContain("trx('api_keys')");
    expect(cleanupSection).toContain('Intentional admin-wide sweep');
  });
});
