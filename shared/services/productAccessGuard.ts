import { getAdminConnection } from '@alga-psa/db/admin';
import { resolveProductCode } from '@alga-psa/types';

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

export async function assertPsaOnlyTenantAccess(tenantId: string, capability: string): Promise<void> {
  const admin = await getAdminConnection();
  const row = await admin('tenants').where({ tenant: tenantId }).select('product_code').first();
  const resolved = resolveProductCode(row?.product_code);
  if (resolved.isMisconfigured || resolved.productCode !== 'psa') {
    throw new ProductAccessError(capability, row?.product_code ?? null);
  }
}
