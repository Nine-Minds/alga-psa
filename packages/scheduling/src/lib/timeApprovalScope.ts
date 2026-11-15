import { commercialTimeEntrySql } from '@alga-psa/types';

/**
 * What an approver's surfaces may see of a time sheet (S28 / F068).
 *
 * Operational (seat-technician) time is never submitted and never approved, so it is not the approver's to
 * see or to move. Two shapes, both built on the shared `commercialTimeEntrySql` predicate:
 *
 * - `commercialEntriesOnly`: entry reads and approval writes on a sheet cover its commercial entries only.
 * - `excludeOperationalOnlyTimeSheets`: the approval queue lists a sheet unless every entry on it is operational.
 *   (A sheet that holds both kinds still lists, showing its commercial entries; an empty sheet lists as it always did.)
 *
 * Not flag-gated: this is a data-correctness guard. Without seat technicians nothing is operational and
 * both are no-ops.
 */
export const commercialEntriesOnly = <Q extends { whereRaw(sql: string): Q }>(query: Q, alias = 'time_entries'): Q =>
  query.whereRaw(commercialTimeEntrySql(alias));

export const excludeOperationalOnlyTimeSheets = <Q extends { whereRaw(sql: string): Q }>(query: Q, sheetAlias = 'time_sheets'): Q =>
  query.whereRaw(
    `NOT (EXISTS (SELECT 1 FROM time_entries op_te WHERE op_te.tenant = ${sheetAlias}.tenant AND op_te.time_sheet_id = ${sheetAlias}.id AND NOT (${commercialTimeEntrySql('op_te')}))
      AND NOT EXISTS (SELECT 1 FROM time_entries co_te WHERE co_te.tenant = ${sheetAlias}.tenant AND co_te.time_sheet_id = ${sheetAlias}.id AND ${commercialTimeEntrySql('co_te')}))`,
  );
