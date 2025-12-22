/**
 * CSV Tax Import Validator
 *
 * Validates CSV files for tax import, including:
 * - Column structure validation
 * - Row-level data validation
 * - Database cross-referencing
 */

import {
  normalizeCSVHeaders,
  validateRequiredColumns,
  REQUIRED_TAX_IMPORT_COLUMNS,
  getSuggestionsForMissingColumns,
  formatColumnAliases
} from '../utils/csvFieldNormalizer';

/**
 * Result of parsing a single CSV row
 */
export interface ParsedTaxRow {
  rowNumber: number;
  invoiceNo: string;
  invoiceDate: Date;
  taxAmount: number;
  taxCode?: string;
  taxRate?: number;
  lineNo?: string;
  lineTaxAmount?: number;
  raw: Record<string, string>;
}

/**
 * Validation error with row context
 */
export interface ValidationError {
  rowNumber?: number;
  field: string;
  message: string;
  value?: string;
}

/**
 * Validation warning (non-fatal)
 */
export interface ValidationWarning {
  rowNumber?: number;
  field: string;
  message: string;
  value?: string;
}

/**
 * Result of structure validation
 */
export interface StructureValidationResult {
  valid: boolean;
  columnMap: Map<string, number>;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions: Map<string, string[]>;
}

/**
 * Result of row parsing
 */
export interface RowParseResult {
  success: boolean;
  row?: ParsedTaxRow;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Invoice info from database for validation
 */
export interface InvoiceValidationInfo {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  taxSource: string;
  status: string;
}

/**
 * Result of database validation
 */
export interface DatabaseValidationResult {
  valid: boolean;
  matchedInvoices: Map<string, InvoiceValidationInfo>;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Complete validation result
 */
export interface CSVValidationResult {
  valid: boolean;
  structureValid: boolean;
  rowsValid: boolean;
  databaseValid: boolean;
  parsedRows: ParsedTaxRow[];
  matchedInvoices: Map<string, InvoiceValidationInfo>;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: {
    totalRows: number;
    validRows: number;
    matchedInvoices: number;
    uniqueInvoices: number;
    duplicateInvoices: string[];
  };
}

/**
 * Parse a date string in various formats commonly found in QuickBooks exports.
 * Supports: MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, M/D/YYYY
 */
export function parseDate(value: string, rowNumber: number): { date?: Date; error?: ValidationError } {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      error: {
        rowNumber,
        field: 'invoiceDate',
        message: 'Date is required',
        value
      }
    };
  }

  // Try various date formats
  let date: Date | null = null;

  // MM/DD/YYYY or M/D/YYYY (US format - most common in QuickBooks)
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    date = new Date(Number(year), Number(month) - 1, Number(day));
  }

  // YYYY-MM-DD (ISO format)
  if (!date) {
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      date = new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  // DD/MM/YYYY (UK format)
  if (!date) {
    const ukMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ukMatch) {
      const [, day, month, year] = ukMatch;
      // Only use UK format if day > 12 (unambiguous)
      if (Number(day) > 12) {
        date = new Date(Number(year), Number(month) - 1, Number(day));
      }
    }
  }

  // Validate the parsed date
  if (date && !isNaN(date.getTime())) {
    return { date };
  }

  return {
    error: {
      rowNumber,
      field: 'invoiceDate',
      message: `Invalid date format: "${trimmed}". Expected MM/DD/YYYY or YYYY-MM-DD`,
      value
    }
  };
}

/**
 * Parse a numeric amount from CSV, handling currency symbols and formatting.
 */
export function parseAmount(
  value: string,
  field: string,
  rowNumber: number,
  required: boolean = true
): { amount?: number; error?: ValidationError } {
  const trimmed = value.trim();

  if (!trimmed) {
    if (required) {
      return {
        error: {
          rowNumber,
          field,
          message: `${field} is required`,
          value
        }
      };
    }
    return { amount: undefined };
  }

  // Remove currency symbols, commas, and whitespace
  const cleaned = trimmed
    .replace(/[$€£¥₹]/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();

  // Handle parentheses for negative numbers (accounting format)
  let isNegative = false;
  let numStr = cleaned;
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    isNegative = true;
    numStr = cleaned.slice(1, -1);
  } else if (cleaned.startsWith('-')) {
    isNegative = true;
    numStr = cleaned.slice(1);
  }

  const amount = parseFloat(numStr);

  if (isNaN(amount)) {
    return {
      error: {
        rowNumber,
        field,
        message: `Invalid number format: "${trimmed}"`,
        value
      }
    };
  }

  return { amount: isNegative ? -amount : amount };
}

