/**
 * Normalize scanner output so UPC-A and its zero-prefixed EAN-13 representation
 * resolve to the same stored value. Non-GTIN barcode formats are only trimmed.
 */
export function normalizeGtin(code: string): string {
  const trimmed = code.trim();

  if (/^\d{12}$/.test(trimmed)) {
    return `0${trimmed}`;
  }

  return trimmed;
}
