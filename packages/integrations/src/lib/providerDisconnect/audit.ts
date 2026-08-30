import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import type { ProviderType } from './types';

export type DisconnectAuditOperation =
  | 'disconnect_started'
  | 'disconnect_target_revoked'
  | 'disconnect_target_failed'
  | 'disconnect_retry_started'
  | 'disconnect_retry_budget_exhausted'
  | 'disconnect_finalized'
  | 'disconnect_force_finalized';

interface DisconnectAuditParams {
  knex: Knex;
  tenantId: string;
  provider: ProviderType;
  operation: DisconnectAuditOperation;
  /** Realm id, connection id, or the synthetic Xero grant target id. */
  targetId: string | null;
  /** Sanitized outcome, e.g. 'revoked' | 'transient_failure' | 'permanent_failure'. */
  result?: string;
  attemptCount?: number;
  correlationId?: string | null;
  userId?: string | null;
  reason?: string | null;
}

/**
 * Writes a disconnect audit row to `audit_logs`. The row is scoped to the
 * tenant via the `app.current_tenant` GUC (set inside the transaction) so the
 * trigger stamps the right tenant. Never records tokens or raw provider
 * response bodies — only sanitized outcome classes and ids.
 */
export async function writeDisconnectAudit(params: DisconnectAuditParams): Promise<void> {
  try {
    await params.knex.transaction(async (trx) => {
      await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', params.tenantId]);
      await trx.raw('select set_config(?, ?, true)', ['app.current_user', params.userId ?? 'system']);

      const details: Record<string, unknown> = {
        provider: params.provider,
        target_id: params.targetId ?? null,
        result: params.result ?? null,
        attempt_count: params.attemptCount ?? null,
        correlation_id: params.correlationId ?? null,
        reason: params.reason ?? null,
      };

      await tenantDb(trx, params.tenantId).table('audit_logs').insert({
        audit_id: uuidv4(),
        user_id: params.userId ?? null,
        operation: params.operation,
        table_name: 'provider_disconnect_records',
        record_id: params.correlationId ?? `${params.tenantId}:${params.provider}`,
        changed_data: {},
        details,
        timestamp: new Date().toISOString(),
      });
    });
  } catch (error) {
    // Audit is best-effort: a failed audit write must not fail the disconnect
    // itself, but it should be loud so it gets fixed.
    logger.error('[providerDisconnect] Failed to write disconnect audit row', {
      tenantId: params.tenantId,
      provider: params.provider,
      operation: params.operation,
      error: error instanceof Error ? error.message : error,
    });
  }
}
