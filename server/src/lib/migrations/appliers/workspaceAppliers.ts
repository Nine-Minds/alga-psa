import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { AMP_WORKSPACE_TABLES, workspaceFields, type AmpEntityType, type AmpWorkspaceEntity } from '@alga-psa/migration-spec';
import { stageFileUpload } from '@alga-psa/storage/fileUploadTransaction';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { WORKSPACE_MAPPING } from '../workspaceMapping';
import { DOCUMENT_TARGET_TYPES } from '../workspaceExport';
import type { ApplierContext } from './context';
import type { AppliedTarget, EntityApplier } from './entityAppliers';

/** Create-only native projections of the neutral dictionary. No source IDs, credentials, execution
 * claims or provider bindings become native keys. The caller owns the transaction and identity ledger. */
class WorkspaceApplier implements EntityApplier {
  readonly targetEntityType: string;
  constructor(readonly entityType: AmpWorkspaceEntity) { this.targetEntityType = WORKSPACE_MAPPING[entityType].table; }
  async apply(trx: Knex.Transaction, context: ApplierContext, payload: Record<string, unknown>): Promise<AppliedTarget> {
    const mapping = WORKSPACE_MAPPING[this.entityType];
    const id = randomUUID();
    const native: Record<string, unknown> = { [mapping.key]: id, tenant: context.tenant };
    for (const [column, nativeColumn] of Object.entries(mapping.columns)) {
      const field = workspaceFields(this.entityType)[column];
      const value = payload[column];
      if (field.deferred) continue;
      // Missing optional values use native defaults; they are not guesses about source semantics.
      if (value == null) continue;
      if (field.kind === 'reference') {
        const resolved = await context.resolveReference(trx, field.target as AmpEntityType, String(value));
        if (!resolved) throw new Error(`Unapplied dependency: ${this.entityType}.${column}`);
        native[nativeColumn] = resolved;
      } else if (field.kind === 'flag') native[nativeColumn] = value === 1;
      else if (field.kind === 'json') native[nativeColumn] = JSON.stringify(JSON.parse(String(value)));
      else native[nativeColumn] = value;
    }
    // Created/updated metadata is retained; operational clocks and provider identities are never inferred.
    if (payload.created_at != null) native.created_at = payload.created_at;
    if (payload.updated_at != null) native.updated_at = payload.updated_at;
    const own = tenantDb(trx, context.tenant);
    if (this.entityType === 'workspaces') {
      await own.table('tenants').update({ phone_number: payload.phone ?? null, industry: payload.industry ?? null });
      return { targetEntityType: 'tenants', targetEntityId: context.tenant, matchedExisting: true };
    }
    if (this.entityType === 'checklist_rules') native.is_enabled = false;
    if (this.entityType === 'asset_maintenance_rules') native.is_active = false;
    if (this.entityType === 'time_rules') native.is_active = false;
    if (this.entityType === 'conversation_threads') { native.root_comment_id = id; native.created_by = context.actorUserId; native.is_internal ??= true; native.collaboration_audience ??= native.is_internal ? 'organization_private' : 'requester'; }
    if (this.entityType === 'work_messages') {
      native.user_id ??= context.actorUserId;
      if (!native.thread_id) {
        const parent = native.parent_comment_id ? await own.table('project_task_comments').where({ task_comment_id: native.parent_comment_id }).first('thread_id') : null;
        native.thread_id = parent?.thread_id ?? randomUUID();
        if (!parent) await own.table('comment_threads').insert({ tenant: context.tenant, thread_id: native.thread_id,
          project_task_id: native.task_id, root_comment_id: id, is_internal: true, collaboration_audience: 'organization_private', created_by: context.actorUserId });
      }
    }
    if (this.entityType === 'conversation_files') { native.created_by = context.actorUserId; native.state = payload.state === 'removed' ? 'removed' : 'attached'; native.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); }
    if (this.entityType === 'people') {
      native.username = native.username || `imported-${id}`;
      native.email = native.email || `imported-${id}@invalid`;
      native.hashed_password = randomBytes(64).toString('hex');
      native.is_inactive = true;
      native.user_type = 'internal';
    }
    if (this.entityType === 'work_boards') native.is_default = false;
    if (this.entityType === 'work_statuses') { native.status_type ??= 'ticket'; native.item_type ??= native.status_type; native.order_number ??= 0; }
    if (this.entityType === 'projects') { native.wbs_code = id; native.project_number = `AMP-${id}`; }
    if (this.entityType === 'project_phases') { native.wbs_code = id; native.status ??= 'pending'; native.order_number ??= 0; }
    if (this.entityType === 'project_states') { native.display_order ??= 0; native.is_standard = false; }
    if (this.entityType === 'work_items') native.wbs_code = id;
    if (this.entityType === 'documents') { native.user_id = context.actorUserId; native.created_by = context.actorUserId; }
    if (this.entityType === 'historical_people') { native.actor_tenant = randomUUID(); native.actor_user_id = randomUUID(); }
    if (this.entityType === 'document_folder_rules') {
      const nativeType = Object.entries(DOCUMENT_TARGET_TYPES).reverse().find(([, entity]) => entity === payload.kind)?.[0];
      if (!nativeType) throw new Error('Unsupported document folder rule kind');
      native.entity_type = nativeType;
    }
    if (this.entityType === 'work_activity' || this.entityType === 'handoff_activity') {
      await own.table('ticket_audit_logs').insert({ tenant: context.tenant, audit_id: id, ticket_id: native.ticket_id,
        event_type: payload.kind, entity_type: 'ticket', entity_id: native.ticket_id, actor_type: 'system',
        actor_display_name: payload.actor_name ?? null, actor_organization_name: payload.actor_organization ?? null,
        source: 'migration', occurred_at: payload.occurred_at ?? payload.created_at ?? trx.fn.now(),
        changes: payload.changes == null ? {} : JSON.parse(String(payload.changes)), details: payload.details == null ? { amp_history: payload } : JSON.parse(String(payload.details)) });
      return { targetEntityType: 'ticket_audit_logs', targetEntityId: id };
    }
    if (this.entityType === 'document_links' || this.entityType === 'asset_links') {
      const targetType = String(payload.target_type) as AmpEntityType;
      const target = await context.resolveReference(trx, targetType, String(payload.target_id));
      const nativeType = Object.entries(DOCUMENT_TARGET_TYPES).reverse().find(([, entity]) => entity === targetType)?.[0];
      if (!target || !nativeType) throw new Error('Document association has no supported applied owner');
      native.entity_id = target; native.entity_type = nativeType;
    }
    if (this.entityType === 'time_records' || this.entityType === 'calendar_entries') {
      native.work_item_type = payload.ticket_package_record_id ? 'ticket' : payload.work_item_package_record_id ? 'project_task' : this.entityType === 'calendar_entries' ? 'ad_hoc' : 'non_billable_category';
      if (this.entityType === 'time_records') {
        native.end_time ??= native.start_time;
        native.work_date ??= String(native.start_time).slice(0, 10);
        native.work_timezone ??= 'UTC'; native.billable_duration = 0; native.billing_mode = 'operational'; native.service_id = null;
      } else { native.status = 'cancelled'; native.is_recurring = false; }
    }
    if (this.entityType === 'software') native.normalized_name = String(native.name).trim().toLowerCase();
    if (this.entityType === 'services') native.billing_method = 'fixed';
    if (this.entityType === 'meeting_artifacts') native.provider_artifact_id = `amp-history:${id}`;
    if (this.entityType === 'interactions') native.user_id ??= context.actorUserId;
    if (this.entityType === 'appointments') native.status = 'cancelled';
    if (this.entityType === 'meetings') { native.status = 'ended'; native.provider_meeting_id = null; }
    if (this.entityType === 'workflow_definitions') { native.is_paused = true; native.payload_schema_ref ??= 'payload.Empty.v1'; native.draft_definition ??= {}; }
    // Task responses and task activity are historical business evidence. Recreating execution_id would
    // fabricate a live engine run. Preserve the canonical record in audit storage, with a ledger identity.
    if (this.entityType === 'workflow_tasks' || this.entityType === 'workflow_history') {
      await own.table('audit_logs').insert({ tenant: context.tenant, audit_id: id, user_id: context.actorUserId,
        operation: 'amp_workflow_history_imported', table_name: mapping.table, record_id: id,
        timestamp: payload.updated_at ?? payload.created_at ?? trx.fn.now(), changed_data: {}, details: { amp_entity: this.entityType, amp_record: payload, amp_references: Object.fromEntries(Object.entries(workspaceFields(this.entityType)).filter(([, field]) => field.kind === 'reference').map(([column, field]) => [column, { entityType: field.target, id: native[(mapping.columns as Record<string, string>)[column]] ?? null }])), dispatch: 'paused' } });
      return { targetEntityType: 'audit_logs', targetEntityId: id };
    }
    if (this.entityType === 'files') {
      const attachment = payload.attachment as Record<string, unknown> | undefined;
      if (!attachment) throw new Error('File has no verified AMP attachment');
      const content = await own.table('migration_staged_attachments').where({ migration_job_id: context.migrationJobId, sha256: attachment.sha256 }).first();
      if (!content || Number(content.size) !== Number(attachment.size) || createHash('sha256').update(content.content).digest('hex') !== attachment.sha256) throw new Error('Staged attachment digest or size mismatch');
      const storagePath = `${context.tenant}/amp-imports/${id}`;
      if (!await stageFileUpload(context.tenant, id, storagePath)) throw new Error('AMP files require a recoverable upload transaction');
      const provider = await StorageProviderFactory.createProvider();
      await provider.upload(Readable.from([content.content]), storagePath, { size: Number(content.size), mime_type: String(payload.media_type ?? 'application/octet-stream') });
      native.file_name = id; native.storage_path = storagePath; native.file_size = Number(content.size);
      native.mime_type ??= 'application/octet-stream'; native.uploaded_by_id = context.actorUserId; native.is_deleted = false;
    }
    // A few native catalogs deliberately have no updated_at/created_at. Only transport-declared
    // business columns are inserted; schema metadata is used solely for optional timestamp support.
    const info = await trx(mapping.table).columnInfo();
    if (!info.created_at) delete native.created_at;
    if (!info.updated_at) delete native.updated_at;
    await own.table(mapping.table).insert(native);
    return { targetEntityType: this.targetEntityType, targetEntityId: String(native[mapping.key] ?? id) };
  }
}

export const WORKSPACE_APPLIERS = Object.fromEntries(AMP_WORKSPACE_TABLES.map(entity => [entity, new WorkspaceApplier(entity)])) as Record<AmpWorkspaceEntity, EntityApplier>;
