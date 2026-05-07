/**
 * Product entitlement constants and helpers.
 *
 * Product is orthogonal to plan/tier and controls the application surface.
 */
export const PRODUCT_CODES = ['psa', 'algadesk'] as const;

export type ProductCode = (typeof PRODUCT_CODES)[number];

export function isValidProductCode(value: unknown): value is ProductCode {
  return typeof value === 'string' && PRODUCT_CODES.includes(value as ProductCode);
}

export interface ResolvedProductCode {
  productCode: ProductCode;
  isMisconfigured: boolean;
}

/**
 * Resolve persisted product_code into a safe runtime value.
 * - null/undefined => 'psa' for backward compatibility.
 * - valid values => returned as-is.
 * - unknown non-null values => 'psa' + isMisconfigured=true.
 */
export function resolveProductCode(value: string | null | undefined): ResolvedProductCode {
  if (value == null) {
    return { productCode: 'psa', isMisconfigured: false };
  }

  if (isValidProductCode(value)) {
    return { productCode: value, isMisconfigured: false };
  }

  return { productCode: 'psa', isMisconfigured: true };
}
