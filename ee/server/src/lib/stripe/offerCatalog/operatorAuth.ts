import type { NextRequest } from 'next/server';
import { OfferPublishError, type CatalogOperator, type EnvLike } from './types';

/**
 * Catalog writes require the existing Nine Minds platform-operator authority: the caller must
 * belong to MASTER_BILLING_TENANT_ID. `assertMasterTenantAccess` is the only place that proves it
 * (API key of the master tenant, or a master-tenant internal user holding the tenant-management
 * permission). This re-checks the tenant so a ordinary tenant admin can never write the catalog even
 * if a caller forgets the gate.
 */
export function assertCatalogOperator(actor: CatalogOperator | null | undefined, env: EnvLike = process.env): CatalogOperator {
  const master = env.MASTER_BILLING_TENANT_ID;
  if (!master || !actor || !actor.userId || actor.tenantId !== master) {
    throw new OfferPublishError('UNAUTHORIZED', 'Only a Nine Minds platform operator may change the Stripe offer catalog.');
  }
  return actor;
}

// LEVERAGE: friction master-tenant-gate-not-scriptable — assertMasterTenantAccess drags UI/Next modules, so standalone operator scripts (tsx) cannot reuse it; the CLI had to become an HTTP client. A server-free credential check below the gate would let scripts authenticate directly.
/** Operator from an HTTP request, via the shared master-tenant gate. */
export async function operatorFromRequest(request: NextRequest): Promise<CatalogOperator> {
  const { assertMasterTenantAccess } = await import('../../auth/masterTenantAccess');
  const caller = await assertMasterTenantAccess(request);
  return assertCatalogOperator({ tenantId: caller.tenantId, userId: caller.userEmail || caller.userId });
}
