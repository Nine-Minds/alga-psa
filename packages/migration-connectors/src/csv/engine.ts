import {
  AMP_ENTITY_REFERENCES,
  AMP_LIMITS,
  AMP_TABLE_COLUMNS,
  type AmpEntityType,
  type AmpRecord,
} from '@alga-psa/migration-spec';
import { normalizeBooleanFlag, normalizeDateOnly, normalizeTimestamp } from './values';

/**
 * A conversion diagnostic. `sourceRow` is the 1-based data row (the first
 * row after the header is row 1); the same numbering is used for derived
 * `row-<n>` source_record_ids.
 */
export interface CsvConversionDiagnostic {
  severity: 'info' | 'warning';
  code: string;
  message: string;
  entityType?: AmpEntityType;
  sourceRow?: number;
}

/**
 * Optional per-value hook applied to a mapped value before generic
 * normalization. Returning `undefined` drops the value; the hook is expected
 * to have emitted its own warning through `warn`.
 */
export type CsvValueTransform = (
  targetColumn: string,
  value: string,
  warn: (code: string, message: string) => void
) => string | undefined;

/** One parsed source file bound to an AMP entity table. */
export interface EntityRowsInput {
  entityType: AmpEntityType;
  /** Human-readable source label (usually the file path) for diagnostics. */
  label: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  /** Source column header -> canonical AMP column. */
  mapping: Record<string, string>;
  transformValue?: CsvValueTransform;
}

export interface BuiltEntityRows {
  entityRows: Partial<Record<AmpEntityType, AmpRecord[]>>;
  rowCounts: Record<string, number>;
}

/** Columns the converter derives itself; mapping onto them is a config error. */
const DERIVED_COLUMNS = ['package_record_id', 'external_identifier_namespace', 'extension_json'];

const TIMESTAMP_COLUMNS = ['created_at', 'updated_at', 'closed_at'];

/**
 * Non-reference columns a row must carry to be writable at all; rows missing
 * one are skipped with a diagnostic instead of producing an invalid package.
 * Mirrors the validator's required-text rules (spec `NOT NULL` columns).
 */
const REQUIRED_TEXT_COLUMNS: Record<AmpEntityType, readonly string[]> = {
  organizations: ['name'],
  locations: ['name'],
  contacts: [],
  tickets: ['title'],
  ticket_comments: ['body'],
  assets: ['name'],
};

interface BuiltRecord {
  record: Record<string, unknown>;
  sourceRow: number;
  label: string;
}

function requiredColumns(entityType: AmpEntityType): string[] {
  const references = AMP_ENTITY_REFERENCES[entityType]
    .filter((reference) => reference.required)
    .map((reference) => reference.column);
  return [...REQUIRED_TEXT_COLUMNS[entityType], ...references];
}

/**
 * Turn parsed source rows into canonical AMP entity rows.
 *
 * Per row: mapped values are normalized (timestamps, dates, flags), unmapped
 * columns are preserved into `extension_json`, identity columns are derived,
 * and rows that are empty, missing a required column, or duplicate an earlier
 * source id are skipped with a warning diagnostic. After all files are
 * processed, mapped reference columns (which carry SOURCE ids of the target
 * entity) are rewritten to the target's `package_record_id`; unresolvable
 * references are left as-is for the validator to flag, plus a warning.
 */
