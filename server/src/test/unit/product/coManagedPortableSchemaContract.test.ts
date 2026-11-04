import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from '../../../../../packages/co-managed/src/portableWorkCatalog';
import { PORTABLE_CATALOGS, PORTABLE_MIGRATION_TABLE_NAMES, PORTABLE_PHYSICAL_TABLES, catalogColumnsToCheck } from '../../helpers/coManagedPortableCatalogColumns';

/**
 * Every column a portable catalog projects must exist in the migrated main schema. A catalog column the schema lacks
 * makes the export fail at runtime with Postgres 42703, so the contract is checked here without a server.
 *
 * Derivation is from the migrations (no database): a column is "provided" when a migration that names the table
 * (as a whole word) also names the column as a whole word. This is deliberately a coarse over-approximation, so it
 * can miss a column that only some other table in the same file has; the exact information_schema check runs against
 * a migrated database in integration/coManagedPortableSchemaContract.integration.test.ts.
 */
const ROOT = resolve(__dirname, '../../../../..');

function migrationSources() {
  return ['server/migrations', 'ee/server/migrations'].flatMap(dir => {
    try { return readdirSync(join(ROOT, dir)).filter(f => /\.(cjs|js|ts)$/.test(f)).map(f => readFileSync(join(ROOT, dir, f), 'utf8')); }
    catch { return []; }
  });
}
const word = (name: string) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);

describe('portable catalogs against the main schema', () => {
  it('only maps handoff_history to a physical table, external_files to its migration name, and computes the workflow *_name fields', () => {
    expect(PORTABLE_PHYSICAL_TABLES).toEqual({ handoff_history: 'co_management_ticket_handoffs' });
    expect(PORTABLE_MIGRATION_TABLE_NAMES).toEqual({ external_files: 'file_stores' });
    const checked = catalogColumnsToCheck().length;
    const all = Object.values(PORTABLE_CATALOGS).flatMap(t => Object.values(t)).reduce((n, c) => n + c.length, 0);
    expect(all - checked).toBe(3); // created_by_name, completed_by_name, user_name
  });

  it('every catalog column is provided by a main migration', () => {
    const sources = migrationSources();
    expect(sources.length).toBeGreaterThan(100);
    const missing = catalogColumnsToCheck().filter(({ migrationName, column }) =>
      !sources.some(source => word(migrationName).test(source) && word(column).test(source))).map(m => `${m.catalog}.${m.table}.${m.column}`);
    expect(missing).toEqual([]);
  });

  it('checks the live schema under current table names, not the names migrations first created them under', () => {
    const files = catalogColumnsToCheck().filter(c => c.table === 'external_files');
    expect(files.length).toBeGreaterThan(0);
    for (const c of files) expect(c).toMatchObject({ physical: 'external_files', migrationName: 'file_stores' });
  });

  it('does not project the collaboration actor columns main never added to project task comments', () => {
    for (const column of ['actor_reference_id', 'actor_display_name', 'actor_organization_name', 'collaboration_revision'])
      expect(CO_MANAGED_PORTABLE_WORK_COLUMNS.project_task_comments).not.toContain(column);
  });
});
