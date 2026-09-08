import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { validatePortableRecordSection } from './portableRecordValidation';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CURATED_TICKET_FIELDS } from '../../../shared/lib/ticketActivity/types';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS, type CoManagedPortableWorkRecords, type CoManagedPortableWorkTable } from './portableWorkCatalog';

export const CO_MANAGED_PORTABLE_WORK_REFERENCES = [
  ['statuses', 'board_id', 'boards', 'board_id'], ['categories', 'board_id', 'boards', 'board_id'],
  ['categories', 'parent_category', 'categories', 'category_id'],
  ['tickets', 'board_id', 'boards', 'board_id'], ['tickets', 'status_id', 'statuses', 'status_id'],
  ['tickets', 'priority_id', 'priorities', 'priority_id'], ['tickets', 'category_id', 'categories', 'category_id'],
  ['tickets', 'subcategory_id', 'categories', 'category_id'], ['tickets', 'master_ticket_id', 'tickets', 'ticket_id'],
  ['tickets', 'client_id', 'clients', 'client_id'], ['tickets', 'contact_name_id', 'contacts', 'contact_name_id'],
  ['tickets', 'location_id', 'client_locations', 'location_id'],
  ['ticket_resources', 'ticket_id', 'tickets', 'ticket_id'],
  ['comment_threads', 'ticket_id', 'tickets', 'ticket_id'], ['comment_threads', 'project_task_id', 'project_tasks', 'task_id'],
  ['comments', 'ticket_id', 'tickets', 'ticket_id'], ['comments', 'thread_id', 'comment_threads', 'thread_id'],
  ['comments', 'parent_comment_id', 'comments', 'comment_id'],
  ['comments', 'actor_reference_id', 'collaboration_actor_references', 'actor_reference_id'],
  ['comment_reactions', 'comment_id', 'comments', 'comment_id'], ['ticket_audit_logs', 'ticket_id', 'tickets', 'ticket_id'],
  ['checklist_template_items', 'template_id', 'checklist_templates', 'template_id'],
  ['checklist_template_apply_rules', 'template_id', 'checklist_templates', 'template_id'],
  ['ticket_checklist_items', 'ticket_id', 'tickets', 'ticket_id'],
  ['projects', 'client_id', 'clients', 'client_id'], ['projects', 'status', 'statuses', 'status_id'],
  ['project_phases', 'project_id', 'projects', 'project_id'],
  ['project_status_mappings', 'project_id', 'projects', 'project_id'],
  ['project_status_mappings', 'phase_id', 'project_phases', 'phase_id'],
  ['project_status_mappings', 'status_id', 'statuses', 'status_id'],
  ['project_status_mappings', 'standard_status_id', 'standard_statuses', 'standard_status_id'],
  ['project_tasks', 'phase_id', 'project_phases', 'phase_id'],
  ['project_tasks', 'project_status_mapping_id', 'project_status_mappings', 'project_status_mapping_id'],
  ['project_tasks', 'priority_id', 'priorities', 'priority_id'],
  ['project_tasks', 'service_id', 'service_catalog', 'service_id'],
  ['task_resources', 'task_id', 'project_tasks', 'task_id'], ['task_checklist_items', 'task_id', 'project_tasks', 'task_id'],
  ['project_task_dependencies', 'predecessor_task_id', 'project_tasks', 'task_id'],
  ['project_task_dependencies', 'successor_task_id', 'project_tasks', 'task_id'],
  ['project_ticket_links', 'project_id', 'projects', 'project_id'], ['project_ticket_links', 'phase_id', 'project_phases', 'phase_id'],
  ['project_ticket_links', 'task_id', 'project_tasks', 'task_id'], ['project_ticket_links', 'ticket_id', 'tickets', 'ticket_id'],
  ['project_task_comments', 'task_id', 'project_tasks', 'task_id'], ['project_task_comments', 'thread_id', 'comment_threads', 'thread_id'],
  ['project_task_comments', 'parent_comment_id', 'project_task_comments', 'task_comment_id'],
  ['project_task_comments', 'actor_reference_id', 'collaboration_actor_references', 'actor_reference_id'],
  ['project_task_comment_reactions', 'task_comment_id', 'project_task_comments', 'task_comment_id'],
  ['handoff_history', 'ticket_id', 'tickets', 'ticket_id'],
] as const;

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);
function portableAudit(row: Record<string, unknown>) {
  const changes: Record<string, unknown> = {};
  for (const field of CURATED_TICKET_FIELDS) {
    const change = object(object(row.changes)[field]);
    if (Object.keys(change).length) changes[field] = Object.fromEntries(['old', 'new', 'oldLabel', 'newLabel']
      .filter(key => Object.hasOwn(change, key) && scalar(change[key])).map(key => [key, change[key]]));
  }
  const details = object(row.details);
  const allowed = ['is_internal', 'collaboration_audience', 'previous_audience', 'thread_id', 'parent_comment_id',
    'scheduled_publish_at', 'scheduled_publish_tz', 'canceled', 'document_id', 'document_name', 'file_name',
    'checklist_item_id', 'item_name', 'template_id', 'template_name', 'bundle_master_ticket_id', 'bypass_source'];
  return { ...row, changes, details: Object.fromEntries(allowed.filter(key => Object.hasOwn(details, key) && scalar(details[key])).map(key => [key, details[key]])) };
}

