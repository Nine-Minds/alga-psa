/**
 * CE stub for the tenant-management workflow client.
 *
 * The real implementation lives in ee/server/src/lib/tenant-management/workflowClient.ts
 * and is wired in at build time via the @ee webpack alias in EE mode. This stub
 * satisfies the type checker for server/src consumers (mobile IAP + account routes)
 * in CE, where Temporal-backed tenant workflows aren't available.
 */

export type TenantWorkflowClientResult = {
  available: boolean;
  result?: Promise<{
    success: boolean;
    tenantId?: string;
    adminUserId?: string;
    error?: string;
  }>;
  error?: string;
};

export type TenantDeletionClientResult = {
  available: boolean;
  workflowId?: string;
  error?: string;
};

const CE_UNAVAILABLE =
  'Tenant workflow client is only available in Enterprise Edition for hosted deployments.';

export async function startTenantCreationWorkflow(
  _input: Record<string, unknown>,
): Promise<TenantWorkflowClientResult> {
  return { available: false, error: CE_UNAVAILABLE };
}

export async function startTenantDeletionWorkflow(
  _input: Record<string, unknown>,
): Promise<TenantDeletionClientResult> {
  return { available: false, error: CE_UNAVAILABLE };
}
