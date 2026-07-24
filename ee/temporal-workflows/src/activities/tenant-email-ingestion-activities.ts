import { getAdminConnection } from '@alga-psa/db/admin.js';
import { tenantDb } from '@alga-psa/db';
import { EmailProviderLifecycleService } from '@alga-psa/shared/services/email/EmailProviderLifecycleService.js';

export interface TenantEmailIngestionActivityResult {
  matchedCount: number;
  completedCount: number;
  errorCount: number;
}

/**
 * Pause all currently ingestable providers. Per-provider and query failures are
 * contained so email cleanup can never strand the deletion workflow.
 */
export async function suspendTenantEmailIngestion(
  tenantId: string
): Promise<TenantEmailIngestionActivityResult> {
  try {
    const knex = await getAdminConnection();
    const providers = await tenantDb(knex, tenantId).table('email_providers')
      .where({ is_active: true })
      .whereNull('inbound_paused_at')
      .select('id');
    const lifecycle = new EmailProviderLifecycleService();
    let completedCount = 0;
    let errorCount = 0;

    for (const provider of providers) {
      try {
        if (await lifecycle.pauseProvider(provider.id, tenantId, 'tenant_cancelled')) {
          completedCount += 1;
        }
      } catch (error) {
        errorCount += 1;
        console.warn('[TenantDeletion] Failed to suspend email provider', {
          tenantId,
          providerId: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { matchedCount: providers.length, completedCount, errorCount };
  } catch (error) {
    console.error('[TenantDeletion] Failed to query providers for email suspension', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { matchedCount: 0, completedCount: 0, errorCount: 1 };
  }
}

/**
 * Resume only cancellation-owned pauses. Manual pauses are never selected.
 * Per-provider registration failures are contained, but query/connection
 * failures propagate so Temporal retries them — silently returning here
 * would strand every provider paused after a successful rollback.
 */
export async function resumeTenantEmailIngestion(
  tenantId: string
): Promise<TenantEmailIngestionActivityResult> {
  const knex = await getAdminConnection();
  const providers = await tenantDb(knex, tenantId).table('email_providers')
    .where({ inbound_pause_reason: 'tenant_cancelled' })
    .whereNotNull('inbound_paused_at')
    .select('id');
  const lifecycle = new EmailProviderLifecycleService();
  let completedCount = 0;
  let errorCount = 0;

  for (const provider of providers) {
    try {
      const result = await lifecycle.resumeProvider(provider.id, tenantId);
      if (result.resumed) completedCount += 1;
      if (result.error) errorCount += 1;
    } catch (error) {
      errorCount += 1;
      console.warn('[TenantDeletion] Failed to resume email provider', {
        tenantId,
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { matchedCount: providers.length, completedCount, errorCount };
}

/**
 * Final idempotent cleanup for workflows that predate the suspension step or
 * whose original remote teardown failed.
 */
export async function teardownTenantEmailIngestion(
  tenantId: string
): Promise<TenantEmailIngestionActivityResult> {
  try {
    const knex = await getAdminConnection();
    const providers = await tenantDb(knex, tenantId).table('email_providers').select('id');
    const lifecycle = new EmailProviderLifecycleService();
    let completedCount = 0;
    let errorCount = 0;

    for (const provider of providers) {
      try {
        await lifecycle.teardownProviderSubscriptions(provider.id, tenantId);
        completedCount += 1;
      } catch (error) {
        errorCount += 1;
        console.warn('[TenantDeletion] Failed final email subscription teardown', {
          tenantId,
          providerId: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { matchedCount: providers.length, completedCount, errorCount };
  } catch (error) {
    console.error('[TenantDeletion] Failed to query providers for final email teardown', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { matchedCount: 0, completedCount: 0, errorCount: 1 };
  }
}
