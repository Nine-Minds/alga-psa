import { AbstractImporter } from '@/lib/imports/AbstractImporter';
import type {
  DuplicateDetectionStrategy,
  MapToAssetContext,
  ParsedRecord,
  ValidationResult
} from '@/types/imports.types';
import { ImportValidationError } from '@/lib/imports/errors';
import Papa, { ParseResult } from 'papaparse';
import * as XLSX from 'xlsx';

export interface CsvImporterOptions {
  sourceType?: string;
  name?: string;
  description?: string;
  duplicateStrategy?: DuplicateDetectionStrategy;
}

interface CsvParseRow {
  values: Record<string, unknown>;
  meta: ParseMeta;
  errors: ParseError[];
}

const XLSX_MAGIC_NUMBER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK..

const DEFAULT_DELIMITERS = [',', '\t', ';', '|', '\u001f'];

const PREVIEW_LIMIT = 10;

export class CsvImporter extends AbstractImporter {
  readonly sourceType: string;
  readonly name: string;
  readonly description: string;
  readonly supportedFileTypes = ['.csv', '.tsv', '.txt', '.xls', '.xlsx'];
  private readonly duplicateStrategy?: DuplicateDetectionStrategy;

  constructor(options: CsvImporterOptions = {}) {
    super();
    this.sourceType = options.sourceType ?? 'csv_upload';
    this.name = options.name ?? 'CSV / XLSX Upload';
    this.description =
      options.description ??
      'Upload comma, tab, or semicolon-delimited CSV files as well as XLSX exports.';
    this.duplicateStrategy = options.duplicateStrategy;
  }

  async parse(input: Buffer | string): Promise<ParsedRecord[]> {
    if (Buffer.isBuffer(input) && this.isXlsx(input)) {
      return this.parseXlsx(input);
    }
    const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
    return this.parseCsv(text);
  }

  async validate(records: ParsedRecord[]): Promise<ValidationResult> {
    // Phase 2 focuses on structural validation; additional validation layers will plug in later.
    const errors: ImportValidationError[] = [];

    for (const record of records) {
      if (!record.raw || Object.keys(record.raw).length === 0) {
        errors.push(
          new ImportValidationError(record.rowNumber, '_row', null, 'Row is empty after parsing')
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Mapping will be delegated to FieldMapper in higher-level orchestration.
  async mapToAsset(_: ParsedRecord, __: MapToAssetContext): Promise<Record<string, unknown>> {
    throw new Error('mapToAsset should be handled by FieldMapper');
  }

  async detectDuplicate(record: ParsedRecord, context: MapToAssetContext) {
    return super.detectDuplicate(record, context, this.duplicateStrategy);
  }

  getPreviewSample(records: ParsedRecord[], limit: number = PREVIEW_LIMIT): ParsedRecord[] {
    return records.slice(0, limit);
  }

  private async parseCsv(text: string): Promise<ParsedRecord[]> {
    return new Promise<ParsedRecord[]>((resolve, reject) => {
      const rows: ParsedRecord[] = [];
      let dataRowOffset = 1; // account for header row

      Papa.parse<Record<string, unknown>>(text, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: 'greedy',
        delimiter: '',
        delimitersToGuess: DEFAULT_DELIMITERS,
        transformHeader: (header: string) => header?.trim() ?? '',
        chunkSize: 1024 * 64,
        chunk: (results: ParseResult<Record<string, unknown>>) => {
          results.data.forEach((row, index) => {
            const rowNumber = dataRowOffset + index + 1;
            const normalized = this.normalizeRecord(row);
            rows.push({
              rowNumber,
              raw: normalized,
              normalized,
            });
          });
          dataRowOffset += results.data.length;
        },
        complete: () => resolve(rows),
        error: (error) => reject(error),
      });
    });
  }

  private async parseXlsx(buffer: Buffer): Promise<ParsedRecord[]> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error('No worksheets found in XLSX file');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: null,
      dateNF: 'yyyy-mm-dd"T"HH:MM:ss',
    });

    if (rows.length === 0) {
      return [];
    }

    const headerRow = rows[0].map((header) =>
      typeof header === 'string' ? header.trim() : String(header ?? '').trim()
    );

    const dataRows = rows.slice(1);
    return dataRows.map((row, index) => {
      const raw: Record<string, unknown> = {};
      headerRow.forEach((header, headerIndex) => {
        const cellValue = row[headerIndex];
        raw[header] = cellValue ?? null;
      });

      return {
        rowNumber: index + 2, // header + zero-based index
        raw: this.normalizeRecord(raw),
        normalized: this.normalizeRecord(raw),
      };
    });
  }

  private normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, value]) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return;
      }

      if (typeof value === 'string') {
        normalized[trimmedKey] = value.trim();
      } else {
        normalized[trimmedKey] = value;
      }
    });
    return normalized;
  }

  private isXlsx(buffer: Buffer): boolean {
    if (buffer.length < 4) {
      return false;
    }
    return buffer.subarray(0, 4).equals(XLSX_MAGIC_NUMBER);
  }
}
