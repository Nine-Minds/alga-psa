import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { hasCoManagedLocalPermission } from './localPermission';
import { retainScheduleSource } from './nativeScheduleRead';
import { retainNativeAppointmentRequest } from './nativeAppointmentRequest';
import { retainNativeOnlineMeeting, consumeCoManagedMeetingArtifact } from './nativeMeetingRead';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { validatePortableRecordSection } from './portableRecordValidation';
import { CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS, type CoManagedPortableEngagementRecords,
  type CoManagedPortableEngagementTable } from './portableEngagementCatalog';

export const CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES = [
  ['interactions', 'contact_name_id', 'contacts', 'contact_name_id'], ['interactions', 'client_id', 'clients', 'client_id'],
  ['interactions', 'user_id', 'users', 'user_id'], ['interactions', 'ticket_id', 'tickets', 'ticket_id'],
  ['interactions', 'project_id', 'projects', 'project_id'], ['interactions', 'status_id', 'statuses', 'status_id'],
  ['interaction_types', 'system_type_id', 'system_interaction_types', 'type_id'], ['interaction_types', 'created_by', 'users', 'user_id'],
  ['appointment_requests', 'client_id', 'clients', 'client_id'], ['appointment_requests', 'contact_id', 'contacts', 'contact_name_id'],
  ['appointment_requests', 'service_id', 'service_catalog', 'service_id'], ['appointment_requests', 'ticket_id', 'tickets', 'ticket_id'],
  ['appointment_requests', 'preferred_assigned_user_id', 'users', 'user_id'], ['appointment_requests', 'approved_by_user_id', 'users', 'user_id'],
  ['appointment_requests', 'schedule_entry_id', 'schedule_entries', 'entry_id'],
  ['availability_settings', 'user_id', 'users', 'user_id'], ['availability_settings', 'service_id', 'service_catalog', 'service_id'],
  ['availability_exceptions', 'user_id', 'users', 'user_id'],
  ['online_meetings', 'appointment_request_id', 'appointment_requests', 'appointment_request_id'],
  ['online_meetings', 'interaction_id', 'interactions', 'interaction_id'], ['online_meetings', 'schedule_entry_id', 'schedule_entries', 'entry_id'],
  ['online_meetings', 'created_by', 'users', 'user_id'], ['online_meeting_artifacts', 'meeting_id', 'online_meetings', 'meeting_id'],
  ['online_meeting_artifacts', 'document_id', 'documents', 'document_id'],
  ['service_catalog', 'category_id', 'service_categories', 'category_id'], ['service_catalog', 'custom_service_type_id', 'service_types', 'id'],
  ['service_categories', 'created_by', 'users', 'user_id'], ['service_categories', 'updated_by', 'users', 'user_id'],
] as const;

export const CO_MANAGED_PORTABLE_ENGAGEMENT_ADDITIONAL_REFERENCES = {
  union: [{ table: 'interactions', column: 'type_id', targets: [['interaction_types', 'type_id'], ['system_interaction_types', 'type_id']] }],
  json: [
    { table: 'availability_settings', column: 'config_json', path: 'approver_user_ids', array: true, parent: 'users', parentColumn: 'user_id' },
    { table: 'availability_settings', column: 'config_json', path: 'approver_team_ids', array: true, parent: 'teams', parentColumn: 'team_id' },
    { table: 'availability_settings', column: 'config_json', path: 'default_approver_id', array: false, parent: 'users', parentColumn: 'user_id' },
  ],
  blobs: [{ table: 'online_meeting_artifacts', column: 'file_id', kind: 'file' }],
} as const;

const configBooleans = ['allow_client_preference', 'auto_approval_enabled'] as const;
const criteriaBooleans = ['require_availability', 'require_contract', 'check_conflicts', 'respect_buffers'] as const;
const configKeys = ['approver_user_ids', 'approver_team_ids', 'default_approver_id', 'default_duration', 'auto_approval_criteria', ...configBooleans];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Availability JSON is a typed configuration projection. Arbitrary future
 * provider/authentication keys cannot ride along with appointment settings. */
