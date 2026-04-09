import type { Knex } from 'knex';

type GetAllScheduleEntriesFn = (
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  start: Date,
  end: Date
) => Promise<any[]>;

let _getAllScheduleEntries: GetAllScheduleEntriesFn | null = null;

export function registerGetAllScheduleEntries(fn: GetAllScheduleEntriesFn): void {
  _getAllScheduleEntries = fn;
}

export function getAllScheduleEntries(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  start: Date,
  end: Date
): Promise<any[]> {
  if (!_getAllScheduleEntries) {
    throw new Error(
      'getAllScheduleEntries not registered. Call registerGetAllScheduleEntries() at startup.'
    );
  }
  return _getAllScheduleEntries(knexOrTrx, tenant, start, end);
}
