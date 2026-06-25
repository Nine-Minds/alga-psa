import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cleanupSource = readFileSync(resolve(__dirname, 'lib/tagCleanup.ts'), 'utf8');
const inboundSource = readFileSync(resolve(__dirname, 'actions/inboundActions.ts'), 'utf8');

describe('tag support tenant-scoped query contract', () => {
  it('uses structural tenant scoping for cleanup tag-mapping roots', () => {
    expect(cleanupSource).toContain("tenantDb(trx, tenant).table('tag_mappings')");
    expect(cleanupSource).toContain('tagMappingsQuery(trx, tenant)');

    expect(cleanupSource).not.toContain('createTenantScopedQuery');
    expect(cleanupSource).not.toContain("trx('tag_mappings')");
    expect(cleanupSource).not.toContain('.where({ tenant');
  });

  it('uses structural tenant scoping for inbound validation and mapping roots', () => {
    expect(inboundSource).toContain('tenantDb(trx, ctx.tenant)');
    expect(inboundSource).toContain(".table('tag_mappings')");
    expect(inboundSource).toContain(".table('users')");
    expect(inboundSource).toContain('.table(table.table)');

    expect(inboundSource).not.toContain('createTenantScopedQuery');
    expect(inboundSource).not.toContain("const existingMapping = await trx('tag_mappings')");
    expect(inboundSource).not.toContain("trx('users')");
    expect(inboundSource).not.toContain('.where({ tenant');
  });
});