/**
 * Parse a tax rate percentage from CSV.
 */
export function parseTaxRate(
  value: string,
  rowNumber: number
): { rate?: number; warning?: ValidationWarning } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { rate: undefined };
  }

  // Remove % sign if present
  const cleaned = trimmed.replace(/%$/, '').trim();
  const rate = parseFloat(cleaned);

  if (isNaN(rate)) {
    return {
      warning: {
        rowNumber,
        field: 'taxRate',
        message: `Could not parse tax rate: "${trimmed}"`,
        value
      }
    };
  }

  // Check for reasonable tax rate range (0-100%)
  if (rate < 0 || rate > 100) {
    return {
      rate,
      warning: {
        rowNumber,
        field: 'taxRate',
        message: `Tax rate ${rate}% is outside expected range (0-100%)`,
        value
      }
    };
  }

  return { rate };
}

/**
 * Validate CSV structure (headers/columns).
 */
export function validateStructure(
  headers: string[],
  requiredColumns: string[] = REQUIRED_TAX_IMPORT_COLUMNS
): StructureValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Normalize headers and get column map
  const columnMap = normalizeCSVHeaders(headers);

  // Check required columns
  const validation = validateRequiredColumns(columnMap, requiredColumns);

  if (!validation.valid) {
    // Get suggestions for missing columns
    const suggestions = getSuggestionsForMissingColumns(headers, validation.missing);

    for (const missing of validation.missing) {
      let message = `Missing required column: ${missing}`;
      const aliases = formatColumnAliases(missing, 3);
      message += `. Expected one of: ${aliases}`;

      const columnSuggestions = suggestions.get(missing);
      if (columnSuggestions && columnSuggestions.length > 0) {
        message += `. Did you mean: "${columnSuggestions.join('", "')}"?`;
      }

      errors.push({
        field: missing,
        message
      });
    }

    return {
      valid: false,
      columnMap,
      errors,
      warnings,
      suggestions
    };
  }

  // Check for potential duplicate column mappings
  const mappedIndices = new Set<number>();
  for (const [, index] of columnMap) {
    if (mappedIndices.has(index)) {
      warnings.push({
        field: 'headers',
        message: `Column at index ${index} maps to multiple canonical names`,
        value: headers[index]
      });
    }
    mappedIndices.add(index);
  }

  return {
    valid: true,
    columnMap,
    errors,
    warnings,
    suggestions: new Map()
  };
}

/**
 * Parse a single CSV row.
 */
export function parseRow(
  row: string[],
  columnMap: Map<string, number>,
  rowNumber: number
): RowParseResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Helper to get value from row
  const getValue = (canonical: string): string => {
    const index = columnMap.get(canonical);
    return index !== undefined && index < row.length ? row[index] : '';
  };

  // Build raw record
  const raw: Record<string, string> = {};
  for (const [canonical] of columnMap) {
    raw[canonical] = getValue(canonical);
  }

  // Parse required fields
  const invoiceNo = getValue('invoiceNo').trim();
  if (!invoiceNo) {
    errors.push({
      rowNumber,
      field: 'invoiceNo',
      message: 'Invoice number is required'
    });
  }

  const dateResult = parseDate(getValue('invoiceDate'), rowNumber);
  if (dateResult.error) {
    errors.push(dateResult.error);
  }

  const taxAmountResult = parseAmount(getValue('taxAmount'), 'taxAmount', rowNumber);
  if (taxAmountResult.error) {
    errors.push(taxAmountResult.error);
  }

  // Parse optional fields
  const taxCode = getValue('taxCode').trim() || undefined;

  let taxRate: number | undefined;
  const taxRateValue = getValue('taxRate');
  if (taxRateValue) {
    const taxRateResult = parseTaxRate(taxRateValue, rowNumber);
    taxRate = taxRateResult.rate;
    if (taxRateResult.warning) {
      warnings.push(taxRateResult.warning);
    }
  }

  const lineNo = getValue('lineNo').trim() || undefined;

  let lineTaxAmount: number | undefined;
  const lineTaxValue = getValue('lineTaxAmount');
  if (lineTaxValue) {
    const lineTaxResult = parseAmount(lineTaxValue, 'lineTaxAmount', rowNumber, false);
    lineTaxAmount = lineTaxResult.amount;
    if (lineTaxResult.error) {
      warnings.push({
        rowNumber,
        field: 'lineTaxAmount',
        message: lineTaxResult.error.message,
        value: lineTaxValue
      });
    }
  }

  // Check for errors
  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  return {
    success: true,
    row: {
      rowNumber,
      invoiceNo,
      invoiceDate: dateResult.date!,
      taxAmount: taxAmountResult.amount!,
      taxCode,
      taxRate,
      lineNo,
      lineTaxAmount,
      raw
    },
    errors,
    warnings
  };
}

