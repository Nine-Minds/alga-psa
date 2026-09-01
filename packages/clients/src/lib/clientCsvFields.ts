/**
 * Truthy spellings a CSV boolean column may use.
 *
 * Spreadsheet exports are not consistent: Excel writes TRUE, Google Sheets
 * writes TRUE or Yes, hand-edited files use y/1/true in any casing. Accepting
 * only the exact strings `'true'` and `'Yes'` silently imports every other
 * spelling as false — which for `is_tax_exempt` means an exempt client starts
 * being taxed.
 */
const TRUTHY_CSV_VALUES = new Set(['true', 't', 'yes', 'y', '1']);

/**
 * Interpret a CSV cell as a boolean.
 *
 * Anything not recognised as truthy is false, which keeps the column's existing
 * "absent means no" contract for blank cells and unexpected text.
 */
export function parseClientCsvBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;

  return TRUTHY_CSV_VALUES.has(value.trim().toLowerCase());
}
