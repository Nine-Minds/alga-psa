/**
 * Typed errors thrown by the vendor and vendor price list cores. The kind says
 * what happened by meaning (the REST service maps it to 404/400/409); the code
 * says which rule fired (each server action maps it to its translated message).
 */
export type VendorCoreErrorKind = 'not_found' | 'validation' | 'conflict';

export type VendorCoreErrorCode =
  | 'vendor_not_found'
  | 'product_not_found'
  | 'vendor_product_not_found'
  | 'name_required'
  | 'duplicate_name'
  | 'has_open_purchase_orders'
  | 'vendor_and_product_required'
  | 'unit_cost_invalid';

export class VendorCoreError extends Error {
  readonly name = 'VendorCoreError';

  constructor(
    readonly kind: VendorCoreErrorKind,
    readonly code: VendorCoreErrorCode,
    message: string,
    /** Message parameters, e.g. the clashing vendor name; also the field path for validation errors. */
    readonly details: { name?: string; existing_vendor_id?: string; existing_vendor_name?: string; field?: string } = {},
  ) {
    super(message);
  }
}

export function isVendorCoreError(error: unknown): error is VendorCoreError {
  return error instanceof VendorCoreError;
}