/**
 * Validate parsed rows against the database.
 * Checks that invoices exist and have the correct tax_source.
 */
export async function validateAgainstDatabase(
  knex: any,
  tenant: string,
  rows: ParsedTaxRow[],
  startDate: Date,
  endDate: Date
): Promise<DatabaseValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const matchedInvoices = new Map<string, InvoiceValidationInfo>();

  // Get unique invoice numbers from the CSV
  const invoiceNumbers = [...new Set(rows.map(r => r.invoiceNo))];

  if (invoiceNumbers.length === 0) {
    return {
      valid: false,
      matchedInvoices,
      errors: [{ field: 'data', message: 'No invoice numbers found in CSV' }],
      warnings
    };
  }

  // Fetch matching invoices from database
  const invoices = await knex('invoices')
    .where({ tenant })
    .whereIn('invoice_number', invoiceNumbers)
    .select('invoice_id', 'invoice_number', 'invoice_date', 'tax_source', 'status');

  // Build lookup map
  const invoiceMap = new Map<string, any>();
  for (const inv of invoices) {
    invoiceMap.set(inv.invoice_number, inv);
  }

  // Validate each invoice number
  for (const invoiceNo of invoiceNumbers) {
    const invoice = invoiceMap.get(invoiceNo);

    if (!invoice) {
      errors.push({
        field: 'invoiceNo',
        message: `Invoice not found in database: ${invoiceNo}`,
        value: invoiceNo
      });
      continue;
    }

    // Check tax_source
    if (invoice.tax_source !== 'pending_external') {
      errors.push({
        field: 'invoiceNo',
        message: `Invoice ${invoiceNo} has tax_source='${invoice.tax_source}', expected 'pending_external'`,
        value: invoiceNo
      });
      continue;
    }

    // Check invoice date is within range
    const invoiceDate = new Date(invoice.invoice_date);
    if (invoiceDate < startDate || invoiceDate > endDate) {
      warnings.push({
        field: 'invoiceDate',
        message: `Invoice ${invoiceNo} date (${invoiceDate.toISOString().split('T')[0]}) is outside the specified range`,
        value: invoiceNo
      });
    }

    // Check invoice status
    if (invoice.status === 'void' || invoice.status === 'cancelled') {
      warnings.push({
        field: 'invoiceNo',
        message: `Invoice ${invoiceNo} has status '${invoice.status}'`,
        value: invoiceNo
      });
    }

    // Add to matched set
    matchedInvoices.set(invoiceNo, {
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: new Date(invoice.invoice_date),
      taxSource: invoice.tax_source,
      status: invoice.status
    });
  }

  return {
    valid: errors.length === 0,
    matchedInvoices,
    errors,
    warnings
  };
}

/**
 * Perform complete validation of a CSV file for tax import.
 */
