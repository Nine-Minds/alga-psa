import ScheduleEntry from '@alga-psa/scheduling/models/scheduleEntry';
import { registerGetAllScheduleEntries } from '@alga-psa/core/lib/scheduleEntryRegistry';

export function registerScheduleEntryIntegration(): void {
  registerGetAllScheduleEntries((knex, tenant, start, end) => ScheduleEntry.getAll(knex, tenant, start, end));
}
