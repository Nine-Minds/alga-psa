import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toCalendarDateString, toISOTimestamp, toPlainDate } from '@alga-psa/core';
import { advanceMaintenanceDate } from './maintenanceRecurrence';

export interface MaintenanceOccurrenceRow {
  occurrence_id: string;
  schedule_id: string;
  asset_id: string;
  due_date: Date | string;
  status: 'open' | 'completed' | 'skipped' | 'cancelled';
  ticket_id: string | null;
  history_id: string | null;
}

export interface MaintenanceScheduleRow {
  schedule_id: string;
  asset_id: string;
  schedule_name: string;
  maintenance_type: string;
  frequency: string;
  frequency_interval: number;
  schedule_config?: unknown;
  next_maintenance: Date | string;
  last_maintenance: Date | string | null;
  is_active: boolean;
  archived_at: Date | string | null;
}

export async function lockMaintenanceOccurrence(trx: Knex.Transaction, tenant: string, occurrenceId: string): Promise<MaintenanceOccurrenceRow> {
  const db = tenantDb(trx, tenant);
  const reference = await db.table('asset_maintenance_occurrences').where({ occurrence_id: occurrenceId }).first<MaintenanceOccurrenceRow>();
  if (!reference) throw new Error('Maintenance occurrence not found');
  // Always lock schedule before occurrence, matching pause/resume and avoiding
  // a deadlock when a completion races with pausing the same schedule.
  const schedule = await db.table('asset_maintenance_schedules')
    .where({ schedule_id: reference.schedule_id }).forUpdate().first<MaintenanceScheduleRow>();
  if (!schedule) throw new Error('Maintenance schedule not found');
  const occurrence = await db.table('asset_maintenance_occurrences')
    .where({ occurrence_id: occurrenceId }).forUpdate().first<MaintenanceOccurrenceRow>();
  if (!occurrence) throw new Error('Maintenance occurrence not found');
  return occurrence;
}

export async function lockMaintenanceSchedule(trx: Knex.Transaction, tenant: string, scheduleId: string): Promise<MaintenanceScheduleRow> {
  const schedule = await tenantDb(trx, tenant).table('asset_maintenance_schedules')
    .where({ schedule_id: scheduleId }).forUpdate().first<MaintenanceScheduleRow>();
  if (!schedule) throw new Error('Maintenance schedule not found');
  if (schedule.archived_at) throw new Error('Maintenance schedule is archived');
  return schedule;
}

async function activeScheduleForOccurrence(trx: Knex.Transaction, tenant: string, occurrence: MaintenanceOccurrenceRow): Promise<MaintenanceScheduleRow> {
  const schedule = await lockMaintenanceSchedule(trx, tenant, occurrence.schedule_id);
  if (!schedule.is_active) throw new Error('Maintenance schedule is inactive');
  if (schedule.asset_id !== occurrence.asset_id) throw new Error('Maintenance occurrence does not belong to its schedule asset');
  return schedule;
}

async function openNextOccurrence(trx: Knex.Transaction, tenant: string, schedule: MaintenanceScheduleRow, dueDate: Date | string): Promise<MaintenanceOccurrenceRow> {
  const [next] = await tenantDb(trx, tenant).table('asset_maintenance_occurrences').insert({
    tenant, schedule_id: schedule.schedule_id, asset_id: schedule.asset_id, due_date: dueDate, status: 'open',
  }).returning<MaintenanceOccurrenceRow[]>('*');
  return next;
}

/** Caller owns the transaction and authorizes the actor before using these session-free operations. */
export async function linkMaintenanceOccurrenceTicket(trx: Knex.Transaction, tenant: string, actorUserId: string, occurrenceId: string, ticketId: string): Promise<MaintenanceOccurrenceRow> {
  const db = tenantDb(trx, tenant);
  const occurrence = await lockMaintenanceOccurrence(trx, tenant, occurrenceId);
  if (occurrence.status !== 'open') throw new Error('Maintenance occurrence is no longer open');
  if (occurrence.ticket_id) return occurrence;
  const ticket = await db.table('tickets').where({ ticket_id: ticketId }).first();
  if (!ticket) throw new Error('Maintenance ticket not found');
  await db.table('asset_associations').insert({
    tenant, asset_id: occurrence.asset_id, entity_id: ticketId, entity_type: 'ticket',
    relationship_type: 'affected', created_by: actorUserId, created_at: trx.fn.now(),
  }).onConflict(['tenant', 'asset_id', 'entity_id', 'entity_type']).ignore();
  const [updated] = await db.table('asset_maintenance_occurrences').where({ occurrence_id: occurrenceId })
    .update({ ticket_id: ticketId, updated_at: trx.fn.now() }).returning<MaintenanceOccurrenceRow[]>('*');
  return updated;
}

