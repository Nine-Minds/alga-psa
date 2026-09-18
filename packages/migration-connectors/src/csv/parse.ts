import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { toRfc3339Seconds } from './values';

/**
 * A parsed spreadsheet: the header row plus one string record per data row.
 * Data rows are 1-based for diagnostics — row 1 is the first row after the
 * header. Values are raw strings; normalization happens in the engine.
 */
export interface ParsedSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/**
 * Parse a CSV or XLSX file into headers + string records. XLSX is selected
 * by the `.xlsx` extension; everything else is parsed as CSV.
 */
export async function parseSpreadsheet(path: string): Promise<ParsedSheet> {
  if (path.toLowerCase().endsWith('.xlsx')) {
    return parseXlsx(path);
  }
  return parseCsv(path);
}

async function parseCsv(path: string): Promise<ParsedSheet> {
  const text = await readFile(path, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    const location = first.row === undefined ? '' : ` (data row ${first.row + 1})`;
    throw new Error(`Could not parse CSV file ${path}: ${first.message}${location}`);
  }
  const headers = (parsed.meta.fields ?? []).filter((field) => field.trim().length > 0);
  if (headers.length === 0) {
    throw new Error(`CSV file ${path} has no header row.`);
  }
  return { headers, rows: parsed.data };
}

async function parseXlsx(path: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`XLSX file ${path} contains no worksheets.`);
  }

  const headerRow = worksheet.getRow(1);
  const headersByColumn = new Map<number, string>();
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    const header = cellString(headerRow.getCell(column)).trim();
    if (header.length > 0) {
      headersByColumn.set(column, header);
    }
  }
  if (headersByColumn.size === 0) {
    throw new Error(`XLSX file ${path}: the first row of worksheet "${worksheet.name}" has no headers.`);
  }

  const rows: Array<Record<string, string>> = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const record: Record<string, string> = {};
    for (const [column, header] of headersByColumn) {
      record[header] = cellString(row.getCell(column));
    }
    rows.push(record);
  });

  return { headers: [...headersByColumn.values()], rows };
}

function cellString(cell: ExcelJS.Cell): string {
  // Date cells convert deterministically instead of through the cell's
  // display format, which is locale-dependent.
  if (cell.value instanceof Date) {
    return toRfc3339Seconds(cell.value);
  }
  return cell.text ?? '';
}
