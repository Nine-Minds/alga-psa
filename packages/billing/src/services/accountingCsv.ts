/** Accounting import files need signed decimal numbers, not spreadsheet text.
 * Only explicitly declared numeric columns bypass formula escaping; user-authored
 * descriptions, names and identifiers retain the spreadsheet-injection guard.
 */
export function serializeAccountingCsv(rows: object[], fields: string[], numericFields: string[]): string {
  const numeric = new Set(numericFields);
  const escape = (value: unknown, field: string): string => {
    let text = value == null ? '' : String(value);
    if (numeric.has(field) && text !== '') {
      if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
        throw new Error(`Invalid accounting decimal in ${field}`);
      }
    } else if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [fields.join(','), ...rows.map(row => fields.map(field => escape((row as Record<string, unknown>)[field], field)).join(','))].join('\n');
}
