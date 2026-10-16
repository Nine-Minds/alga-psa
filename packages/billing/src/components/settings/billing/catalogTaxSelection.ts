'use client';

/**
 * Catalog create-form tax selection sentinels.
 *
 * The create contract distinguishes three states that a plain `string | null`
 * collapses:
 *  - inherit (`undefined`): omit the field and let the server resolve the
 *    tenant default;
 *  - non-taxable (`null`): explicitly send null;
 *  - override: an explicit tax rate id.
 */
export const INHERIT_TAX_RATE_VALUE = '__inherit_tenant_default__';
export const NON_TAXABLE_VALUE = '__non_taxable__';

export type CatalogTaxSelection = string | null | undefined;

export function toTaxRateSelectionValue(taxRateId: CatalogTaxSelection): string {
  if (taxRateId === undefined) return INHERIT_TAX_RATE_VALUE;
  if (taxRateId === null) return NON_TAXABLE_VALUE;
  return taxRateId;
}

export function fromTaxRateSelectionValue(value: string): CatalogTaxSelection {
  if (value === INHERIT_TAX_RATE_VALUE) return undefined;
  if (value === NON_TAXABLE_VALUE) return null;
  return value;
}

/** Build the create payload field, preserving omission for inheritance. */
export function toTaxRateCreateField(
  taxRateId: CatalogTaxSelection
): { tax_rate_id?: string | null } {
  if (taxRateId === undefined) return {};
  return { tax_rate_id: taxRateId };
}