export function buildEntityRows(
  inputs: EntityRowsInput[],
  namespace: string,
  diagnostics: CsvConversionDiagnostic[]
): BuiltEntityRows {
  const built = new Map<AmpEntityType, BuiltRecord[]>();
  const idsByEntity = new Map<AmpEntityType, Set<string>>();

  for (const input of inputs) {
    validateMapping(input);
    const { entityType, label, mapping } = input;

    const records = built.get(entityType) ?? [];
    built.set(entityType, records);
    const ids = idsByEntity.get(entityType) ?? new Set<string>();
    idsByEntity.set(entityType, ids);

    let derivedRowIds = 0;

    input.rows.forEach((row, index) => {
      const sourceRow = index + 1;
      const warn = (code: string, message: string): void => {
        diagnostics.push({
          severity: 'warning',
          code,
          message: `${label} row ${sourceRow}: ${message}`,
          entityType,
          sourceRow,
        });
      };

      const values = new Map<string, string>();
      for (const header of input.headers) {
        const raw = row[header];
        if (typeof raw !== 'string') {
          continue;
        }
        const trimmed = raw.trim();
        if (trimmed.length > 0) {
          values.set(header, trimmed);
        }
      }
      if (values.size === 0) {
        warn('CSV_EMPTY_ROW', 'the row has no values and was skipped.');
        return;
      }

      const record: Record<string, unknown> = {};
      const leftover: Record<string, string> = {};
      for (const [header, value] of values) {
        const target = mapping[header];
        if (!target) {
          leftover[header] = value;
          continue;
        }
        const transformed = input.transformValue
          ? input.transformValue(target, value, warn)
          : value;
        if (transformed === undefined) {
          continue;
        }
        if (TIMESTAMP_COLUMNS.includes(target)) {
          const normalized = normalizeTimestamp(transformed);
          if (normalized === undefined) {
            warn(
              'CSV_INVALID_TIMESTAMP',
              `"${transformed}" in column "${header}" is not a recognized timestamp; the value was dropped.`
            );
            continue;
          }
          record[target] = normalized;
        } else if (target === 'purchase_date') {
          const normalized = normalizeDateOnly(transformed);
          if (normalized === undefined) {
            warn(
              'CSV_INVALID_DATE',
              `"${transformed}" in column "${header}" is not a YYYY-MM-DD date; the value was dropped.`
            );
            continue;
          }
          record[target] = normalized;
        } else if (target === 'is_internal') {
          const normalized = normalizeBooleanFlag(transformed);
          if (normalized === undefined) {
            warn(
              'CSV_INVALID_FLAG',
              `"${transformed}" in column "${header}" is not a recognized boolean flag; the value was dropped.`
            );
            continue;
          }
          record[target] = normalized;
        } else {
          record[target] = transformed;
        }
      }

      let sourceRecordId = record.source_record_id;
      if (typeof sourceRecordId !== 'string' || sourceRecordId.length === 0) {
        sourceRecordId = `row-${sourceRow}`;
        record.source_record_id = sourceRecordId;
        derivedRowIds += 1;
      }

      const missing = requiredColumns(entityType).filter((column) => {
        const value = record[column];
        return value === undefined || value === '';
      });
      if (missing.length > 0) {
        warn(
          'CSV_MISSING_REQUIRED',
          `required column(s) ${missing.join(', ')} are missing; the row was skipped.`
        );
        return;
      }

      const packageRecordId = `${entityType}-${String(sourceRecordId)}`;
      if (ids.has(packageRecordId)) {
        warn(
          'CSV_DUPLICATE_RECORD',
          `source_record_id "${String(sourceRecordId)}" repeats an earlier ${entityType} row; the row was skipped.`
        );
        return;
      }
      ids.add(packageRecordId);
      record.package_record_id = packageRecordId;
      record.external_identifier_namespace = namespace;

      const leftoverKeys = Object.keys(leftover);
      if (leftoverKeys.length > 0) {
        const json = JSON.stringify(leftover);
        const bytes = Buffer.byteLength(json, 'utf8');
        if (bytes > AMP_LIMITS.extensionJsonBytes) {
          warn(
            'CSV_EXTENSION_TOO_LARGE',
            `unmapped columns serialize to ${bytes} bytes, over the ${AMP_LIMITS.extensionJsonBytes}-byte extension_json limit; they were dropped.`
          );
        } else {
          record.extension_json = json;
        }
      }

      records.push({ record, sourceRow, label });
    });

    if (derivedRowIds > 0) {
      diagnostics.push({
        severity: 'info',
        code: 'CSV_ROW_NUMBER_IDS',
        message:
          `${label}: source_record_id was not mapped for ${derivedRowIds} row(s); ` +
          '1-based data row numbers were used. Keep this export file unchanged so the derived ids stay stable.',
        entityType,
      });
    }
  }

  rewriteReferences(built, idsByEntity, diagnostics);

  const entityRows: Partial<Record<AmpEntityType, AmpRecord[]>> = {};
  const rowCounts: Record<string, number> = {};
  for (const [entityType, records] of built) {
    entityRows[entityType] = records.map((built) => built.record as AmpRecord);
    rowCounts[entityType] = records.length;
  }
  return { entityRows, rowCounts };
}

function validateMapping(input: EntityRowsInput): void {
  const { entityType, label, mapping } = input;
  const allowedColumns = AMP_TABLE_COLUMNS[entityType];
  for (const [header, target] of Object.entries(mapping)) {
    if (DERIVED_COLUMNS.includes(target)) {
      throw new Error(
        `${label}: mapping target "${target}" is derived by the converter and cannot be mapped from source column "${header}".`
      );
    }
    if (!allowedColumns.includes(target)) {
      throw new Error(
        `${label}: mapping target "${target}" is not a column of AMP entity "${entityType}". ` +
          `Allowed targets: ${allowedColumns.join(', ')}.`
      );
    }
    if (!input.headers.includes(header)) {
      throw new Error(
        `${label}: mapped source column "${header}" is not present in the file header (${input.headers.join(', ')}).`
      );
    }
  }
}

function rewriteReferences(
  built: Map<AmpEntityType, BuiltRecord[]>,
  idsByEntity: Map<AmpEntityType, Set<string>>,
  diagnostics: CsvConversionDiagnostic[]
): void {
  for (const [entityType, records] of built) {
    const references = AMP_ENTITY_REFERENCES[entityType];
    for (const { record, sourceRow, label } of records) {
      for (const reference of references) {
        const value = record[reference.column];
        if (typeof value !== 'string' || value.length === 0) {
          continue;
        }
        const rewritten = `${reference.targetTable}-${value}`;
        if (idsByEntity.get(reference.targetTable)?.has(rewritten)) {
          record[reference.column] = rewritten;
        } else {
          diagnostics.push({
            severity: 'warning',
            code: 'CSV_UNRESOLVED_REFERENCE',
            message:
              `${label} row ${sourceRow}: "${reference.column}" value "${value}" does not match ` +
              `any ${reference.targetTable} source_record_id; the value was left as-is.`,
            entityType,
            sourceRow,
          });
        }
      }
    }
  }
}
