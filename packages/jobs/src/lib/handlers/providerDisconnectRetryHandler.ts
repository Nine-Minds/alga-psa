import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import {
  listDueDisconnectRecords,
  disconnectProvider,
  PROVIDER_TYPES,
} from '@alga-psa/integrations/lib/providerDisconnect';

export interface ProviderDisconnectRetryHandlerInput {
  tenantId?: string;
}

/**
 * Retries any pending provider disconnects for a tenant whose retry window has
 * arrived. Used by both the CE pg-boss per-tenant schedule and the EE Temporal
 * maintenance fan-out (see MAINTENANCE_JOBS). Idempotent: a tenant with no due
 * records is a cheap no-op.
 */
export async function providerDisconnectRetryHandler(
  input: ProviderDisconnectRetryHandlerInput,
): Promise<{
  success: boolean;
  tenantId?: string;
  retried: number;
  results?: Array<{ provider: string; status: string }>;
}> {
  if (!input?.tenantId) {
    return { success: true, retried: 0 };
  }

  const { knex } = await createTenantKnex(input.tenantId);
  const due = await listDueDisconnectRecords(knex, input.tenantId).catch((error) => {
    logger.warn('[providerDisconnect] Retry scan failed; leaving records untouched', {
      tenantId: input.tenantId,
      error: error instanceof Error ? error.message : error,
    });
    return [];
  });

  const results: Array<{ provider: string; status: string }> = [];
  for (const provider of PROVIDER_TYPES) {
    if (!due.some((record) => record.provider === provider)) {
      continue;
    }
    try {
      const result = await disconnectProvider(knex, input.tenantId, provider, {
        userId: 'system',
        fromRetry: true,
      });
      results.push({ provider, status: result.status });
      logger.info('[providerDisconnect] Retry pass finished for provider', {
        tenantId: input.tenantId,
        provider,
        status: result.status,
      });
    } catch (error) {
      logger.warn('[providerDisconnect] Retry pass crashed for provider; record stays pending', {
        tenantId: input.tenantId,
        provider,
        error: error instanceof Error ? error.message : error,
      });
      results.push({ provider, status: 'retry_error' });
    }
  }

  return { success: true, tenantId: input.tenantId, retried: results.length, results };
}
