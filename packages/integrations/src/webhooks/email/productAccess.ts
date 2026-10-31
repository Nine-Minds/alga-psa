import type { ProductCode } from '@alga-psa/types';

// Products whose workspaces receive inbound email. A new product code is rejected until it is
// listed here; co_managed workspaces send customer mail notifications whose replies must be accepted.
const EMAIL_INBOUND_PRODUCT_CODES: ReadonlySet<string> = new Set<ProductCode>(['psa', 'algadesk', 'co_managed']);

/** A missing product code is a legacy psa tenant. */
export function isEmailInboundProductCode(productCode: unknown): boolean {
  return EMAIL_INBOUND_PRODUCT_CODES.has(typeof productCode === 'string' ? productCode : 'psa');
}
