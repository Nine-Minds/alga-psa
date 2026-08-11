import { runInboundEmailRecoveryForTenant } from '@alga-psa/shared/services/email/inboundEmailRecovery';

export interface InboundEmailRecoveryHandlerInput {
  tenantId?: string;
  limit?: number;
}

/**
 * Per-tenant inbound email recovery handler used by the EE Temporal maintenance
 * fanout (packages/jobs MAINTENANCE_JOBS). CE uses the server-local pg-boss
 * handler with the same shared implementation.
 */
export async function inboundEmailRecoveryHandler(input: InboundEmailRecoveryHandlerInput): Promise<{
  success: boolean;
  tenantId?: string;
  result?: { swept: unknown; mirrored: number; backfilled: number };
}> {
  if (!input?.tenantId) {
    // The fanout iterates tenants itself; a missing tenantId is a no-op.
    return { success: true };
  }
  const result = await runInboundEmailRecoveryForTenant(input.tenantId, input.limit);
  return { success: true, tenantId: input.tenantId, result };
}
