/**
 * Pure rules for a quote line's product description (`catalog_description`)
 * and its divergence flag (`catalog_description_edited`).
 *
 * The model, the read action and the editor draft all use this one module so
 * "unchanged from the product" means the same thing on client and server.
 */

/** Empty or whitespace-only catalog text normalises to `null`. */
export function normalizeCatalogDescription(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type CatalogDescriptionWrite = {
  catalog_description: string | null;
  catalog_description_edited: boolean;
};

/**
 * Resolve an explicit write of a line's product description against the
 * product's current catalog text. The stored text is the normalised caller
 * value; the line counts as edited when that differs from the normalised
 * catalog text. Writing the current catalog text (a refresh) therefore clears
 * the flag, and an explicit `''` stores `null` (edited unless the catalog text
 * is also empty).
 */
export function resolveCatalogDescriptionWrite(
  callerValue: unknown,
  catalogText: unknown
): CatalogDescriptionWrite {
  const written = normalizeCatalogDescription(callerValue);
  return {
    catalog_description: written,
    catalog_description_edited: written !== normalizeCatalogDescription(catalogText),
  };
}
