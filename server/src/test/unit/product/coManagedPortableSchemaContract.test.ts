import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from '../../../../../packages/co-managed/src/portableWorkCatalog';
import { PORTABLE_CATALOGS as CATALOGS, PORTABLE_MAPPED_TABLES as MAPPED_TABLES, catalogColumnsToCheck } from '../../helpers/coManagedPortableCatalogColumns';

/**
 * Every column a portable catalog projects must exist in the migrated main schema. A catalog column the schema lacks
 * makes the export fail at runtime with Postgres 42703, so the contract is checked here without a server.
 *
 * Derivation is from the migrations (no database): a column is "provided" when a migration that names the table
 * (as a whole word) also names the column as a whole word. This is deliberately a coarse over-approximation, so it
 * can miss a column that only some other table in the same file has; the exact check against a migrated database's
 * information_schema is a case of the portable-domains integration runner (coManagedPortableSchema.cases.ts).
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
  it('only maps handoff_history and external_files and computes the workflow *_name fields', () => {
    expect(Object.keys(MAPPED_TABLES)).toEqual(['handoff_history', 'external_files']);
    const checked = catalogColumnsToCheck().length;
    const all = Object.values(CATALOGS).flatMap(t => Object.values(t)).reduce((n, c) => n + c.length, 0);
    expect(all - checked).toBe(3); // created_by_name, completed_by_name, user_name
  });

  it('every catalog column is provided by a main migration', () => {
    const sources = migrationSources();
    expect(sources.length).toBeGreaterThan(100);
    const missing = catalogColumnsToCheck().filter(({ physical, column }) =>
      !sources.some(source => word(physical).test(source) && word(column).test(source))).map(m => `${m.catalog}.${m.table}.${m.column}`);
    expect(missing).toEqual([]);
  });

  it('does not project the collaboration actor columns main never added to project task comments', () => {
    for (const column of ['actor_reference_id', 'actor_display_name', 'actor_organization_name', 'collaboration_revision'])
      expect(CO_MANAGED_PORTABLE_WORK_COLUMNS.project_task_comments).not.toContain(column);
  });
});
