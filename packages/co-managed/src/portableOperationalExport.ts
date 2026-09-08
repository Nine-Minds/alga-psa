import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { admitCoManagedNativeTimeOwner, admitCoManagedNativeTimeSource } from './nativeTimeEntryAccess';
import { retainScheduleSource } from './nativeScheduleRead';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS, type CoManagedPortableOperationalRecords,
  type CoManagedPortableOperationalTable } from './portableOperationalCatalog';
import { validatePortableRecordSection } from './portableRecordValidation';

export const CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES = [
  ['time_entries', 'user_id', 'users', 'user_id'], ['time_entries', 'created_by', 'users', 'user_id'],
  ['time_entries', 'updated_by', 'users', 'user_id'], ['time_entries', 'time_sheet_id', 'time_sheets', 'id'],
  ['time_sheets', 'user_id', 'users', 'user_id'], ['time_sheets', 'period_id', 'time_periods', 'period_id'],
  ['time_sheets', 'approved_by', 'users', 'user_id'],
  ['time_sheet_comments', 'time_sheet_id', 'time_sheets', 'id'], ['time_sheet_comments', 'user_id', 'users', 'user_id'],
  ['time_entry_change_requests', 'time_sheet_id', 'time_sheets', 'id'],
  ['time_entry_change_requests', 'time_entry_id', 'time_entries', 'entry_id'],
  ['time_entry_change_requests', 'created_by', 'users', 'user_id'], ['time_entry_change_requests', 'handled_by', 'users', 'user_id'],
  ['schedule_entries', 'original_entry_id', 'schedule_entries', 'entry_id'],
  ['schedule_entry_assignees', 'entry_id', 'schedule_entries', 'entry_id'], ['schedule_entry_assignees', 'user_id', 'users', 'user_id'],
  ['user_work_schedules', 'user_id', 'users', 'user_id'],
  ['business_hours_entries', 'schedule_id', 'business_hours_schedules', 'schedule_id'],
  ['holidays', 'schedule_id', 'business_hours_schedules', 'schedule_id'],
  ['sla_policies', 'business_hours_schedule_id', 'business_hours_schedules', 'schedule_id'],
  ['sla_policy_targets', 'sla_policy_id', 'sla_policies', 'sla_policy_id'], ['sla_policy_targets', 'priority_id', 'priorities', 'priority_id'],
  ['sla_notification_thresholds', 'sla_policy_id', 'sla_policies', 'sla_policy_id'],
] as const;

/** Type discriminators must survive remapping; these are local record links,
 * never live co-managed work-reference IDs. Null ad-hoc/non-billable roots are
 * permitted only where the native source admission permits them. */
export const CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES = [
  { table: 'time_entries', column: 'work_item_id', discriminator: 'work_item_type', targets: {
    ticket: ['tickets', 'ticket_id'], project_task: ['project_tasks', 'task_id'],
    ad_hoc: ['schedule_entries', 'entry_id'], interaction: ['interactions', 'interaction_id'], non_billable_category: null,
  } },
  { table: 'schedule_entries', column: 'work_item_id', discriminator: 'work_item_type', targets: {
    ticket: ['tickets', 'ticket_id'], project_task: ['project_tasks', 'task_id'], interaction: ['interactions', 'interaction_id'],
    appointment_request: ['appointment_requests', 'appointment_request_id'], ad_hoc: null, non_billable_category: null,
  } },
] as const;

export function validateCoManagedPortableOperationalRecords(input: unknown): asserts input is CoManagedPortableOperationalRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS,
    identities: { schedule_entry_assignees: ['entry_id', 'user_id'], user_work_schedules: ['user_id', 'day_of_week'], sla_settings: [] },
    valueTypes: { user_work_schedules: { day_of_week: 'integer' } },
    counts: { sla_settings: { max: 1 } }, references: CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES });
  const records = input as CoManagedPortableOperationalRecords;
  for (const row of [...records.user_work_schedules, ...records.business_hours_entries]) {
    if (!Number.isInteger(row.day_of_week) || Number(row.day_of_week) < 0 || Number(row.day_of_week) > 6) throw new Error('Invalid portable working day');
  }
  for (const source of CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES) {
    for (const row of records[source.table]) {
      if (typeof row.work_item_type !== 'string' || !Object.hasOwn(source.targets, row.work_item_type)) throw new Error('Invalid portable operational work type');
      const target = (source.targets as Record<string, readonly string[] | null>)[row.work_item_type];
      if (!target) {
        if (row.work_item_id !== null) throw new Error('Invalid portable operational work reference');
      } else {
        if (!isCoManagedUuid(row.work_item_id)) throw new Error('Invalid portable operational work reference');
        if (target[0] in records && !records[target[0] as CoManagedPortableOperationalTable].some(parent => parent[target[1]] === row.work_item_id)) throw new Error('Portable operational work reference is missing');
      }
    }
  }
  for (const request of records.time_entry_change_requests) {
    const entry = records.time_entries.find(row => row.entry_id === request.time_entry_id);
    if (entry && entry.time_sheet_id !== request.time_sheet_id) throw new Error('Portable time review belongs to a different sheet');
  }
  for (const entry of records.time_entries) {
    const sheet = records.time_sheets.find(row => row.id === entry.time_sheet_id);
    if (sheet && sheet.user_id !== entry.user_id) throw new Error('Portable time entry belongs to a different sheet owner');
  }
}

/** Internal records component, not a complete backup. Refuses a partial export
 * when native source/employee/privacy policy hides any included content. */
