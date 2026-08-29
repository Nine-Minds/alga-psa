import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  AMP_ENTITY_TABLES,
  AMP_FORMAT_VERSION,
  type AmpEntityType,
  type AmpManifest,
  type AmpPackageDiagnosticRecord,
  type AmpPackageRows,
} from '@alga-psa/migration-spec';
import { AmpPackageBuilder, validateAmpPackage } from '@alga-psa/migration-sdk';
import { buildEntityRows, type CsvConversionDiagnostic, type EntityRowsInput } from './engine';
import { parseSpreadsheet } from './parse';
import { toRfc3339Seconds } from './values';

/** One source file in a conversion config. */
export interface CsvConvertFileEntry {
  entityType: AmpEntityType;
  /** CSV or XLSX path, resolved relative to the config file's directory. */
  path: string;
  /** Source column header -> canonical AMP column for `entityType`. */
  mapping: Record<string, string>;
  /**
   * How mapped reference columns identify their target: `source_record_id`
   * (the default and only mode in v1) means values are SOURCE ids of the
   * target entity and are rewritten to the target's `package_record_id`.
   */
  referenceBy?: 'source_record_id';
}

export interface CsvConvertConfig {
  outputPath: string;
  namespace: string;
  sourceSystem: string;
  producerVersion?: string;
  files: CsvConvertFileEntry[];
}

export interface CsvConversionResult {
  outputPath: string;
  manifest: AmpManifest;
  rowCounts: Record<string, number>;
  diagnostics: CsvConversionDiagnostic[];
  /** Result of validating the written package. Invalid output is returned, not thrown. */
  valid: boolean;
  validationDiagnosticCount: number;
  /** Backwards-compatible conformance result retained for existing callers. */
  counts: Record<string, number>;
  /** Full SDK validation output, not just its compact summary. */
  validation: ReturnType<typeof validateAmpPackage>;
}

/** Manifest identity plus prepared inputs; the seam connectors build on. */
export interface RunConversionOptions {
  outputPath: string;
  namespace: string;
  sourceSystem: string;
  producerName: string;
  producerVersion: string;
  inputs: EntityRowsInput[];
}

const PRODUCER_NAME = 'alga-csv-adapter';
const DEFAULT_PRODUCER_VERSION = '1.0.0';
const MAX_DIAGNOSTIC_ROWS = 500;

/** Read a JSON conversion config from disk and convert the files it lists. */
export async function convertSpreadsheetsToAmp(configPath: string): Promise<CsvConversionResult> {
  const absoluteConfigPath = resolve(configPath);
  let text: string;
  try {
    text = await readFile(absoluteConfigPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read conversion config ${absoluteConfigPath}: ${(error as Error).message}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Conversion config ${absoluteConfigPath} is not valid JSON: ${(error as Error).message}`
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Conversion config ${absoluteConfigPath} must be a JSON object.`);
  }
  return convertSpreadsheets(parsed as CsvConvertConfig, dirname(absoluteConfigPath));
}

/**
 * Convert the configured CSV/XLSX files into one AMP package. File and
 * output paths are resolved relative to `baseDir`. The written package is
 * validated; an invalid package is reported via `valid`, never thrown, so
 * callers can see why.
 */
export async function convertSpreadsheets(
  config: CsvConvertConfig,
  baseDir: string
): Promise<CsvConversionResult> {
  validateConfig(config);

  const inputs: EntityRowsInput[] = [];
  for (const entry of config.files) {
    const filePath = resolve(baseDir, entry.path);
    const sheet = await parseSpreadsheet(filePath);
    inputs.push({
      entityType: entry.entityType,
      label: entry.path,
      headers: sheet.headers,
      rows: sheet.rows,
      mapping: entry.mapping,
    });
  }

  return runConversion({
    outputPath: resolve(baseDir, config.outputPath),
    namespace: config.namespace,
    sourceSystem: config.sourceSystem,
    producerName: PRODUCER_NAME,
    producerVersion: config.producerVersion ?? DEFAULT_PRODUCER_VERSION,
    inputs,
  });
}

/**
 * Build, write, and validate a package from prepared inputs. Exported so
 * connectors reuse the mapping engine, diagnostics capture, and validation
 * pass under their own producer identity.
 */