export function validateCoManagedPortableWorkRecords(input: unknown): asserts input is CoManagedPortableWorkRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_WORK_COLUMNS, references: CO_MANAGED_PORTABLE_WORK_REFERENCES });
  const records = input as CoManagedPortableWorkRecords;
  for (const thread of records.comment_threads) {
    if ((thread.ticket_id === null) === (thread.project_task_id === null)) throw new Error('Invalid portable conversation source');
    const comments = thread.ticket_id ? records.comments : records.project_task_comments;
    const idColumn = thread.ticket_id ? 'comment_id' : 'task_comment_id';
    if (!comments.some(row => row[idColumn] === thread.root_comment_id && row.thread_id === thread.thread_id)) throw new Error('Portable conversation root is missing');
    for (const comment of comments.filter(row => row.thread_id === thread.thread_id)) {
      if (thread.ticket_id ? comment.ticket_id !== thread.ticket_id : comment.task_id !== thread.project_task_id) throw new Error('Portable conversation source changed');
    }
  }
}

/** Customer-owned tickets, projects and conversation history. Home-private MSP
 * stores and live trust/dispatch records are deliberately absent. Handoffs are
 * inert historical events for restore conversion, not relationship-table rows. */
export async function exportCoManagedPortableWork(db: Knex, inputActor: CoManagedSessionActor, packageId: string, snapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return portableSnapshotTransaction(db, snapshot, trx => withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    for (const resource of ['ticket', 'project', 'ticket_settings']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const settings = await authorizeCoManagedLocalRecord(current, verified, subject, 'ticket_settings', 'read', { id: verified.tenant });
    if (settings.redactedFields.length) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), records = {} as CoManagedPortableWorkRecords;
    for (const table of Object.keys(CO_MANAGED_PORTABLE_WORK_COLUMNS) as CoManagedPortableWorkTable[]) {
      const columns = CO_MANAGED_PORTABLE_WORK_COLUMNS[table];
      const query = table === 'standard_statuses' ? current('standard_statuses') : own.table(table === 'handoff_history' ? 'co_management_ticket_handoffs' : table);
      records[table] = await query.select(...columns).orderBy(columns[0]).limit(100_001);
    }
    for (const row of records.tickets) {
      const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'ticket', 'read', {
        id: String(row.ticket_id), clientId: row.client_id as string, boardId: row.board_id as string,
        ownerUserId: row.entered_by as string, assignedUserIds: row.assigned_to ? [String(row.assigned_to)] : [],
        teamIds: row.assigned_team_id ? [String(row.assigned_team_id)] : [],
      });
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
    for (const row of records.projects) {
      const decision = await authorizeCoManagedLocalRecord(current, verified, subject, 'project', 'read', {
        id: String(row.project_id), clientId: row.client_id as string, assignedUserIds: row.assigned_to ? [String(row.assigned_to)] : [], teamIds: [],
      });
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
    records.ticket_audit_logs = records.ticket_audit_logs.map(portableAudit);
    validateCoManagedPortableWorkRecords(records);
    const [{ captured_at }] = (await current.raw('SELECT transaction_timestamp() AS captured_at')).rows;
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-work', version: 1, packageId, sourceTenant: verified.tenant,
      capturedAt: snapshot?.capturedAt ?? captured_at, records, references: CO_MANAGED_PORTABLE_WORK_REFERENCES,
      restorePolicy: { sponsorship: 'none', scheduledPublication: 'paused', handoffHistory: 'historical_activity' } }));
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  }));
}