export async function exportCoManagedPortableOperational(db: Knex, inputActor: CoManagedSessionActor, packageId: string) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return db.transaction(trx => withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    for (const resource of ['time_entry', 'time_sheet', 'time_period', 'user_schedule', 'sla_policy']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableOperationalRecords;
    for (const table of Object.keys(CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS) as CoManagedPortableOperationalTable[]) {
      const columns = CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS[table];
      const query = own.table(table).select(...columns).limit(100_001);
      for (const column of columns.slice(0, ['schedule_entry_assignees', 'user_work_schedules'].includes(table) ? 2 : 1)) query.orderBy(column);
      records[table] = await query;
    }
    validateCoManagedPortableOperationalRecords(records);
    const requireVisible = (fields: readonly string[]) => { if (fields.length) throw new CoManagedSharedWorkError(); };
    // Captured rows are locators until retained after their native source. In
    // repeatable-read PostgreSQL rejects a lock on a row changed since capture,
    // so a concurrent privacy/source change cannot authorize stale content.
    const retainCaptured = async (table: CoManagedPortableOperationalTable, row: Record<string, unknown>, keys?: readonly string[]) => {
      const columns = CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS[table];
      const identity = keys ?? columns.slice(0, 1);
      const query = own.table(table);
      for (const key of identity) query.where(key, row[key]);
      const retained = await query.forShare().first(...columns);
      if (!retained || JSON.stringify(retained) !== JSON.stringify(row)) throw new CoManagedSharedWorkError();
    };
    // Match native collection lock order: owners and sheets before work roots.
    await own.table('users').whereIn('user_id', [...new Set([...records.time_entries, ...records.time_sheets].map(row => row.user_id))]).orderBy('user_id').forShare().select('user_id');
    await own.table('time_sheets').orderBy('id').forShare().select('id');
    for (const row of records.time_sheets) {
      await admitCoManagedNativeTimeOwner(current, verified, subject, String(row.user_id), true);
      requireVisible((await authorizeCoManagedLocalRecord(current, verified, subject, 'time_sheet', 'read', {
        id: String(row.id), ownerUserId: String(row.user_id), assignedUserIds: [String(row.user_id)],
      })).redactedFields);
    }
    for (const row of records.time_entries) {
      const access = await admitCoManagedNativeTimeSource(current, verified, {
        entry_id: String(row.entry_id), user_id: String(row.user_id), time_sheet_id: row.time_sheet_id as string,
        work_item_id: (row.work_item_id || '__non_billable__') as string, work_item_type: String(row.work_item_type),
      }, 'read');
      await retainCaptured('time_entries', row);
      requireVisible(access.redactedSourceFields); requireVisible(access.redactedTimeFields); await access.assertCurrent();
    }
    for (const table of ['time_sheet_comments', 'time_entry_change_requests'] as const) {
      for (const row of records[table]) await retainCaptured(table, row);
    }
    const canReadOthers = await hasCoManagedLocalPermission(current, verified, 'user_schedule', 'update', true);
    for (const row of records.schedule_entries) {
      const source = await retainScheduleSource(current, verified, subject, {
        entry_id: String(row.entry_id), work_item_id: row.work_item_id as string | null, work_item_type: String(row.work_item_type),
      });
      await retainCaptured('schedule_entries', row);
      const assignees = records.schedule_entry_assignees.filter(item => item.entry_id === row.entry_id);
      for (const assignee of assignees) await retainCaptured('schedule_entry_assignees', assignee, ['entry_id', 'user_id']);
      const assignments = assignees.map(item => String(item.user_id));
      if ((!canReadOthers || row.is_private) && !assignments.includes(verified.userId)) throw new CoManagedSharedWorkError();
      requireVisible(source.fields);
      requireVisible((await authorizeCoManagedLocalRecord(current, verified, subject, 'user_schedule', 'read', {
        ...source.record, id: String(row.entry_id), ownerUserId: assignments.length === 1 ? assignments[0] : undefined, assignedUserIds: assignments,
      })).redactedFields);
    }
    for (const row of records.user_work_schedules) {
      await retainCaptured('user_work_schedules', row, ['user_id', 'day_of_week']);
      if (!canReadOthers && row.user_id !== verified.userId) throw new CoManagedSharedWorkError();
      requireVisible((await authorizeCoManagedLocalRecord(current, verified, subject, 'user_schedule', 'read', {
        id: String(row.user_id), ownerUserId: String(row.user_id), assignedUserIds: [String(row.user_id)],
      })).redactedFields);
    }
    for (const table of ['time_periods', 'time_period_settings', 'time_period_types', 'business_hours_schedules', 'business_hours_entries', 'holidays', 'sla_policies', 'sla_policy_targets', 'sla_settings', 'sla_notification_thresholds'] as const) {
      for (const row of records[table]) {
        const resource = table.startsWith('time_period') ? 'time_period' : 'sla_policy';
        const id = table === 'sla_settings' ? verified.tenant : String(row[CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS[table][0]]);
        requireVisible((await authorizeCoManagedLocalRecord(current, verified, subject, resource, 'read', { id })).redactedFields);
      }
    }
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-operational', version: 1, packageId, sourceTenant: verified.tenant,
      capturedAt: captured_at, records, references: CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES,
      polymorphicReferences: CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES,
      restorePolicy: { sponsorship: 'none', timeBilling: 'operational', runningTimers: 'none', notificationDispatch: 'paused' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }), { isolationLevel: 'repeatable read' });
}
