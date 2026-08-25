import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { validateAmpPackage, type AmpValidationResult } from '@alga-psa/migration-sdk';
import { AMP_ENTITY_TABLES, type AmpEntityType } from '@alga-psa/migration-spec';
import {
  csvConnector,
  writeConnectorPackage,
  type ConnectorSourceTables,
  type SourceRow,
} from './index.js';

/**
 * CSV/XLSX → AMP conversion. One spreadsheet per entity, canonical headers
 * (or a per-file header mapping), first row is the header line. The adapter
 * never evaluates source-provided expressions; cells are read as text.
 */
export interface CsvConversionConfig {
  outputPath: string;
  sourceSystem?: string;
  entities: Partial<Record<AmpEntityType, { file: string; mapping?: Record<string, string> }>>;
}

export interface CsvConversionResult {
  outputPath: string;
  counts: Record<string, number>;
  validation: AmpValidationResult;
}

function applyHeaderMapping(
  rows: Array<Record<string, string>>,
  mapping: Record<string, string> | undefined
): SourceRow[] {
  if (!mapping) {
    return rows;
  }
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([header, value]) => [mapping[header] ?? header, value])
    )
  );
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('result' in value) {
      return value.result === null || value.result === undefined ? '' : String(value.result);
    }
    return String(value);
  }
  return String(value);
}

async function readXlsxRows(path: string): Promise<Array<Record<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }
  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers[columnNumber] = cellToText(cell.value).trim();
  });
  const rows: Array<Record<string, string>> = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = headers[columnNumber];
      if (header) {
        record[header] = cellToText(cell.value);
      }
    });
    if (Object.keys(record).length > 0) {
      rows.push(record);
    }
  });
  return rows;
}

async function readCsvRows(path: string): Promise<Array<Record<string, string>>> {
  const csv = await readFile(path, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    throw new Error(`${path}: ${parsed.errors[0].message}`);
  }
  return parsed.data;
}

async function readSourceRows(path: string): Promise<Array<Record<string, string>>> {
  const extension = extname(path).toLowerCase();
  if (extension === '.xlsx') {
    return readXlsxRows(path);
  }
  if (extension === '.csv') {
    return readCsvRows(path);
  }
  throw new Error(`Unsupported source file "${path}"; expected .csv or .xlsx.`);
}

/**
 * Convert the spreadsheets named by a conversion config into one AMP
 * package, then validate the produced package. Rejects unknown entity keys
 * so a typo cannot silently drop a table.
 */
export async function convertSpreadsheetsToAmp(configPath: string): Promise<CsvConversionResult> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as CsvConversionConfig;
  if (!config.outputPath || typeof config.outputPath !== 'string') {
    throw new Error('Conversion config requires an outputPath.');
  }

  const source: ConnectorSourceTables = {};
  for (const [entity, entityConfig] of Object.entries(config.entities ?? {})) {
    if (!(AMP_ENTITY_TABLES as readonly string[]).includes(entity)) {
      throw new Error(`Unknown entity "${entity}" in conversion config.`);
    }
    if (!entityConfig?.file) {
      throw new Error(`Entity "${entity}" is missing a source file.`);
    }
    const rows = await readSourceRows(resolve(dirname(configPath), entityConfig.file));
    source[entity as AmpEntityType] = applyHeaderMapping(rows, entityConfig.mapping);
  }

  const records = csvConnector.convert(source);
  const outputPath = resolve(dirname(configPath), config.outputPath);
  writeConnectorPackage(
    outputPath,
    csvConnector.declaration,
    records,
    config.sourceSystem ?? 'csv'
  );

  const validation = validateAmpPackage(outputPath);
  return {
    outputPath,
    counts: Object.fromEntries(
      Object.entries(records).map(([table, rows]) => [table, rows?.length ?? 0])
    ),
    validation,
  };
}
