// Pure (client-safe): the ticket detail dialog and the server provider derive the Reason the same way.
/** Subcategory if set, else category, else null. */
export function deriveWorkReason(subcategoryName: string | null | undefined, categoryName: string | null | undefined): string | null {
  const sub = subcategoryName?.trim();
  if (sub) return sub;
  const cat = categoryName?.trim();
  return cat ? cat : null;
}
