import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import {
  AMP_ALLOWLISTED_TABLES,
  AMP_AUXILIARY_TABLES,
  AMP_DIAGNOSTIC_SEVERITIES,
  AMP_ENTITY_REFERENCES,
  AMP_ENTITY_TABLES,
  AMP_LIMITS,
  AMP_TABLE_COLUMNS,
  isSupportedFormatVersion,
  unsupportedVersionReason,
  type AmpEntityType,
  type AmpErrorCode,
  type AmpLimits,
  type AmpManifest,
  type AmpTable,
} from '@alga-psa/migration-spec';
import { AmpSqliteReader } from './reader';
import { canonicalContentSha256 } from './hash';

export interface AmpDiagnostic {
  code: AmpErrorCode;
  message: string;
  table?: string;
  recordId?: string;
  field?: string;
}

export interface AmpValidationResult {
  valid: boolean;
  diagnostics: AmpDiagnostic[];
  manifest?: AmpManifest;
  rowCounts: Partial<Record<AmpTable, number>>;
}

const SQLITE_HEADER = 'SQLite format 3\u0000';
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const ENTITY_TIMESTAMP_COLUMNS = ['created_at', 'updated_at', 'closed_at'];
const ENTITY_DATE_COLUMNS = ['purchase_date'];
const ENTITY_REQUIRED_TEXT: Record<AmpEntityType, readonly string[]> = {
  organizations: ['name'],
  locations: ['organization_package_record_id', 'name'],
  contacts: [],
  tickets: ['title'],
  ticket_comments: ['ticket_package_record_id', 'body'],
  assets: ['name'],
};

function readHeader(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const bytesRead = readSync(fd, buffer, 0, 16, 0);
    return buffer.subarray(0, bytesRead).toString('latin1');
  } finally {
    closeSync(fd);
  }
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce<number>((max, item) => Math.max(max, jsonDepth(item)), 0);
  }
  if (value !== null && typeof value === 'object') {
    return (
      1 +
      Object.values(value as Record<string, unknown>).reduce<number>(
        (max, item) => Math.max(max, jsonDepth(item)),
        0
      )
    );
  }
  return 0;
}

/**
 * Full structural + semantic validation of an AMP package file.
 * Enforces: SQLite header, size and row limits, table/column allowlists,
 * forbidden objects, manifest shape and version, value rules, per-table
 * record-id uniqueness, relationship resolution, and the canonical hash.
 */