export async function completeMaintenanceOccurrence(
  trx: Knex.Transaction, tenant: string, actorUserId: string,
  input: { occurrence_id: string; performed_at?: string; notes?: string; maintenance_data?: Record<string, unknown>; asset_id?: string },
): Promise<MaintenanceOccurrenceRow> {
  const db = tenantDb(trx, tenant);
  const occurrence = await lockMaintenanceOccurrence(trx, tenant, input.occurrence_id);
  if (input.asset_id && input.asset_id !== occurrence.asset_id) throw new Error('Maintenance occurrence does not belong to the provided asset');
  if (occurrence.status !== 'open') throw new Error('Maintenance occurrence has already been closed');
  const schedule = await activeScheduleForOccurrence(trx, tenant, occurrence);
  const performedDate = toCalendarDateString(input.performed_at || new Date());
  if (!performedDate) throw new Error('A performed date is required');
  const performedAt = toISOTimestamp(toPlainDate(performedDate));
  const nextDue = advanceMaintenanceDate(performedAt, schedule.frequency, schedule.frequency_interval, schedule.schedule_config);
  const [history] = await db.table('asset_maintenance_history').insert({
    tenant, schedule_id: schedule.schedule_id, asset_id: schedule.asset_id,
    maintenance_type: schedule.maintenance_type, description: input.notes || `${schedule.maintenance_type} maintenance completed`,
    maintenance_data: JSON.stringify(input.maintenance_data || {}), performed_at: performedAt, performed_by: actorUserId,
  }).returning<{ history_id: string }[]>('*');
  await db.table('asset_maintenance_occurrences').where({ occurrence_id: occurrence.occurrence_id, status: 'open' })
    .update({ status: 'completed', history_id: history.history_id, closed_at: trx.fn.now(), closed_by: actorUserId, updated_at: trx.fn.now() });
  await db.table('asset_maintenance_schedules').where({ schedule_id: schedule.schedule_id })
    .update({ last_maintenance: performedAt, next_maintenance: nextDue, updated_at: trx.fn.now() });
  await db.table('asset_maintenance_notifications').insert({
    tenant, schedule_id: schedule.schedule_id, asset_id: schedule.asset_id, notification_type: 'upcoming',
    notification_date: nextDue, notification_data: JSON.stringify({ schedule_name: schedule.schedule_name, maintenance_type: schedule.maintenance_type }),
  });
  return openNextOccurrence(trx, tenant, schedule, nextDue);
}

export async function skipMaintenanceOccurrence(trx: Knex.Transaction, tenant: string, actorUserId: string, occurrenceId: string, reason: string): Promise<MaintenanceOccurrenceRow> {
  if (!reason.trim()) throw new Error('A skip reason is required');
  const db = tenantDb(trx, tenant);
  const occurrence = await lockMaintenanceOccurrence(trx, tenant, occurrenceId);
  if (occurrence.status !== 'open') throw new Error('Maintenance occurrence has already been closed');
  const schedule = await activeScheduleForOccurrence(trx, tenant, occurrence);
  const nextDue = advanceMaintenanceDate(new Date(), schedule.frequency, schedule.frequency_interval, schedule.schedule_config);
  await db.table('asset_maintenance_occurrences').where({ occurrence_id: occurrenceId })
    .update({ status: 'skipped', skip_reason: reason.trim(), closed_at: trx.fn.now(), closed_by: actorUserId, updated_at: trx.fn.now() });
  await db.table('asset_maintenance_schedules').where({ schedule_id: schedule.schedule_id })
    .update({ next_maintenance: nextDue, updated_at: trx.fn.now() });
  return openNextOccurrence(trx, tenant, schedule, nextDue);
}

export async function setMaintenanceSchedulePaused(trx: Knex.Transaction, tenant: string, actorUserId: string, scheduleId: string, paused: boolean): Promise<void> {
  const db = tenantDb(trx, tenant);
  const schedule = await lockMaintenanceSchedule(trx, tenant, scheduleId);
  await db.table('asset_maintenance_schedules').where({ schedule_id: scheduleId })
    .update({ is_active: !paused, updated_at: trx.fn.now() });
  if (paused) {
    await db.table('asset_maintenance_occurrences').where({ schedule_id: scheduleId, status: 'open' })
      .update({ status: 'cancelled', closed_at: trx.fn.now(), closed_by: actorUserId, updated_at: trx.fn.now() });
  } else {
    await db.table('asset_maintenance_occurrences').insert({
      tenant, schedule_id: scheduleId, asset_id: schedule.asset_id, due_date: schedule.next_maintenance, status: 'open',
    }).onConflict().ignore();
  }
}
