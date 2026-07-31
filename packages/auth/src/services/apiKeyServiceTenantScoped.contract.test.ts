import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, 'apiKeyService.ts');
const source = readFileSync(servicePath, 'utf8');

describe('api key service tenant-scoped query contract', () => {
  it('routes api key reads and mutations through the tenant-scoped helper', () => {
    expect(source).toContain('private static apiKeysQuery');
    expect(source).toContain("tenantDb(knex, tenant).table<ApiKey>('api_keys')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("const [record] = await this.apiKeysQuery(knex, tenant).insert(insertPayload).returning('*')");

    expect(source.match(/knex\('api_keys'\)/g)).toBeNull();
    expect(source).not.toMatch(/knex\('api_keys'\)\s*\.(?:where|select|join|orderBy|update|del|increment)/);
    expect(source).not.toMatch(/\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\.where\('api_keys\.tenant', tenant\)/);
  });
});
