import { finalizeAmpContent } from './contentReferences';
import { WORKSPACE_MAPPING } from '../workspaceMapping';
import { randomUUID } from 'node:crypto';
import { DOCUMENT_TARGET_TYPES } from '../workspaceExport';
import { withFileUploadTransaction } from '@alga-psa/storage/fileUploadTransaction';
import { applyQuietCore } from './quietCoreApplier';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { AMP_WORKSPACE_TABLES, AMP_ENTITY_REFERENCES, workspaceFields, orderAmpRecords, type AmpEntityType } from '@alga-psa/migration-spec';
import { MigrationLedger } from '../MigrationLedger';
import { parseConfiguration, migrationTargetPolicies } from '../types';
import { MIGRATION_PHASE_ORDER } from '../types';
import { ApplierContext } from './context';
import { WORKSPACE_APPLIERS } from './workspaceAppliers';
import type { EntityApplier } from './entityAppliers';

const APPLY_BATCH_SIZE = 25;

export interface ApplyRunResult {
  cancelled: boolean;
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Applies staged records in dependency order with bounded per-batch
 * transactions. The retry contract: every target mutation commits in the same
 * transaction as its outcome row and identity mapping, so a worker killed
 * mid-apply resumes without double-writing — already-applied records are
 * skipped through the ledger on the next attempt. Cancellation is honored at
 * batch checkpoints; no transaction is ever held across the package.
 */
export class MigrationDomainApplier {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async applyJob(migrationJobId: string, actorUserId: string): Promise<ApplyRunResult> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db.table('migration_jobs').where({ migration_job_id: migrationJobId }).first();
    if (!job) {
      throw new Error(`Migration job ${migrationJobId} was not found in this tenant`);
    }

    const workspace = await db.table('migration_staged_records').where({ migration_job_id: migrationJobId }).whereIn('entity_type', AMP_WORKSPACE_TABLES).first();
    const targetPolicies = migrationTargetPolicies(job);
    if (workspace && !targetPolicies) throw new Error('Workspace safety policies cannot be disabled');
    const ledger = new MigrationLedger(this.tenant);
    const attempt = (await ledger.latestAttempt(this.knex, migrationJobId)) + 1;
    const context = new ApplierContext(
      this.tenant,
      migrationJobId,
      attempt,
      actorUserId,
      parseConfiguration(job.configuration),
      ledger,
      targetPolicies
    );

    const totals: ApplyRunResult = { cancelled: false, created: 0, skipped: 0, failed: 0 };

    for (const entityType of MIGRATION_PHASE_ORDER) {
      const hasRecords = await db
        .table('migration_staged_records')
        .where({ migration_job_id: migrationJobId, entity_type: entityType })
        .first();
      if (!hasRecords) {
        continue;
      }

      await this.setEntityState(migrationJobId, entityType, 'applying');
      const cancelled = await this.applyEntity(migrationJobId, entityType, context, totals);
      if (cancelled) {
        await this.setEntityState(migrationJobId, entityType, 'cancelled');
        totals.cancelled = true;
        return totals;
      }
      await this.setEntityState(migrationJobId, entityType, 'completed');
    }

    if (!totals.failed && !totals.cancelled) {
      await this.finalizeDeferredReferences(context);
      await this.bindAttachmentOwners(migrationJobId, context);
      await finalizeAmpContent(this.knex, context);
      await db.table('migration_staged_attachments').where({ migration_job_id: migrationJobId }).delete();
    }
    return totals;
  }

  private async finalizeDeferredReferences(context: ApplierContext): Promise<void> {
    for (const entity of AMP_WORKSPACE_TABLES) {
      const deferred = Object.entries(workspaceFields(entity)).filter(([, field]) => field.deferred);
      if (!deferred.length) continue;
      const records = await tenantDb(this.knex, this.tenant).table('migration_staged_records').where({ migration_job_id: context.migrationJobId, entity_type: entity });
      for (const staged of records) await withTransaction(this.knex, async trx => {
        const payload = typeof staged.payload === 'string' ? JSON.parse(staged.payload) : staged.payload;
        const id = await context.resolveReference(trx, entity, staged.package_record_id);
        if (!id) throw new Error('Deferred-reference owner has not been applied');
        const update: Record<string, unknown> = {};
        const mapping = WORKSPACE_MAPPING[entity];
        for (const [column, field] of deferred) {
          if (payload[column] == null) continue;
          const target = await context.resolveReference(trx, field.target as AmpEntityType, payload[column]);
          if (!target) throw new Error('Deferred reference has not been applied');
          update[(mapping.columns as Record<string, string>)[column]] = target;
        }
        if (Object.keys(update).length) await tenantDb(trx, this.tenant).table(mapping.table).where({ [mapping.key]: id }).update(update);
      });
    }
  }

