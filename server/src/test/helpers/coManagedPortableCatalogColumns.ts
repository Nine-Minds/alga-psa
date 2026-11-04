import { CO_MANAGED_PORTABLE_CORE_COLUMNS } from '../../../../packages/co-managed/src/portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from '../../../../packages/co-managed/src/portableWorkCatalog';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS } from '../../../../packages/co-managed/src/portableAssetCatalog';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS } from '../../../../packages/co-managed/src/portableWorkflowCatalog';
import { CO_MANAGED_PORTABLE_FILE_COLUMNS } from '../../../../packages/co-managed/src/portableFileExport';

/** Every portable catalog, keyed by catalog name, then catalog table, to the columns it projects. */
export const PORTABLE_CATALOGS = { core: CO_MANAGED_PORTABLE_CORE_COLUMNS, work: CO_MANAGED_PORTABLE_WORK_COLUMNS,
  assets: CO_MANAGED_PORTABLE_ASSET_COLUMNS, workflows: CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS, files: CO_MANAGED_PORTABLE_FILE_COLUMNS } as Record<string, Record<string, readonly string[]>>;

/** Catalog names that are not physical tables: handoff_history is a view of co_management_ticket_handoffs. */
export const PORTABLE_PHYSICAL_TABLES: Record<string, string> = { handoff_history: 'co_management_ticket_handoffs' };

/**
 * Names under which a physical table's columns were introduced by migrations, when that differs from its current name:
 * external_files was created as file_stores (its columns are named there) and renamed by 20241224010921.
 * Only the migration-text check uses this; the live schema has the current name.
 */
export const PORTABLE_MIGRATION_TABLE_NAMES: Record<string, string> = { external_files: 'file_stores' };

/** Computed in the export query by joining users, not selected from the table. */
const isComputed = (table: string, column: string) =>
  (table === 'workflow_tasks' || table === 'workflow_task_history') && column.endsWith('_name');

/** The (physical table, column) pairs a migrated main schema must provide for the portable export to run. */
export function catalogColumnsToCheck() {
  const out: { catalog: string; table: string; physical: string; migrationName: string; column: string }[] = [];
  for (const [catalog, tables] of Object.entries(PORTABLE_CATALOGS)) for (const [table, columns] of Object.entries(tables)) {
    const physical = PORTABLE_PHYSICAL_TABLES[table] ?? table;
    const migrationName = PORTABLE_MIGRATION_TABLE_NAMES[physical] ?? physical;
    for (const column of columns) if (!isComputed(table, column)) out.push({ catalog, table, physical, migrationName, column });
  }
  return out;
}
