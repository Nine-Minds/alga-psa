/**
 * Service request submission audit writer.
 *
 * Submission lifecycle events — creation and execution-state transitions — are
 * recorded through the shared audit_logs infrastructure so both portal and MSP
 * detail surfaces can show a durable, actor-attributed history for every
 * destination mode (store-only and ticket-only alike). It mirrors the
 * accounting audit writer (packages/db/src/lib/accountingAudit.ts): the row is
 * written inside a transaction with the `app.current_tenant` GUC set (the
 * auditLog helper skips inserts when the GUC is unset; setting it here in the
 * same transaction makes that skip path unreachable).
 *
 * Audit writes are mandatory, not best-effort: callers pass the transaction
 * that carries the submission write itself, so a failed audit insert
 * propagates and rolls back the enclosing write. A stored submission can
 * therefore never exist without its durable audit history.
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

/**
 * Writes one audit event. When `knex` is already a transaction the inner
 * `knex.transaction` call becomes a savepoint, so the event joins the caller's
 * transaction and a failure rolls the whole write back. Throws on failure —
 * never swallow this from a submission write path.
 */
export async function recordServiceRequestSubmissionAudit(
  knex: Knex,
  tenant: string,
  operation: ServiceRequestSubmissionAuditOperation,
  params: ServiceRequestSubmissionAuditParams
): Promise<void> {
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
}
