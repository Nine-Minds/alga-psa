import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toTenantLocalDate } from '@alga-psa/event-bus/workflow/dateDomainEvents';
import type { DateTriggerSource } from '../types';

// Fires on the due date of each asset maintenance schedule's open occurrence. Completing a
// maintenance closes the occurrence and opens the next cycle's row, so the same workflow fires
// again on that date; the fire key is per (schedule occurrence, date), deduped by the launcher.
export const assetMaintenanceDueSource: DateTriggerSource = {
  id: 'asset.maintenance_due',
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string) {
    const rows = await tenantDb(knex, tenant).table('asset_maintenance_occurrences as o')
      .join('asset_maintenance_schedules as s', function joinSchedule() { this.on('s.schedule_id', '=', 'o.schedule_id').andOn('s.tenant', '=', 'o.tenant'); })
      .join('assets as a', function joinAsset() { this.on('a.asset_id', '=', 'o.asset_id').andOn('a.tenant', '=', 'o.tenant'); })
      .leftJoin('clients as c', function joinClient() { this.on('c.client_id', '=', 'a.client_id').andOn('c.tenant', '=', 'a.tenant'); })
      .leftJoin('tenant_settings as ts', 'ts.tenant', 'o.tenant')
      .select('o.occurrence_id', 'o.schedule_id', 'o.asset_id', 'o.due_date', 's.schedule_name', 's.maintenance_type', 'a.name as asset_name', 'a.client_id', 'c.client_name', 'ts.settings')
      .where('o.status', 'open')
      .where('s.is_active', true)
      .whereNotIn('a.status', ['retired', 'disposed'])
      .whereRaw("o.due_date >= (?::date::timestamp AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC')) AND o.due_date < ((?::date + 1)::timestamp AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC'))", [fromDate, toDate])
      .orderBy('o.occurrence_id', 'asc');
    return rows.map((r) => {
      const timezone = typeof r.settings?.timezone === 'string' ? r.settings.timezone : 'UTC';
      const occursOn = toTenantLocalDate(r.due_date, timezone);
      return { entityId: r.asset_id, clientId: r.client_id ?? '', occursOn, cycleKey: r.occurrence_id, payload: { occurrenceId: r.occurrence_id, scheduleId: r.schedule_id, assetId: r.asset_id, scheduleName: r.schedule_name, assetName: r.asset_name, maintenanceType: r.maintenance_type, clientId: r.client_id, clientName: r.client_name, occursOn, dueDate: occursOn } };
    });
  },
};