export async function validateCSVForTaxImport(
  knex: any,
  tenant: string,
  csvRows: string[][],
  startDate: Date,
  endDate: Date
): Promise<CSVValidationResult> {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];
  const parsedRows: ParsedTaxRow[] = [];

  // Validate we have data
  if (csvRows.length === 0) {
    return {
      valid: false,
      structureValid: false,
      rowsValid: false,
      databaseValid: false,
      parsedRows: [],
      matchedInvoices: new Map(),
      errors: [{ field: 'data', message: 'CSV file is empty' }],
      warnings: [],
      stats: {
        totalRows: 0,
        validRows: 0,
        matchedInvoices: 0,
        uniqueInvoices: 0,
        duplicateInvoices: []
      }
    };
  }

  if (csvRows.length === 1) {
    return {
      valid: false,
      structureValid: false,
      rowsValid: false,
      databaseValid: false,
      parsedRows: [],
      matchedInvoices: new Map(),
      errors: [{ field: 'data', message: 'CSV file has only headers, no data rows' }],
      warnings: [],
      stats: {
        totalRows: 0,
        validRows: 0,
        matchedInvoices: 0,
        uniqueInvoices: 0,
        duplicateInvoices: []
      }
    };
  }

  // 1. Validate structure
  const headers = csvRows[0];
  const structureResult = validateStructure(headers);
  allErrors.push(...structureResult.errors);
  allWarnings.push(...structureResult.warnings);

  if (!structureResult.valid) {
    return {
      valid: false,
      structureValid: false,
      rowsValid: false,
      databaseValid: false,
      parsedRows: [],
      matchedInvoices: new Map(),
      errors: allErrors,
      warnings: allWarnings,
      stats: {
        totalRows: csvRows.length - 1,
        validRows: 0,
        matchedInvoices: 0,
        uniqueInvoices: 0,
        duplicateInvoices: []
      }
    };
  }

  // 2. Parse and validate rows
  const dataRows = csvRows.slice(1);
  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // Account for header row and 1-based indexing
    const parseResult = parseRow(dataRows[i], structureResult.columnMap, rowNumber);

    if (parseResult.success && parseResult.row) {
      parsedRows.push(parseResult.row);
    }
    allErrors.push(...parseResult.errors);
    allWarnings.push(...parseResult.warnings);
  }

  const rowsValid = parsedRows.length > 0 && allErrors.filter(e => e.rowNumber !== undefined).length === 0;

  if (parsedRows.length === 0) {
    allErrors.push({
      field: 'data',
      message: 'No valid rows found in CSV'
    });
    return {
      valid: false,
      structureValid: true,
      rowsValid: false,
      databaseValid: false,
      parsedRows: [],
      matchedInvoices: new Map(),
      errors: allErrors,
      warnings: allWarnings,
      stats: {
        totalRows: dataRows.length,
        validRows: 0,
        matchedInvoices: 0,
        uniqueInvoices: 0,
        duplicateInvoices: []
      }
    };
  }

  // 3. Check for duplicate invoices in CSV
  const invoiceCounts = new Map<string, number>();
  for (const row of parsedRows) {
    invoiceCounts.set(row.invoiceNo, (invoiceCounts.get(row.invoiceNo) || 0) + 1);
  }

  const duplicateInvoices: string[] = [];
  for (const [invoiceNo, count] of invoiceCounts) {
    if (count > 1) {
      duplicateInvoices.push(invoiceNo);
      allWarnings.push({
        field: 'invoiceNo',
        message: `Invoice ${invoiceNo} appears ${count} times in CSV. Tax amounts will be summed.`,
        value: invoiceNo
      });
    }
  }

  // 4. Validate against database
  const dbResult = await validateAgainstDatabase(knex, tenant, parsedRows, startDate, endDate);
  allErrors.push(...dbResult.errors);
  allWarnings.push(...dbResult.warnings);

  // Calculate stats
  const uniqueInvoices = invoiceCounts.size;

  return {
    valid: allErrors.length === 0,
    structureValid: true,
    rowsValid,
    databaseValid: dbResult.valid,
    parsedRows,
    matchedInvoices: dbResult.matchedInvoices,
    errors: allErrors,
    warnings: allWarnings,
    stats: {
      totalRows: dataRows.length,
      validRows: parsedRows.length,
      matchedInvoices: dbResult.matchedInvoices.size,
      uniqueInvoices,
      duplicateInvoices
    }
  };
}

/**
 * Aggregate tax amounts by invoice number.
 * If multiple rows have the same invoice number, sums their tax amounts.
 */
export function aggregateTaxByInvoice(rows: ParsedTaxRow[]): Map<string, {
  totalTax: number;
  taxCode?: string;
  taxRate?: number;
  rowCount: number;
}> {
  const aggregated = new Map<string, {
    totalTax: number;
    taxCode?: string;
    taxRate?: number;
    rowCount: number;
  }>();

  for (const row of rows) {
    const existing = aggregated.get(row.invoiceNo);
    if (existing) {
      existing.totalTax += row.taxAmount;
      existing.rowCount++;
      // Keep first tax code/rate if multiple
    } else {
      aggregated.set(row.invoiceNo, {
        totalTax: row.taxAmount,
        taxCode: row.taxCode,
        taxRate: row.taxRate,
        rowCount: 1
      });
    }
  }

  return aggregated;
}
