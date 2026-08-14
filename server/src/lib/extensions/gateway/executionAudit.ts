import { randomUUID } from 'node:crypto';

import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

export type ExtensionExecutionOutcome = 'ok' | 'error' | 'timeout' | 'policy_denied';

export interface StartExtensionExecutionInput {
  tenantId: string;
  registryId: string;
  versionId: string;
  requestId: string;
  method: string;
  path: string;
  endpointTemplate: string;
  principalKind: string;
  userId: string;
}

export interface FinishExtensionExecutionInput {
  outcome: ExtensionExecutionOutcome;
  status?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Insert the durable pre-dispatch audit row for a forwarded extension
 * execution. Metrics are redacted: method, normalized path, matched endpoint
 * template, principal kind, and user ID only. No bodies, headers, config,
 * providers, or secrets are ever written.
 *
 * A failed insert must deny dispatch (the caller treats this as
 * `access_policy_unavailable`); no secret-bearing install config may be read
 * or forwarded without this row.
 */
export async function startExtensionExecution(input: StartExtensionExecutionInput): Promise<string> {
  const logId = randomUUID();
  const knex = await getAdminConnection();
  await tenantDb(knex, input.tenantId).table('extension_execution_log').insert({
    id: logId,
    tenant_id: input.tenantId,
    registry_id: input.registryId,
    version_id: input.versionId,
    request_id: input.requestId,
    started_at: knex.fn.now(),
    status: 'started',
    metrics: {
      method: input.method,
      path: input.path,
      endpoint_template: input.endpointTemplate,
      principal_kind: input.principalKind,
      user_id: input.userId,
    },
  });
  return logId;
}

/**
 * Mark a pre-dispatch execution row as finished with a terminal outcome.
 * Updates cannot undo a completed external execution, so failures here are
 * logged loudly but never thrown to the caller.
 */
export async function finishExtensionExecution(
  logId: string,
  tenantId: string,
  input: FinishExtensionExecutionInput,
): Promise<void> {
  try {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenantId);
    const metricsPatch: Record<string, number> = {};
    if (typeof input.status === 'number') {
      metricsPatch.http_status = input.status;
    }
    if (typeof input.durationMs === 'number') {
      metricsPatch.duration_ms = input.durationMs;
    }
    await db.table('extension_execution_log')
      .where({ id: logId })
      .update({
        finished_at: knex.fn.now(),
        status: input.outcome,
        error: input.error ?? null,
        metrics: knex.raw('coalesce(metrics, \'{}\'::jsonb) || ?::jsonb', [
          JSON.stringify(metricsPatch),
        ]),
      });
  } catch (error) {
    console.error('[executionAudit] failed to finish extension execution record', {
      logId,
      tenantId,
      outcome: input.outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