export function validateAmpPackage(
  path: string,
  limits: AmpLimits = AMP_LIMITS
): AmpValidationResult {
  const diagnostics: AmpDiagnostic[] = [];
  const rowCounts: Partial<Record<AmpTable, number>> = {};

  if (!existsSync(path)) {
    return {
      valid: false,
      diagnostics: [{ code: 'AMP_FILE_NOT_FOUND', message: `No file at ${path}.` }],
      rowCounts,
    };
  }

  const sizeBytes = statSync(path).size;
  if (sizeBytes > limits.packageBytes) {
    diagnostics.push({
      code: 'AMP_LIMIT_EXCEEDED',
      message: `Package is ${sizeBytes} bytes; the limit is ${limits.packageBytes}.`,
    });
  }

  if (readHeader(path) !== SQLITE_HEADER) {
    diagnostics.push({ code: 'AMP_NOT_SQLITE', message: 'File header is not a SQLite header.' });
    return { valid: false, diagnostics, rowCounts };
  }

  let reader: AmpSqliteReader;
  try {
    reader = new AmpSqliteReader(path);
  } catch (error) {
    diagnostics.push({
      code: 'AMP_NOT_SQLITE',
      message: `SQLite could not open the file read-only: ${(error as Error).message}`,
    });
    return { valid: false, diagnostics, rowCounts };
  }

  try {
    const presentTables = reader.tableNames();

    for (const table of presentTables) {
      if (table.startsWith('sqlite_')) {
        continue;
      }
      if (!(AMP_ALLOWLISTED_TABLES as readonly string[]).includes(table)) {
        diagnostics.push({
          code: 'AMP_UNKNOWN_TABLE',
          message: `Table "${table}" is not part of AMP v1.`,
          table,
        });
      }
    }

    for (const object of reader.forbiddenObjects()) {
      diagnostics.push({
        code: 'AMP_FORBIDDEN_SQLITE_OBJECT',
        message: `Forbidden SQLite ${object.type} "${object.name}".`,
      });
    }

    for (const table of AMP_ALLOWLISTED_TABLES) {
      if (!presentTables.includes(table)) {
        continue;
      }
      const actual = [...reader.columnNames(table)].sort();
      const expected = [...AMP_TABLE_COLUMNS[table]].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        diagnostics.push({
          code: 'AMP_SCHEMA_MISMATCH',
          message: `Table "${table}" columns [${actual.join(', ')}] do not match the AMP v1 column set.`,
          table,
        });
      }
    }

    const schemaBroken = diagnostics.some(
      (diagnostic) => diagnostic.code === 'AMP_UNKNOWN_TABLE' || diagnostic.code === 'AMP_SCHEMA_MISMATCH'
    );

    let manifest: AmpManifest | undefined;
    if (!presentTables.includes('amp_manifest')) {
      diagnostics.push({ code: 'AMP_INVALID_MANIFEST', message: 'amp_manifest table is missing.' });
    } else if (!schemaBroken) {
      const manifestRows = reader.manifestRows();
      if (manifestRows.length !== 1) {
        diagnostics.push({
          code: 'AMP_INVALID_MANIFEST',
          message: `amp_manifest must contain exactly one row; found ${manifestRows.length}.`,
        });
      }
      manifest = manifestRows[0];
      if (manifest) {
        for (const field of [
          'format_version',
          'package_id',
          'created_at',
          'producer_name',
          'producer_version',
          'source_system',
          'content_sha256',
        ] as const) {
          if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
            diagnostics.push({
              code: 'AMP_INVALID_MANIFEST',
              message: `Manifest field "${field}" is missing or empty.`,
              field,
            });
          }
        }
        if (
          typeof manifest.format_version === 'string' &&
          !isSupportedFormatVersion(manifest.format_version)
        ) {
          diagnostics.push({
            code: 'AMP_UNSUPPORTED_VERSION',
            message: unsupportedVersionReason(manifest.format_version),
            field: 'format_version',
          });
        }
      }
    }

    if (schemaBroken) {
      return { valid: false, diagnostics, manifest, rowCounts };
    }

    let totalEntityRows = 0;
    const entityRows: Partial<Record<string, Record<string, unknown>[]>> = {};
    const idsByTable: Partial<Record<AmpEntityType, Set<string>>> = {};

    for (const table of AMP_ENTITY_TABLES) {
      if (!presentTables.includes(table)) {
        continue;
      }
      const count = reader.rowCount(table);
      rowCounts[table] = count;
      totalEntityRows += count;
      if (count > limits.rowsPerEntity) {
        diagnostics.push({
          code: 'AMP_LIMIT_EXCEEDED',
          message: `Table "${table}" has ${count} rows; the per-entity limit is ${limits.rowsPerEntity}.`,
          table,
        });
        continue;
      }
      const rows = reader.allRows(table);
      entityRows[table] = rows;

      const ids = new Set<string>();
      idsByTable[table] = ids;
      for (const row of rows) {
        validateEntityRow(table, row, limits, diagnostics);
        const id = row.package_record_id;
        if (typeof id === 'string') {
          if (ids.has(id)) {
            diagnostics.push({
              code: 'AMP_DUPLICATE_RECORD_ID',
              message: `package_record_id "${id}" appears more than once in "${table}".`,
              table,
              recordId: id,
            });
          }
          ids.add(id);
        }
      }
    }

    if (totalEntityRows > limits.rowsPerPackage) {
      diagnostics.push({
        code: 'AMP_LIMIT_EXCEEDED',
        message: `Package has ${totalEntityRows} entity rows; the limit is ${limits.rowsPerPackage}.`,
      });
    }

    for (const table of AMP_ENTITY_TABLES) {
      for (const row of entityRows[table] ?? []) {
        for (const reference of AMP_ENTITY_REFERENCES[table]) {
          const value = row[reference.column];
          if (value === null || value === undefined || value === '') {
            if (reference.required) {
              diagnostics.push({
                code: 'AMP_INVALID_VALUE',
                message: `"${reference.column}" is required on ${table} records.`,
                table,
                recordId: String(row.package_record_id ?? ''),
                field: reference.column,
              });
            }
            continue;
          }
          if (!idsByTable[reference.targetTable]?.has(String(value))) {
            diagnostics.push({
              code: 'AMP_INVALID_REFERENCE',
              message: `"${reference.column}" value "${String(value)}" does not resolve in "${reference.targetTable}".`,
              table,
              recordId: String(row.package_record_id ?? ''),
              field: reference.column,
            });
          }
        }
      }
    }

    validateAuxiliaryTables(reader, presentTables, idsByTable, limits, diagnostics);

    if (manifest && typeof manifest.content_sha256 === 'string') {
      const expectedHash = canonicalContentSha256(entityRows);
      if (manifest.content_sha256 !== expectedHash) {
        diagnostics.push({
          code: 'AMP_HASH_MISMATCH',
          message: 'content_sha256 does not match the canonical serialization of entity tables.',
          field: 'content_sha256',
        });
      }
    }

    return { valid: diagnostics.length === 0, diagnostics, manifest, rowCounts };
  } finally {
    reader.close();
  }
}

