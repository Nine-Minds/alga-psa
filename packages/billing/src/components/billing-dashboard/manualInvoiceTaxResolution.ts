/**
 * Resolves the tax treatment a manual invoice row should show when it is opened
 * for editing.
 *
 * A taxable row can have been taxed through the client-region fallback without a
 * `tax_region` persisted on the charge (for example a freeform partial-period
 * line taxed at the client's Florida 6% region). Re-deriving "Non-taxable" for
 * that row and then committing it on collapse silently strips the tax. This
 * resolver returns:
 *
 *   - a rate id  -> an existing treatment the operator sees and can change
 *   - `null`     -> an explicit Non-taxable row (or a discount/credit)
 *   - `undefined`-> taxable but not resolvable; keep the stored treatment and
 *                   only change it if the operator chooses a rate
 */
export interface ManualTaxTreatmentResolutionInput {
  isDiscount: boolean;
  /** In-session operator choice; `undefined` means "no choice yet". */
  explicitTaxRateId?: string | null;
  /** Rate id echoed in `manual_line_metadata.tax_rate_id`. */
  metadataTaxRateId?: unknown;
  isTaxable?: boolean | null;
  taxRegion?: string | null;
  serviceId?: string | null;
  /** The selected service's current default rate, if any. */
  serviceTaxRateId?: string | null;
  /** The invoice client's default region, if known. */
  clientRegion?: string | null;
  /** Region code -> tax_rate_id lookup built from the tenant's rates. */
  taxRateByRegion: Map<string, string>;
}

export function resolveInitialManualTaxRateId(
  input: ManualTaxTreatmentResolutionInput,
): string | null | undefined {
  if (input.isDiscount) return null;
  if (input.explicitTaxRateId !== undefined) return input.explicitTaxRateId ?? null;

  const metadataRateId = input.metadataTaxRateId;
  if (typeof metadataRateId === 'string' && metadataRateId) return metadataRateId;

  // A row explicitly persisted as non-taxable stays non-taxable regardless of
  // the region fallback stored alongside it.
  if (input.isTaxable === false) return null;

  if (input.taxRegion) {
    const storedRateId = input.taxRateByRegion.get(input.taxRegion);
    if (storedRateId) return storedRateId;
  }

  if (input.serviceTaxRateId) return input.serviceTaxRateId;

  if (input.isTaxable === true) {
    const clientRateId = input.clientRegion
      ? input.taxRateByRegion.get(input.clientRegion)
      : undefined;
    if (clientRateId) return clientRateId;
    // Unresolvable taxable row: preserve instead of stripping.
    return undefined;
  }

  return null;
}
