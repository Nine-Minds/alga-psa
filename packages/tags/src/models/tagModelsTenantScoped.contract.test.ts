import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const tagDefinitionSource = readFileSync(resolve(__dirname, 'tagDefinition.ts'), 'utf8');
const tagMappingSource = readFileSync(resolve(__dirname, 'tagMapping.ts'), 'utf8');

describe('tag model tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tag definition roots', () => {
    expect(tagDefinitionSource).toContain("tenantDb(knexOrTrx, tenant).table('tag_definitions')");
    expect(tagDefinitionSource).toContain("tenantDb(knexOrTrx, tenant).table('tag_mappings')");
    expect(tagDefinitionSource).toContain('tagDefinitionsQuery(knexOrTrx, tenant)');
    expect(tagDefinitionSource).toContain('tagMappingsQuery(knexOrTrx, tenant)');

    expect(tagDefinitionSource).not.toContain('createTenantScopedQuery');
    expect(tagDefinitionSource).not.toContain(".where('tenant', tenant)");
    expect(tagDefinitionSource).not.toContain(".where('tag_mappings.tenant', tenant)");
  });

  it('uses structural tenant scoping for tag mapping roots and aliases', () => {
    expect(tagMappingSource).toContain("tenantDb(knexOrTrx, tenant).table('tag_mappings')");
    expect(tagMappingSource).toContain("tenantDb(knexOrTrx, tenant).table('tag_mappings as tm')");
    expect(tagMappingSource).toContain('tagMappingsQuery(knexOrTrx, tenant)');
    expect(tagMappingSource).toContain('aliasedTagMappingsQuery(knexOrTrx, tenant)');

    expect(tagMappingSource).not.toContain('createTenantScopedQuery');
    expect(tagMappingSource).not.toContain(".where('tenant', tenant)");
    expect(tagMappingSource).not.toContain(".where('tm.tenant', tenant)");
  });
});
