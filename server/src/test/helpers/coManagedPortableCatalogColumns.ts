import { CO_MANAGED_PORTABLE_CORE_COLUMNS } from '../../../../packages/co-managed/src/portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from '../../../../packages/co-managed/src/portableWorkCatalog';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS } from '../../../../packages/co-managed/src/portableAssetCatalog';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS } from '../../../../packages/co-managed/src/portableWorkflowCatalog';
import { CO_MANAGED_PORTABLE_FILE_COLUMNS } from '../../../../packages/co-managed/src/portableFileExport';

/** Columns each portable catalog projects, resolved to the physical main-schema table that must provide them. */
export const PORTABLE_CATALOGS = { core: CO_MANAGED_PORTABLE_CORE_COLUMNS, work: CO_MANAGED_PORTABLE_WORK_COLUMNS,
  assets: CO_MANAGED_PORTABLE_ASSET_COLUMNS, workflows: CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS, files: CO_MANAGED_PORTABLE_FILE_COLUMNS } as Record<string, Record<string, readonly string[]>>;

/** Catalog names whose migrations name another table: handoff_history is a view of handoffs; external_files was created as file_stores and renamed. */
export const PORTABLE_MAPPED_TABLES: Record<string, string> = { handoff_history: 'co_management_ticket_handoffs', external_files: 'file_stores' };

/** Catalog names the export reads from another live relation (portableWorkExport reads handoff_history from the handoffs table). */
export const PORTABLE_QUERIED_TABLES: Record<string, string> = { handoff_history: 'co_management_ticket_handoffs' };

/** Computed in the export query by joining users, not selected from the table. */
const isComputed = (table: string, column: string) =>
  (table === 'workflow_tasks' || table === 'workflow_task_history') && column.endsWith('_name');

export type CatalogColumn = { catalog: string; table: string; physical: string; queried: string; column: string };

/** `physical` is the table name the migrations created; `queried` is the live relation the export selects from. */
export function catalogColumnsToCheck(): CatalogColumn[] {
  const out: CatalogColumn[] = [];
  for (const [catalog, tables] of Object.entries(PORTABLE_CATALOGS)) for (const [table, columns] of Object.entries(tables)) {
    for (const column of columns) if (!isComputed(table, column)) out.push({ catalog, table, physical: PORTABLE_MAPPED_TABLES[table] ?? table,
      queried: PORTABLE_QUERIED_TABLES[table] ?? table, column });
  }
  return out;
}
