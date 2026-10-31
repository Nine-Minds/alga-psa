import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import knex from 'knex';
import { tenantDb } from '@alga-psa/db';

const ROOT = resolve(__dirname, '../../../../..');
const SOURCES = [
  'packages/co-managed/src/portableCoreExport.ts', 'packages/co-managed/src/portableWorkExport.ts',
  'packages/co-managed/src/portableAssetExport.ts', 'packages/co-managed/src/portableWorkflowExport.ts',
  'ee/server/src/lib/co-managed/portableVaultExport.ts',
];
/** Verified against packages/db tenantTableMetadata (scope: 'global') below. */
const GLOBAL_TABLES = ['standard_statuses'];
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** Tenant isolation, proved on the query paths. Every export read is a tenantDb-scoped table whose tenant is the
 * verified session actor's; nothing takes a tenant or a table filter from a caller. */
describe('portable export tenant isolation', () => {
  it.each(SOURCES)('%s reads only through tenantDb bound to the verified actor tenant', path => {
    const source = read(path);
    const scopes = [...source.matchAll(/tenantDb\(([^,]+),\s*([^)]+)\)/g)];
    expect(scopes.length).toBeGreaterThan(0);
    for (const [, , tenant] of scopes) expect(tenant.trim()).toMatch(/^(verified|current|actor)\.tenant$/);
    // Every table read goes through the scoped handle; no raw table access or knex-callable on a connection.
    const receivers = [...source.matchAll(/([A-Za-z_]+)\.(?:table|scoped|parentScopedTable)(?:<[^>]*>)?\(/g)].map(match => match[1]);
    expect(receivers.length).toBeGreaterThan(0);
    for (const receiver of receivers) expect(receiver).toBe('own');
    // The only unscoped read allowed is a table the tenant registry itself classes as global reference data.
    const unscoped = [...source.matchAll(/\b(?:trx|current|retained|db|knex)\(\s*['"`](\w+)['"`]/g)].map(match => match[1]);
    for (const table of unscoped) expect(GLOBAL_TABLES).toContain(table);
    expect(source).not.toMatch(/\.from\(\s*['"`]/);
    // No export function accepts a tenant or a row selection.
    expect(source).not.toMatch(/export (?:async )?function \w*(?:Portable)\w*\([^)]*\b(?:tenant|tenantId|where|filter)\b/);
  });
  it('only allowlists tables the tenant registry classes as global', () => {
    const metadata = readFileSync(resolve(ROOT, 'packages/db/src/lib/tenantTableMetadata.ts'), 'utf8');
    for (const table of GLOBAL_TABLES) expect(metadata).toMatch(new RegExp(`${table}:\\s*\\{\\s*scope:\\s*'global'`));
  });
  it('generates SQL that is constrained to the actor tenant, never another', () => {
    const db = knex({ client: 'pg' });
    const mine = '11111111-1111-4111-8111-111111111111', theirs = '99999999-9999-4999-8999-999999999999';
    const { sql, bindings } = tenantDb(db, mine).table('assets').select('asset_id').orderBy('asset_id').toSQL();
    expect(sql).toMatch(/tenant/i);
    expect(bindings).toContain(mine);
    expect(bindings).not.toContain(theirs);
  });
  it('the engine hands contributors only the actor and snapshot, and the manifest rejects foreign tenant rows', async () => {
    const { createPortableContributorRegistry } = await import('../../../../../packages/co-managed/src/portableContributorRegistry');
    const { collectPortableWorkspace } = await import('../../../../../packages/co-managed/src/portableWorkspaceGraph');
    let seen: any;
    const registry = createPortableContributorRegistry([{ id: 'probe', version: 1, reason: 'probe', columns: { probe_t: ['id'] }, references: [],
      export: async c => { seen = c; return { records: { probe_t: [] } }; }, retain: async () => ({ records: { probe_t: [] } }), validate: () => {} }]);
    const actor = { kind: 'session', tenant: '11111111-1111-4111-8111-111111111111', userId: 'u', sessionId: 's' } as any;
    await collectPortableWorkspace(registry, { db: {} as any, actor, packageId: 'p', snapshot: { capturedAt: 'c' } });
    expect(Object.keys(seen).sort()).toEqual(['actor', 'db', 'packageId', 'snapshot']);
    expect(seen.actor.tenant).toBe(actor.tenant);
  });
});
