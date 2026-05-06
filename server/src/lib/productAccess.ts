import { getSession } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';
import {
  ProductCode,
  resolveProductCode,
} from '@alga-psa/types';

/**
 * Product access gates one dimension of authorization.
 * Callers are expected to combine this with RBAC, tier, and add-on checks.
 */
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

function resolveProductOrThrow(rawProductCode: string | null | undefined, capability: string): ProductCode {
  const resolved = resolveProductCode(rawProductCode);
  if (resolved.isMisconfigured) {
    throw new ProductAccessError(
      capability,
      rawProductCode ?? null,
      `Unknown tenant product_code "${rawProductCode}" for capability "${capability}"`,
    );
  }

  return resolved.productCode;
}

export async function getTenantProduct(tenantId: string): Promise<ProductCode> {
  const knex = await getAdminConnection();
  const row = await knex('tenants')
    .where({ tenant: tenantId })
    .select('product_code')
    .first();

  return resolveProductOrThrow(row?.product_code, 'tenant_product_resolution');
}

export async function getCurrentTenantProduct(): Promise<ProductCode> {
  const session = await getSession();
  const tenantId = session?.user?.tenant;

  if (!tenantId) {
    return 'psa';
  }

  return getTenantProduct(tenantId);
}

export function assertProductAccess(input: {
  capability: string;
  productCode: string | null | undefined;
  allowedProducts: readonly ProductCode[];
}): ProductCode {
  const productCode = resolveProductOrThrow(input.productCode, input.capability);

  if (!input.allowedProducts.includes(productCode)) {
    throw new ProductAccessError(input.capability, productCode);
  }

  return productCode;
}

export async function assertTenantProductAccess(input: {
  tenantId: string;
  capability: string;
  allowedProducts: readonly ProductCode[];
}): Promise<ProductCode> {
  const productCode = await getTenantProduct(input.tenantId);
  return assertProductAccess({
    capability: input.capability,
    productCode,
    allowedProducts: input.allowedProducts,
  });
}
