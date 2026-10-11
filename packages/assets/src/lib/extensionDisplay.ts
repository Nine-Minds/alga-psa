/**
 * Display helpers for extension-table values that are nullable in the database
 * (alga0002283): null means "unknown", never 0, and callers render their own
 * localized "Not provided" for the missing case.
 */

/** "Intel i7 (8 cores)", just the model or just the core count when the other is missing, or null when neither is known. */
export function formatCpuSummary(
  model: string | null | undefined,
  cores: number | null | undefined,
): string | null {
  const trimmedModel = model?.trim() ?? '';
  if (cores === null || cores === undefined) return trimmedModel || null;
  return trimmedModel ? `${trimmedModel} (${cores} cores)` : `${cores} cores`;
}
