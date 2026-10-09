/**
 * Parses the raw string from an `<input type="number">` into a value the asset
 * update schema can accept.
 *
 * Empty or unparseable input is `null` ("no value"), never `NaN` — `parseInt('')`
 * returned `NaN`, which JSON-serialises to `null` on the wire and, before
 * alga0002283, was rejected by `z.number()`. Integer columns truncate; decimal
 * columns (e.g. `power_draw_watts`, decimal(8,2)) keep the fraction.
 */
export function parseNumberInput(raw: string, options: { integer: boolean }): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return options.integer ? Math.trunc(parsed) : parsed;
}
