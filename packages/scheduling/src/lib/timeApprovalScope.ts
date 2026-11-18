import type { Knex } from 'knex';
import type { ClientReadScope } from '@alga-psa/authorization/clientReadScope';
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

/** The alias the operational probe names `time_entries` by; resolve the approver's read scope with it. */
export const OPERATIONAL_PROBE_ALIAS = 'op_te';

/**
 * Keep a sheet in the queue unless it holds operational entries and no commercial ones.
 *
 * The operational probe reads `time_entries`, so it is narrowed by the approver's own time-entry read scope
 * (resolved with `OPERATIONAL_PROBE_ALIAS`): a sheet is only hidden on operational entries the approver may read.
 * The commercial probe is deliberately NOT narrowed, so this filter can never hide a sheet that carries commercial
 * work; it only ever answers "is there any", and no entry data leaves either probe.
 */
export const excludeOperationalOnlyTimeSheets = (
  query: Knex.QueryBuilder,
  operationalProbeScope: ClientReadScope,
  sheetAlias = 'time_sheets',
): Knex.QueryBuilder =>
  query.where(function notOperationalOnly(this: Knex.QueryBuilder) {
    this.whereNotExists(function readableOperationalEntry(this: Knex.QueryBuilder) {
      this.select(1).from(`time_entries as ${OPERATIONAL_PROBE_ALIAS}`)
        .whereRaw(`${OPERATIONAL_PROBE_ALIAS}.tenant = ${sheetAlias}.tenant AND ${OPERATIONAL_PROBE_ALIAS}.time_sheet_id = ${sheetAlias}.id`)
        .whereRaw(`NOT (${commercialTimeEntrySql(OPERATIONAL_PROBE_ALIAS)})`);
      operationalProbeScope.apply(this);
    }).orWhereExists(function commercialEntry(this: Knex.QueryBuilder) {
      this.select(1).from('time_entries as co_te')
        .whereRaw(`co_te.tenant = ${sheetAlias}.tenant AND co_te.time_sheet_id = ${sheetAlias}.id`)
        .whereRaw(commercialTimeEntrySql('co_te'));
    });
  });
