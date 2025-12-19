/**
 * CSV Field Normalizer
 *
 * Handles column name variations and drift when importing CSV files from QuickBooks.
 * Maps various column name aliases to canonical field names for consistent processing.
 */

/**
 * Canonical field names and their known aliases from QuickBooks reports
 */
export const COLUMN_ALIASES: Record<string, string[]> = {
  // Required fields for tax import
  invoiceNo: [
    'InvoiceNo',
    'Invoice Number',
    'Invoice #',
    'Doc Number',
    'DocNumber',
    'Invoice',
    'Num',
    'Reference',
    'Ref No',
    'RefNo'
  ],
  invoiceDate: [
    'InvoiceDate',
    'Invoice Date',
    'Date',
    'Transaction Date',
    'TxnDate',
    'Txn Date',
    'Doc Date'
  ],
  taxAmount: [
    'TaxAmount',
    'Tax Amount',
    'Tax',
    'Sales Tax',
    'Tax Total',
    'TaxTotal',
    'Total Tax',
    'VAT',
    'GST'
  ],

  // Optional fields for tax import
  taxCode: [
    'TaxCode',
    'Tax Code',
    'Tax Rate Name',
    'TaxRateName',
    'Tax Name',
    'TaxName'
  ],
  taxRate: [
    'TaxRate',
    'Tax Rate',
    'Rate',
    'Tax %',
    'TaxPercent',
    'Tax Percent',
    'Percent',
    'Tax Percentage'
  ],
  lineNo: [
    'LineNo',
    'Line No',
    'Line',
    'Line Number',
    'LineNumber',
    'Line #'
  ],
  lineTaxAmount: [
    'LineTaxAmount',
    'Line Tax Amount',
    'Line Tax',
    'LineTax',
    'Item Tax'
  ],

  // Export columns (for reference)
  customer: [
    'Customer',
    'Client',
    'Customer Name',
    'ClientName',
    'Company',
    'Bill To'
  ],
  item: [
    'Item',
    'Product/Service',
    'Service',
    'ProductService',
    'Product',
    'Description'
  ],
  quantity: [
    'Quantity',
    'Qty',
    'ItemQuantity',
    'Item Quantity',
    'Units'
  ],
  rate: [
    'Rate',
    'UnitPrice',
    'Unit Price',
    'ItemRate',
    'Item Rate',
    'Price'
  ],
  amount: [
    'Amount',
    'Total',
    'ItemAmount',
    'Item Amount',
    'Line Total',
    'LineTotal',
    'Extended Amount'
  ],
  dueDate: [
    'DueDate',
    'Due Date',
    'Due',
    'Payment Due'
  ],
  terms: [
    'Terms',
    'Payment Terms',
    'PaymentTerms',
    'Sales Terms'
  ],
  memo: [
    'Memo',
    'Notes',
    'Description',
    'Comment',
    'Message'
  ]
};

/**
 * Required columns for tax import validation
 */
export const REQUIRED_TAX_IMPORT_COLUMNS = ['invoiceNo', 'invoiceDate', 'taxAmount'];

/**
 * Normalize CSV headers to canonical column names.
 * Returns a map of canonical column name -> column index.
 *
 * @param headers - Array of header strings from the CSV
 * @returns Map of canonical field names to their column indices
 */
export function normalizeCSVHeaders(headers: string[]): Map<string, number> {
  const columnMap = new Map<string, number>();
  const normalizedHeaders = headers.map(h => h.trim().toLowerCase());

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const normalizedAliases = aliases.map(a => a.toLowerCase());

    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (normalizedAliases.includes(normalizedHeaders[i])) {
        columnMap.set(canonical, i);
        break;
      }
    }
  }

  return columnMap;
}

/**
 * Get suggestions for unmapped required columns based on Levenshtein distance.
 * Helps users identify columns that may be slightly misspelled.
 *
 * @param headers - Array of header strings from the CSV
 * @param missingColumns - Array of canonical column names that were not found
 * @returns Map of missing column names to arrays of similar header suggestions
 */
export function getSuggestionsForMissingColumns(
  headers: string[],
  missingColumns: string[]
): Map<string, string[]> {
  const suggestions = new Map<string, string[]>();

  for (const missing of missingColumns) {
    const aliases = COLUMN_ALIASES[missing] ?? [];
    const similar: string[] = [];

    for (const header of headers) {
      // Check if any alias is similar to this header
      for (const alias of aliases) {
        const distance = levenshteinDistance(header.toLowerCase(), alias.toLowerCase());
        // Allow up to 3 character differences
        if (distance <= 3 && distance > 0) {
          if (!similar.includes(header)) {
            similar.push(header);
          }
          break;
        }
      }
    }

    if (similar.length > 0) {
      suggestions.set(missing, similar);
    }
  }

  return suggestions;
}

/**
 * Validate that all required columns are present in the header map.
 *
 * @param columnMap - Map from normalizeCSVHeaders
 * @param requiredColumns - Array of required canonical column names
 * @returns Object with validation result and any missing columns
 */
export function validateRequiredColumns(
  columnMap: Map<string, number>,
  requiredColumns: string[] = REQUIRED_TAX_IMPORT_COLUMNS
): { valid: boolean; missing: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];

  for (const required of requiredColumns) {
    if (columnMap.has(required)) {
      present.push(required);
    } else {
      missing.push(required);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    present
  };
}

/**
 * Get the display name for a canonical column (first alias).
 *
 * @param canonical - Canonical column name
 * @returns Display-friendly column name
 */
export function getColumnDisplayName(canonical: string): string {
  const aliases = COLUMN_ALIASES[canonical];
  return aliases?.[0] ?? canonical;
}

/**
 * Get all known aliases for a canonical column name.
 *
 * @param canonical - Canonical column name
 * @returns Array of known aliases
 */
export function getColumnAliases(canonical: string): string[] {
  return COLUMN_ALIASES[canonical] ?? [];
}

/**
 * Calculate Levenshtein distance between two strings.
 * Used for suggesting similar column names when exact match fails.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance between the strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Format column aliases as a human-readable string for error messages.
 *
 * @param canonical - Canonical column name
 * @param maxAliases - Maximum number of aliases to show (default 5)
 * @returns Formatted string like "InvoiceNo, Invoice Number, Invoice #, ..."
 */
export function formatColumnAliases(canonical: string, maxAliases: number = 5): string {
  const aliases = COLUMN_ALIASES[canonical] ?? [];
  if (aliases.length === 0) return canonical;

  const shown = aliases.slice(0, maxAliases);
  const remaining = aliases.length - maxAliases;

  let result = shown.join(', ');
  if (remaining > 0) {
    result += `, ... (+${remaining} more)`;
  }

  return result;
}