function validateEntityRow(
  table: AmpEntityType,
  row: Record<string, unknown>,
  limits: AmpLimits,
  diagnostics: AmpDiagnostic[]
): void {
  const recordId = typeof row.package_record_id === 'string' ? row.package_record_id : undefined;

  for (const field of ['package_record_id', 'source_record_id', 'external_identifier_namespace']) {
    const value = row[field];
    if (typeof value !== 'string' || value.length === 0) {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: `"${field}" must be a non-empty string.`,
        table,
        recordId,
        field,
      });
    } else if (Buffer.byteLength(value, 'utf8') > limits.opaqueIdBytes) {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: `"${field}" exceeds the ${limits.opaqueIdBytes}-byte opaque identifier limit.`,
        table,
        recordId,
        field,
      });
    }
  }

  for (const field of ENTITY_REQUIRED_TEXT[table]) {
    const value = row[field];
    if (typeof value !== 'string' || value.length === 0) {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: `"${field}" is required on ${table} records.`,
        table,
        recordId,
        field,
      });
    }
  }

  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > limits.textBytes) {
      diagnostics.push({
        code: 'AMP_LIMIT_EXCEEDED',
        message: `"${field}" exceeds the ${limits.textBytes}-byte text limit.`,
        table,
        recordId,
        field,
      });
    }
  }

  for (const field of ENTITY_TIMESTAMP_COLUMNS) {
    const value = row[field];
    if (value !== null && value !== undefined && (typeof value !== 'string' || !RFC3339_UTC.test(value))) {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: `"${field}" must be an RFC 3339 UTC timestamp (e.g. 2026-01-31T12:00:00Z).`,
        table,
        recordId,
        field,
      });
    }
  }

  for (const field of ENTITY_DATE_COLUMNS) {
    if (!(field in row)) {
      continue;
    }
    const value = row[field];
    if (value !== null && value !== undefined && (typeof value !== 'string' || !DATE_ONLY.test(value))) {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: `"${field}" must be a YYYY-MM-DD date.`,
        table,
        recordId,
        field,
      });
    }
  }

  const extensionJson = row.extension_json;
  if (extensionJson !== null && extensionJson !== undefined) {
    if (typeof extensionJson !== 'string') {
      diagnostics.push({
        code: 'AMP_INVALID_VALUE',
        message: 'extension_json must be a JSON string.',
        table,
        recordId,
        field: 'extension_json',
      });
    } else {
      if (Buffer.byteLength(extensionJson, 'utf8') > limits.extensionJsonBytes) {
        diagnostics.push({
          code: 'AMP_LIMIT_EXCEEDED',
          message: `extension_json exceeds the ${limits.extensionJsonBytes}-byte limit.`,
          table,
          recordId,
          field: 'extension_json',
        });
      }
      try {
        const parsed = JSON.parse(extensionJson);
        if (jsonDepth(parsed) > limits.extensionJsonDepth) {
          diagnostics.push({
            code: 'AMP_LIMIT_EXCEEDED',
            message: `extension_json exceeds nesting depth ${limits.extensionJsonDepth}.`,
            table,
            recordId,
            field: 'extension_json',
          });
        }
      } catch {
        diagnostics.push({
          code: 'AMP_INVALID_VALUE',
          message: 'extension_json is not valid JSON.',
          table,
          recordId,
          field: 'extension_json',
        });
      }
    }
  }
}

function validateAuxiliaryTables(
  reader: AmpSqliteReader,
  presentTables: string[],
  idsByTable: Partial<Record<AmpEntityType, Set<string>>>,
  limits: AmpLimits,
  diagnostics: AmpDiagnostic[]
): void {
  for (const table of AMP_AUXILIARY_TABLES) {
    if (!presentTables.includes(table)) {
      continue;
    }
    for (const row of reader.readRows(table)) {
      const recordId = typeof row.package_record_id === 'string' ? row.package_record_id : undefined;
      const entityType = row.entity_type;

      if (table === 'package_diagnostics') {
        if (!(AMP_DIAGNOSTIC_SEVERITIES as readonly string[]).includes(String(row.severity))) {
          diagnostics.push({
            code: 'AMP_INVALID_VALUE',
            message: `Diagnostic severity "${String(row.severity)}" must be one of ${AMP_DIAGNOSTIC_SEVERITIES.join(', ')}.`,
            table,
            recordId,
            field: 'severity',
          });
        }
        continue;
      }

      if (!(AMP_ENTITY_TABLES as readonly string[]).includes(String(entityType))) {
        diagnostics.push({
          code: 'AMP_INVALID_VALUE',
          message: `entity_type "${String(entityType)}" is not an AMP entity table.`,
          table,
          recordId,
          field: 'entity_type',
        });
        continue;
      }
      const targetIds = idsByTable[entityType as AmpEntityType];
      const target = row.entity_package_record_id;
      if (typeof target !== 'string' || !targetIds?.has(target)) {
        diagnostics.push({
          code: 'AMP_INVALID_REFERENCE',
          message: `entity_package_record_id "${String(target)}" does not resolve in "${String(entityType)}".`,
          table,
          recordId,
          field: 'entity_package_record_id',
        });
      }
      const valueField = table === 'custom_field_values' ? row.value_json : row.value;
      if (
        typeof valueField === 'string' &&
        Buffer.byteLength(valueField, 'utf8') > limits.extensionJsonBytes
      ) {
        diagnostics.push({
          code: 'AMP_LIMIT_EXCEEDED',
          message: `Auxiliary value exceeds the ${limits.extensionJsonBytes}-byte limit.`,
          table,
          recordId,
        });
      }
    }
  }
}
