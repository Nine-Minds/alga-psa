import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CO_MANAGED_PORTABLE_CORE_COLUMNS } from '../../../../../packages/co-managed/src/portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from '../../../../../packages/co-managed/src/portableWorkCatalog';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS } from '../../../../../packages/co-managed/src/portableAssetCatalog';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS } from '../../../../../packages/co-managed/src/portableWorkflowCatalog';
import { CO_MANAGED_PORTABLE_FILE_COLUMNS } from '../../../../../packages/co-managed/src/portableFileExport';

/**
 * Every column a portable catalog projects must exist in the migrated main schema. A catalog column the schema lacks
 * makes the export fail at runtime with Postgres 42703, so the contract is checked here without a server.
 *
 * Derivation is from the migrations (no database): a column is "provided" when a migration that names the table
 * (as a whole word) also names the column as a whole word. This is deliberately a coarse over-approximation, so it
 * can miss a column that only some other table in the same file has; the DB-backed test below is the exact check
 * and runs when PORTABLE_SCHEMA_DB=1 with the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE pointing at a migrated main database.
 */
const ROOT = resolve(__dirname, '../../../../..');
const CATALOGS = { core: CO_MANAGED_PORTABLE_CORE_COLUMNS, work: CO_MANAGED_PORTABLE_WORK_COLUMNS,
  assets: CO_MANAGED_PORTABLE_ASSET_COLUMNS, workflows: CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS, files: CO_MANAGED_PORTABLE_FILE_COLUMNS } as Record<string, Record<string, readonly string[]>>;

/** Catalog names whose migrations name another table: handoff_history is a view of handoffs; external_files was created as file_stores and renamed. */
const MAPPED_TABLES: Record<string, string> = { handoff_history: 'co_management_ticket_handoffs', external_files: 'file_stores' };
/** Computed in the export query by joining users, not selected from the table. */
const isComputed = (table: string, column: string) =>
  (table === 'workflow_tasks' || table === 'workflow_task_history') && column.endsWith('_name');

export function catalogColumnsToCheck() {
  const out: { catalog: string; table: string; physical: string; column: string }[] = [];
  for (const [catalog, tables] of Object.entries(CATALOGS)) for (const [table, columns] of Object.entries(tables)) {
    for (const column of columns) if (!isComputed(table, column)) out.push({ catalog, table, physical: MAPPED_TABLES[table] ?? table, column });
  }
  return out;
}

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

describe.skipIf(process.env.PORTABLE_SCHEMA_DB !== '1')('portable catalogs against a migrated database (information_schema)', () => {
  it('every catalog column exists', async () => {
    const { Client } = await import('pg');
    const client = new Client();
    await client.connect();
    try {
      const rows = (await client.query("select table_name, column_name from information_schema.columns where table_schema = 'public'")).rows as { table_name: string; column_name: string }[];
      const have = new Set(rows.map(r => `${r.table_name}.${r.column_name}`));
      const missing = catalogColumnsToCheck().filter(c => !have.has(`${c.physical}.${c.column}`)).map(c => `${c.catalog}.${c.table}.${c.column}`);
      expect(missing).toEqual([]);
    } finally { await client.end(); }
  });
});