function portableAvailabilityConfig(input: unknown) {
  if (input == null) return null;
  const source = typeof input === 'string' ? JSON.parse(input) : input;
  if (!object(source)) throw new Error('Invalid portable availability configuration');
  const result = Object.fromEntries(configKeys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
  if (Object.hasOwn(result, 'auto_approval_criteria')) {
    if (!object(result.auto_approval_criteria)) throw new Error('Invalid portable availability criteria');
    const criteria = result.auto_approval_criteria;
    result.auto_approval_criteria = Object.fromEntries(criteriaBooleans.filter(key => Object.hasOwn(criteria, key)).map(key => [key, criteria[key]]));
  }
  return result;
}

export function validateCoManagedPortableEngagementRecords(input: unknown): asserts input is CoManagedPortableEngagementRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS, references: CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES });
  const records = input as CoManagedPortableEngagementRecords;
  const types = new Set([...records.interaction_types, ...records.system_interaction_types].map(row => String(row.type_id).toLowerCase()));
  for (const row of records.interactions) if (!isCoManagedUuid(row.type_id) || !types.has(row.type_id.toLowerCase())) throw new Error('Portable interaction type is missing');
  for (const row of records.availability_settings) {
    if (row.day_of_week !== null && (!Number.isInteger(row.day_of_week) || Number(row.day_of_week) < 0 || Number(row.day_of_week) > 6)) throw new Error('Invalid portable availability day');
    if (row.config_json === null) continue;
    const config = row.config_json;
    if (!object(config) || Object.keys(config).some(key => !configKeys.includes(key))) throw new Error('Invalid portable availability configuration');
    for (const key of ['approver_user_ids', 'approver_team_ids']) {
      if (Object.hasOwn(config, key) && (!Array.isArray(config[key]) || !config[key].every(isCoManagedUuid))) throw new Error('Invalid portable appointment approver');
    }
    if (config.default_approver_id != null && !isCoManagedUuid(config.default_approver_id)) throw new Error('Invalid portable appointment approver');
    if (config.default_duration != null && (!Number.isSafeInteger(config.default_duration) || Number(config.default_duration) < 1)) throw new Error('Invalid portable appointment duration');
    if (configBooleans.some(key => Object.hasOwn(config, key) && typeof config[key] !== 'boolean')) throw new Error('Invalid portable availability setting');
    if (Object.hasOwn(config, 'auto_approval_criteria') && (!object(config.auto_approval_criteria) || Object.entries(config.auto_approval_criteria).some(([key, value]) => !(criteriaBooleans as readonly string[]).includes(key) || typeof value !== 'boolean'))) throw new Error('Invalid portable availability criteria');
  }
  for (const row of records.online_meetings) if (!row.interaction_id && !row.appointment_request_id) throw new Error('Portable meeting source is missing');
  for (const row of records.online_meeting_artifacts) {
    if (!['recording', 'transcript'].includes(String(row.artifact_type)) || row.file_id !== null && !isCoManagedUuid(row.file_id)) throw new Error('Invalid portable meeting artifact');
  }
}

/** Internal metadata section. Only referenced appointment service descriptors
 * are included; no commercial catalog or provider transport is exported. */
