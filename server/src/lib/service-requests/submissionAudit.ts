/**
 * Service request submission audit writer.
 *
 * Submission lifecycle events — creation and execution-state transitions — are
 * recorded through the shared audit_logs infrastructure so both portal and MSP
 * detail surfaces can show a durable, actor-attributed history for every
 * destination mode (store-only and ticket-only alike). It mirrors the
 * accounting audit writer (packages/db/src/lib/accountingAudit.ts): the row is
 * written inside a transaction with the `app.current_tenant` GUC set (the
 * auditLog helper skips inserts when the GUC is unset).
 *
 * Audit writes are best-effort: the immutable submission row is the durable
 * record, so a failed audit insert is logged and swallowed rather than failing
 * or rolling back the submission itself.
 */

import type { Knex } from 'knex';
import { auditLog } from '@alga-psa/db';

export type ServiceRequestSubmissionAuditOperation =
  | 'service_request_submission_created'
  | 'service_request_submission_execution_succeeded'
  | 'service_request_submission_execution_failed';

export interface ServiceRequestSubmissionAuditParams {
  submissionId: string;
  /** Acting user (the requester for portal submissions). */
  userId?: string | null;
  /** Column-level state captured by this event (e.g. execution_status). */
  changedData?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export async function recordServiceRequestSubmissionAudit(
  knex: Knex,
  tenant: string,
  operation: ServiceRequestSubmissionAuditOperation,
  params: ServiceRequestSubmissionAuditParams
): Promise<void> {
  try {
    await knex.transaction(async (trx) => {
      await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
      await auditLog(trx, {
        userId: params.userId ?? undefined,
        operation,
        tableName: 'service_request_submissions',
        recordId: params.submissionId,
        changedData: params.changedData ?? {},
        details: {
          tenant,
          ...params.details,
        },
      });
    });
  } catch (error) {
    console.error('Failed to record service request submission audit event:', error);
  }
}