export async function runConversion(options: RunConversionOptions): Promise<CsvConversionResult> {
  requireNonEmpty(options.outputPath, 'outputPath');
  requireNonEmpty(options.namespace, 'namespace');
  requireNonEmpty(options.sourceSystem, 'sourceSystem');
  requireNonEmpty(options.producerName, 'producerName');
  requireNonEmpty(options.producerVersion, 'producerVersion');

  const diagnostics: CsvConversionDiagnostic[] = [];
  const { entityRows, rowCounts } = buildEntityRows(options.inputs, options.namespace, diagnostics);

  const rows = {
    ...entityRows,
    package_diagnostics: toDiagnosticRows(diagnostics),
  } as AmpPackageRows;

  // The output path is this conversion's artifact: replace any previous run's
  // file rather than failing on the leftover SQLite schema inside it.
  await rm(options.outputPath, { force: true });

  const manifest = new AmpPackageBuilder(options.outputPath).write(
    {
      format_version: AMP_FORMAT_VERSION,
      package_id: randomUUID(),
      created_at: toRfc3339Seconds(new Date()),
      producer_name: options.producerName,
      producer_version: options.producerVersion,
      source_system: options.sourceSystem,
    },
    rows
  );

  const validation = validateAmpPackage(options.outputPath);

  return {
    outputPath: options.outputPath,
    manifest,
    rowCounts,
    diagnostics,
    valid: validation.valid,
    validationDiagnosticCount: validation.diagnostics.length,
    counts: rowCounts,
    validation,
  };
}

function validateConfig(config: CsvConvertConfig): void {
  requireNonEmpty(config.outputPath, 'outputPath');
  requireNonEmpty(config.namespace, 'namespace');
  requireNonEmpty(config.sourceSystem, 'sourceSystem');
  if (config.producerVersion !== undefined) {
    requireNonEmpty(config.producerVersion, 'producerVersion');
  }
  if (!Array.isArray(config.files) || config.files.length === 0) {
    throw new Error('Conversion config must list at least one file entry in "files".');
  }
  config.files.forEach((entry, index) => {
    const where = `files[${index}]`;
    if (!(AMP_ENTITY_TABLES as readonly string[]).includes(entry.entityType)) {
      throw new Error(
        `${where}: entityType "${String(entry.entityType)}" is not an AMP entity table. ` +
          `Expected one of: ${AMP_ENTITY_TABLES.join(', ')}.`
      );
    }
    requireNonEmpty(entry.path, `${where}.path`);
    if (
      entry.mapping === null ||
      typeof entry.mapping !== 'object' ||
      Array.isArray(entry.mapping) ||
      Object.keys(entry.mapping).length === 0
    ) {
      throw new Error(`${where}: mapping must be a non-empty object of source header -> AMP column.`);
    }
    for (const [header, target] of Object.entries(entry.mapping)) {
      if (typeof target !== 'string' || target.length === 0) {
        throw new Error(`${where}: mapping for source column "${header}" must be a column name.`);
      }
    }
    if (entry.referenceBy !== undefined && entry.referenceBy !== 'source_record_id') {
      throw new Error(
        `${where}: referenceBy "${String(entry.referenceBy)}" is not supported; the only mode is "source_record_id".`
      );
    }
  });
}

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Conversion option "${name}" must be a non-empty string.`);
  }
}

/**
 * Conversion diagnostics also land in the package's `package_diagnostics`
 * table, capped at 500 rows; a final info row records any truncation.
 */
function toDiagnosticRows(diagnostics: CsvConversionDiagnostic[]): AmpPackageDiagnosticRecord[] {
  const truncated = diagnostics.length > MAX_DIAGNOSTIC_ROWS;
  const kept = truncated ? diagnostics.slice(0, MAX_DIAGNOSTIC_ROWS - 1) : diagnostics;
  const rows: AmpPackageDiagnosticRecord[] = kept.map((diagnostic, index) => ({
    package_record_id: `diag-${index + 1}`,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    entity_type: diagnostic.entityType ?? null,
  }));
  if (truncated) {
    rows.push({
      package_record_id: `diag-${MAX_DIAGNOSTIC_ROWS}`,
      severity: 'info',
      code: 'CSV_DIAGNOSTICS_TRUNCATED',
      message: `${diagnostics.length - kept.length} further diagnostic(s) were truncated from this table.`,
    });
  }
  return rows;
}
