import { resolveProductCode } from '@alga-psa/types';
import { loadProductPrincipal, type ProductPrincipalRef } from './productPrincipal';
import { surfaceAllowsCapability } from './productSurfaceKinds';

// LEVERAGE: pattern product-access-error-twice — this class and server/src/lib/productAccess.ts's ProductAccessError are the same shape; the guards in both files now also share one principal read (productPrincipal.ts) and could share one error and one assertion.
export class ProductAccessError extends Error {
  public readonly status = 403;
  public readonly code = 'PRODUCT_ACCESS_DENIED';
  public readonly capability: string;
  public readonly productCode: string | null;

  constructor(capability: string, productCode: string | null, message?: string) {
    super(message ?? `Product access denied for capability "${capability}"`);
    this.name = 'ProductAccessError';
    this.capability = capability;
    this.productCode = productCode;
  }
}

/**
 * Refuses a principal outside the PSA product, and a principal of a kind whose surface does not reach the
 * capability. Pass the tenant alone where no user is in play (a tenant-level job); pass the principal
 * wherever a signed-in user is, so a user of a closed kind cannot reach, through an action, what its
 * hidden routes protect. Both are decided by the product surface registry's data.
 */
export async function assertPsaOnlyTenantAccess(principal: string | ProductPrincipalRef, capability: string): Promise<void> {
  const ref: ProductPrincipalRef = typeof principal === 'string' ? { tenantId: principal } : principal;
  const { rawProductCode, surfaceKind } = await loadProductPrincipal(ref);
  const resolved = resolveProductCode(rawProductCode);
  if (resolved.isMisconfigured || resolved.productCode !== 'psa') {
    throw new ProductAccessError(capability, rawProductCode ?? null);
  }
  if (surfaceKind && !surfaceAllowsCapability(surfaceKind, capability)) {
    throw new ProductAccessError(capability, resolved.productCode);
  }
}