export async function exportCoManagedPortableEngagement(db: Knex, inputActor: CoManagedSessionActor, packageId: string, snapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return portableSnapshotTransaction(db, snapshot, trx => withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    for (const resource of ['interaction', 'user_schedule', 'system_settings']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableEngagementRecords;
    const descriptors = ['service_catalog', 'service_types', 'service_categories'];
    for (const table of Object.keys(CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS) as CoManagedPortableEngagementTable[]) {
      const columns = CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table];
      if (descriptors.includes(table)) { records[table] = []; continue; }
      const query = table === 'system_interaction_types' ? current(table) : own.table(table);
      records[table] = await query.select(...columns).orderBy(columns[0]).limit(100_001);
      if (records[table].length > 100_000) throw new Error('Invalid portable engagement record count');
    }
    const requireVisible = (fields: readonly string[]) => { if (fields.length) throw new CoManagedSharedWorkError(); };
    const retain = async (table: CoManagedPortableEngagementTable, row: Record<string, unknown>) => {
      const columns = CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table], query = table === 'system_interaction_types' ? current(table) : own.table(table);
      const captured = await query.where(columns[0], row[columns[0]]).forShare().first(...columns);
      if (!captured || JSON.stringify(captured) !== JSON.stringify(row)) throw new CoManagedSharedWorkError();
    };
    // Each concrete native owner is admitted before its canonical metadata is
    // retained. RR raises 40001 if a source/privacy binding changed meanwhile.
    for (const row of records.interactions) {
      const source = await retainScheduleSource(current, verified, subject, { work_item_type: 'interaction', work_item_id: String(row.interaction_id) });
      requireVisible(source.fields); await retain('interactions', row);
    }
    for (const row of records.appointment_requests) {
      const source = await retainNativeAppointmentRequest(current, verified, subject, String(row.appointment_request_id));
      requireVisible(source.fields); await retain('appointment_requests', row);
    }
    for (const table of ['interaction_types', 'system_interaction_types', 'availability_settings', 'availability_exceptions'] as const) {
      for (const row of records[table]) {
        await retain(table, row);
        requireVisible((await authorizeCoManagedLocalRecord(current, verified, subject,
          table.includes('interaction_types') ? 'interaction' : 'system_settings', 'read',
          { id: String(row[CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table][0]]), ownerUserId: row.user_id as string | undefined })).redactedFields);
      }
    }
    for (const row of records.online_meetings) {
      await retainNativeOnlineMeeting(current, verified, subject, String(row.meeting_id)); await retain('online_meetings', row);
    }
    for (const row of records.online_meeting_artifacts) {
      const admission = await consumeCoManagedMeetingArtifact(current, verified.tenant, String(row.artifact_id), async () => verified,
        async () => ({ value: null }));
      if (!admission.handled) throw new CoManagedSharedWorkError();
      await retain('online_meeting_artifacts', row);
    }
    // Native appointment and availability surfaces admit these related service
    // labels under the parent's permission. A co-managed SKU has no commercial
    // service-catalog permission; only these referenced operational descriptors
    // are included, with explicit missing-parent validation below.
    const serviceIds = [...new Set([...records.appointment_requests, ...records.availability_settings].map(row => row.service_id as string | null).filter((id): id is string => Boolean(id)))];
    for (let offset = 0; offset < serviceIds.length; offset += 1000) records.service_catalog.push(...await own.table('service_catalog').whereIn('service_id', serviceIds.slice(offset, offset + 1000)).forShare().select(...CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS.service_catalog));
    for (const [table, sourceColumn, pk] of [['service_types', 'custom_service_type_id', 'id'], ['service_categories', 'category_id', 'category_id']] as const) {
      const ids = [...new Set(records.service_catalog.map(row => row[sourceColumn] as string | null).filter((id): id is string => Boolean(id)))];
      for (let offset = 0; offset < ids.length; offset += 1000) records[table].push(...await own.table(table).whereIn(pk, ids.slice(offset, offset + 1000)).forShare().select(...CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table]));
    }
    for (const table of descriptors as CoManagedPortableEngagementTable[]) records[table].sort((a, b) => String(a[CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table][0]]).localeCompare(String(b[CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS[table][0]])));
    records.availability_settings = records.availability_settings.map(row => ({ ...row, config_json: portableAvailabilityConfig(row.config_json) }));
    validateCoManagedPortableEngagementRecords(records);
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-engagement', version: 1, packageId, sourceTenant: verified.tenant,
      capturedAt: snapshot?.capturedAt ?? captured_at, records, references: CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES,
      additionalReferences: CO_MANAGED_PORTABLE_ENGAGEMENT_ADDITIONAL_REFERENCES,
      restorePolicy: { sponsorship: 'none', providerConnections: 'reauthorize', meetings: 'historical_metadata',
        appointmentDispatch: 'paused', servicePricing: 'unconfigured', remoteArtifactContent: 'requires_separate_capture' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }));
}
