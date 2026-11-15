import { isCommercialTimeEntry } from '@alga-psa/types';

/**
 * For hand-rolled knex fakes that hold rows in memory: the row filter the shared commercial-read predicate
 * (`commercialTimeEntrySql(alias)`, S28 / F068) stands for, or null when `sql` is some other raw clause.
 * Applying it keeps a fake honest: an operational (seat-technician) row never reaches billing, as in SQL.
 */
export function commercialTimeEntryRowFilter(sql: string): ((row: Record<string, any>) => boolean) | null {
  return /^[\w.]+\.billing_mode <> 'operational'$/.test(sql.trim()) ? isCommercialTimeEntry : null;
}