  private async bindAttachmentOwners(jobId: string, context: ApplierContext): Promise<void> {
    const records = await tenantDb(this.knex, this.tenant).table('migration_staged_records')
      .where({ migration_job_id: jobId, entity_type: 'attachment_links' });
    for (const staged of records) {
      await withTransaction(this.knex, async trx => {
        const payload = typeof staged.payload === 'string' ? JSON.parse(staged.payload) : staged.payload;
        const key = { namespace: staged.namespace, entityType: 'attachment_links', sourceRecordId: staged.source_record_id };
        if (await context.ledger.findMapping(trx, key)) return;
        const file = await context.resolveReference(trx, 'files', payload.file_package_record_id);
        const owner = await context.resolveReference(trx, payload.attachmentOwner.entityType, payload.attachmentOwner.packageRecordId);
        if (!file || !owner) throw new Error('Attachment owner or file has not been applied');
        const own = tenantDb(trx, this.tenant);
        let documentId = owner;
        const document = payload.attachmentOwner.entityType === 'documents' ? await own.table('documents').where({ document_id: owner }).forUpdate().first() : undefined;
        if (document && (!document.file_id || document.file_id === file)) {
          await own.table('documents').where({ document_id: owner }).update({ file_id: file });
        } else {
          documentId = randomUUID();
          await own.table('documents').insert({ tenant: this.tenant, document_id: documentId, document_name: payload.name, user_id: context.actorUserId, created_by: context.actorUserId, file_id: file, mime_type: payload.media_type });
          if (payload.attachmentOwner.entityType === 'ticket_comments') {
            const comment = await own.table('comments').where({ comment_id: owner }).first('ticket_id');
            if (!comment) throw new Error('Conversation attachment has no applied ticket');
            await own.table('ticket_comment_attachments').insert({ tenant: this.tenant, attachment_id: randomUUID(), ticket_id: comment.ticket_id, comment_id: owner, document_id: documentId, created_by: context.actorUserId, state: 'attached', expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) });
          }
          const nativeType = Object.entries(DOCUMENT_TARGET_TYPES).reverse().find(([, entity]) => entity === payload.attachmentOwner.entityType)?.[0] ?? payload.attachmentOwner.entityType;
          await own.table('document_associations').insert({ tenant: this.tenant, association_id: randomUUID(), document_id: documentId, entity_type: nativeType, entity_id: owner });
        }
        await context.ledger.recordCreation(trx, key, { migrationJobId: jobId, migrationStagedRecordId: staged.migration_staged_record_id,
          attempt: context.attempt, action: 'created', targetEntityType: 'documents', targetEntityId: documentId });
      });
    }
  }

  private async applyEntity(
    migrationJobId: string,
    entityType: AmpEntityType,
    context: ApplierContext,
    totals: ApplyRunResult
  ): Promise<boolean> {
    const workspaceApplier = (WORKSPACE_APPLIERS as Partial<Record<AmpEntityType, EntityApplier>>)[entityType];
    let lastPackageRecordId = '';
    const selfColumns = AMP_ENTITY_REFERENCES[entityType].filter(edge => edge.targetTable === entityType).map(edge => edge.column);
    const unordered = selfColumns.length ? await tenantDb(this.knex, this.tenant).table('migration_staged_records').where({ migration_job_id: migrationJobId, entity_type: entityType, validation_state: 'valid' }) : [];
    const selfOrdered = selfColumns.length ? orderAmpRecords(unordered.map(row => ({ ...row, ...(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) })), selfColumns) : undefined;
    let selfOffset = 0;

    for (;;) {
      if (await this.cancelRequested(migrationJobId)) {
        return true;
      }

      const db = tenantDb(this.knex, this.tenant);
      const batch = selfOrdered ? selfOrdered.slice(selfOffset, selfOffset += APPLY_BATCH_SIZE) : await db
        .table('migration_staged_records')
        .where({
          migration_job_id: migrationJobId,
          entity_type: entityType,
          validation_state: 'valid',
        })
        .where('package_record_id', '>', lastPackageRecordId)
        .orderBy('package_record_id')
        .limit(APPLY_BATCH_SIZE);

      if (batch.length === 0) {
        return false;
      }
      lastPackageRecordId = batch[batch.length - 1].package_record_id;

      const counters = { created: 0, skipped: 0, failed: 0 };

      for (const staged of batch) {
        let retainedFileId: string | undefined;
        const applyRecord = async (trx: Knex.Transaction) => {
          // Historical audit tables still derive tenant from a transaction-local GUC.
          await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [this.tenant]);
          await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`amp-apply:${this.tenant}:${migrationJobId}`]);
          const payload =
            typeof staged.payload === 'string' ? JSON.parse(staged.payload) : staged.payload;
          const identityKey = {
            namespace: staged.namespace,
            entityType,
            sourceRecordId: staged.source_record_id,
          };

          const existing = await context.ledger.findMapping(trx, identityKey);
          if (existing) {
            await context.ledger.recordOutcome(trx, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: 'skipped',
              targetEntityType: existing.targetEntityType,
              targetEntityId: existing.targetEntityId,
            });
            counters.skipped += 1;
            return;
          }

          try {
            const customFieldValues = typeof staged.custom_field_values === 'string'
              ? JSON.parse(staged.custom_field_values)
              : staged.custom_field_values ?? {};
            const quiet = context.targetPolicies?.pauseDispatch && ['organizations', 'locations', 'contacts', 'tickets', 'ticket_comments', 'assets'].includes(entityType);
            // A savepoint rolls back partial domain writes and clears a failed SQL transaction before
            // recording a failure outcome. It also prevents orphan threads on application errors.
            const applied = await trx.transaction(async savepoint => {
              if (quiet) return applyQuietCore(savepoint, context, entityType, payload, customFieldValues);
              const applier = workspaceApplier ?? (await import('./entityAppliers')).ENTITY_APPLIERS[entityType];
              return applier.apply(savepoint, context, payload, { customFieldValues });
            });
            await context.ledger.recordCreation(trx, identityKey, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: applied.matchedExisting ? 'skipped' : 'created',
              targetEntityType: applied.targetEntityType,
              targetEntityId: applied.targetEntityId,
              warnings: applied.warnings,
            });
            if (entityType === 'files') retainedFileId = applied.targetEntityId;
            if (applied.matchedExisting) counters.skipped += 1;
            else counters.created += 1;
          } catch (error) {
            await context.ledger.recordOutcome(trx, {
              migrationJobId,
              migrationStagedRecordId: staged.migration_staged_record_id,
              attempt: context.attempt,
              action: 'failed',
              errors: [(error as Error).message],
            });
            counters.failed += 1;
          }
        };
        if (entityType === 'files') {
          await withFileUploadTransaction(this.knex, this.tenant, async trx => {
            await applyRecord(trx);
            return { value: undefined, fileIds: retainedFileId ? [retainedFileId] : [] };
          });
        } else await withTransaction(this.knex, applyRecord);
      }
      await withTransaction(this.knex, async (trx) => {
        const tx = tenantDb(trx, this.tenant);
        await tx
          .table('migration_job_entities')
          .where({ migration_job_id: migrationJobId, entity_type: entityType })
          .update({
            applied_count: this.knex.raw('applied_count + ?', [counters.created]),
            skipped_count: this.knex.raw('skipped_count + ?', [counters.skipped]),
            failed_count: this.knex.raw('failed_count + ?', [counters.failed]),
            updated_at: trx.fn.now(),
          });
      });

      totals.created += counters.created;
      totals.skipped += counters.skipped;
      totals.failed += counters.failed;
    }
  }

  private async cancelRequested(migrationJobId: string): Promise<boolean> {
    const db = tenantDb(this.knex, this.tenant);
    const job = await db
      .table('migration_jobs')
      .where({ migration_job_id: migrationJobId })
      .select('cancel_requested_at')
      .first();
    return Boolean(job?.cancel_requested_at);
  }

  private async setEntityState(
    migrationJobId: string,
    entityType: AmpEntityType,
    state: string
  ): Promise<void> {
    const db = tenantDb(this.knex, this.tenant);
    await db
      .table('migration_job_entities')
      .where({ migration_job_id: migrationJobId, entity_type: entityType })
      .update({ state, updated_at: this.knex.fn.now() });
  }
}
