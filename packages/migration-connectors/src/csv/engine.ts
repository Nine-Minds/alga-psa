import {
  AMP_ASSUMED_CURRENCY_EXTENSION_KEY,
  AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY,
  AMP_ENTITY_REFERENCES,
  AMP_LIMITS,
  AMP_TABLE_COLUMNS,
  type AmpEntityType,
  type AmpRecord,
  type AmpCustomFieldValueRecord,
} from '@alga-psa/migration-spec';
import {
  normalizeBooleanFlag,
  normalizeCurrencyCode,
  normalizeDateOnly,
  normalizeTimestamp,
  normalizeWholeNumber,
  parseMoneyToMinorUnits,
  type MoneyParseFailure,
} from './values';

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
  /**
   * ISO 4217 code whose minor-unit exponent is used for a money cell whose
   * currency cell is blank (the tenant's currency, resolved by the caller).
   * The record's currency column stays null so the applier resolves the
   * tenant currency at apply time; the assumption is recorded in
   * `extension_json` so the applier can refuse a mismatched tenant currency.
   */
  defaultCurrency?: string;
}

export interface BuiltEntityRows {
  entityRows: Partial<Record<AmpEntityType, AmpRecord[]>>;
  customFieldValues: AmpCustomFieldValueRecord[];
  rowCounts: Record<string, number>;
}

/** Columns the converter derives itself; mapping onto them is a config error. */
const DERIVED_COLUMNS = ['package_record_id', 'external_identifier_namespace', 'extension_json'];

/**
 * Mapping targets the engine derives from source data rather than copying
 * verbatim. They are not AMP columns, so they are valid only where the engine
 * knows how to expand them.
 */
export const FULL_NAME_COLUMN = 'full_name';
export const CLIENT_NAME_COLUMN = 'client_name';
const SPECIAL_MAPPING_TARGETS: ReadonlySet<string> = new Set([FULL_NAME_COLUMN, CLIENT_NAME_COLUMN]);

/** Money column -> the currency column that supplies its minor-unit exponent. */
export const MONEY_COLUMN_CURRENCY: Readonly<Record<string, string>> = {
  price_minor: 'price_currency',
  cost_minor: 'cost_currency',
  unit_cost_minor: 'cost_currency',
};
/**
 * A sheet with one generic `Currency` column maps it to `price_currency`; cost
 * falls back to it when the row has no cost currency of its own, so a cost is
 * never read or stored under the tenant currency when the sheet declared one.
 */
const CURRENCY_FALLBACK: Readonly<Record<string, string>> = { cost_currency: 'price_currency' };
const CURRENCY_COLUMNS: ReadonlySet<string> = new Set(['price_currency', 'cost_currency']);
const FLAG_COLUMNS: ReadonlySet<string> = new Set(['is_internal', 'is_active', 'is_preferred']);
const MAX_LEAD_TIME_DAYS = 3650;

const MONEY_FAILURE_MESSAGES: Record<MoneyParseFailure, string> = {
  currency: 'its currency is not a supported ISO 4217 code',
  negative: 'negative amounts are not allowed',
  precision: 'it has more decimal places than the currency allows',
  invalid: 'it is not a plain decimal amount (digits with an optional decimal point)',
  overflow: 'it is too large',
};

const TIMESTAMP_COLUMNS = ['created_at', 'updated_at', 'closed_at'];

/**
 * Non-reference columns a row must carry to be writable at all; rows missing
 * one are skipped with a diagnostic instead of producing an invalid package.
 * Mirrors the validator's required-text rules (spec `NOT NULL` columns).
 */
const REQUIRED_TEXT_COLUMNS: Record<AmpEntityType, readonly string[]> = {
  organizations: ['name'],
  locations: ['name'],
  // Contacts must be applicable: email is always required, and at least one
  // name column is required via REQUIRED_ANY_OF_COLUMNS below.
  contacts: ['email'],
  tickets: ['title'],
  ticket_comments: ['body'],
  assets: ['name'],
  products: ['name'],
  vendor_products: ['vendor_name'],
};

/** When declared, at least one of these columns must be non-empty. */
const REQUIRED_ANY_OF_COLUMNS: Partial<Record<AmpEntityType, readonly string[]>> = {
  contacts: ['first_name', 'last_name'],
  // A price-list row must say which product it prices: either a product
  // record from the same package or a SKU matched against the tenant catalog.
  vendor_products: ['product_package_record_id', 'product_sku'],
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

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Split a single full-name column into first and last name. Handles
 * "First Last" and "Last, First"; a single token becomes the first name so the
 * row stays usable.
 */
function splitFullName(value: string): { firstName: string; lastName: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex >= 0) {
    const lastName = trimmed.slice(0, commaIndex).trim();
    const firstName = trimmed.slice(commaIndex + 1).trim();
    if (!firstName && !lastName) {
      return null;
    }
    return { firstName, lastName };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
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
  const customFieldValues: AmpCustomFieldValueRecord[] = [];
  let customFieldId = 0;

  for (const input of inputs) {
    validateMapping(input);
    const { entityType, label, mapping } = input;

    const records = built.get(entityType) ?? [];
    built.set(entityType, records);
    const ids = idsByEntity.get(entityType) ?? new Set<string>();
    idsByEntity.set(entityType, ids);

    // Name every header that did not map, once per file, so the operator can
    // see a dropped client column before apply instead of after.
    for (const header of input.headers) {
      if (Object.prototype.hasOwnProperty.call(mapping, header)) {
        continue;
      }
      diagnostics.push({
        severity: 'info',
        code: 'CSV_UNMAPPED_COLUMN',
        message: `${label}: column "${header}" was preserved as a custom field value and can be mapped to an asset-type field during configuration.`,
        entityType,
      });
    }

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
        const raw = Object.prototype.hasOwnProperty.call(row, header) ? row[header] : undefined;
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
      const pendingMoney = new Map<string, { header: string; value: string }>();
      const invalidCurrencyColumns = new Set<string>();
      const leftover = new Map<string, string>();
      let carriedClientName: string | undefined;
      for (const [header, value] of values) {
        const target = Object.prototype.hasOwnProperty.call(mapping, header) ? mapping[header] : undefined;
        if (!target) {
          leftover.set(header, value);
          continue;
        }
        if (target === FULL_NAME_COLUMN) {
          const split = splitFullName(value);
          if (!split) {
            warn(
              'CSV_INVALID_NAME',
              `"${value}" in column "${header}" could not be read as a name; the value was dropped.`
            );
            continue;
          }
          if (split.firstName && !record.first_name) {
            record.first_name = split.firstName;
          }
          if (split.lastName && !record.last_name) {
            record.last_name = split.lastName;
          }
          continue;
        }
        if (target === CLIENT_NAME_COLUMN) {
          carriedClientName = value;
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
        } else if (target in MONEY_COLUMN_CURRENCY) {
          // Parsed after the loop, once the row's currency cell is known.
          pendingMoney.set(target, { header, value: transformed });
        } else if (CURRENCY_COLUMNS.has(target)) {
          const code = normalizeCurrencyCode(transformed);
          if (code === undefined) {
            warn(
              'CSV_INVALID_CURRENCY',
              `"${transformed}" in column "${header}" is not a supported ISO 4217 currency code; amounts that depend on it were dropped.`
            );
            invalidCurrencyColumns.add(target);
            continue;
          }
          record[target] = code;
        } else if (target === 'lead_time_days') {
          const normalized = normalizeWholeNumber(transformed, MAX_LEAD_TIME_DAYS);
          if (normalized === undefined) {
            warn(
              'CSV_INVALID_NUMBER',
              `"${transformed}" in column "${header}" is not a whole number of days between 0 and ${MAX_LEAD_TIME_DAYS}; the value was dropped.`
            );
            continue;
          }
          record[target] = normalized;
        } else if (FLAG_COLUMNS.has(target)) {
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

      for (const [column, fallback] of Object.entries(CURRENCY_FALLBACK)) {
        if (!(column in record) && !invalidCurrencyColumns.has(column)) {
          if (typeof record[fallback] === 'string') record[column] = record[fallback];
          else if (invalidCurrencyColumns.has(fallback)) invalidCurrencyColumns.add(column);
        }
      }

      let assumedCurrency: string | undefined;
      for (const [target, { header, value }] of pendingMoney) {
        const currencyColumn = MONEY_COLUMN_CURRENCY[target];
        if (invalidCurrencyColumns.has(currencyColumn)) {
          warn('CSV_MONEY_DROPPED', `"${value}" in column "${header}" was dropped because its currency cell is invalid.`);
          continue;
        }
        const rowCurrency = typeof record[currencyColumn] === 'string' ? (record[currencyColumn] as string) : undefined;
        const currency = rowCurrency ?? input.defaultCurrency;
        if (currency === undefined) {
          warn(
            'CSV_MISSING_CURRENCY',
            `"${value}" in column "${header}" has no currency and no default currency is available to read its decimals; the value was dropped.`
          );
          continue;
        }
        const parsed = parseMoneyToMinorUnits(value, currency);
        if (parsed.ok === false) {
          warn(
            'CSV_INVALID_MONEY',
            `"${value}" in column "${header}" is not a valid ${currency} amount: ${MONEY_FAILURE_MESSAGES[parsed.reason]}; the value was dropped.`
          );
          continue;
        }
        record[target] = parsed.minor;
        if (rowCurrency === undefined) {
          assumedCurrency = currency;
        }
      }

      if (carriedClientName !== undefined) {
        leftover.set(AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY, carriedClientName);
      }

      let sourceRecordId = record.source_record_id;
      if (typeof sourceRecordId !== 'string' || sourceRecordId.length === 0) {
        sourceRecordId = `row-${sourceRow}`;
        record.source_record_id = sourceRecordId;
        derivedRowIds += 1;
      }

      const missing = requiredColumns(entityType).filter((column) => isEmptyValue(record[column]));
      const anyOf = REQUIRED_ANY_OF_COLUMNS[entityType];
      const anyOfMissing = anyOf !== undefined && anyOf.every((column) => isEmptyValue(record[column]));
      if (missing.length > 0 || anyOfMissing) {
        const missingColumns = anyOfMissing && anyOf ? [...missing, ...anyOf] : missing;
        warn(
          'CSV_MISSING_REQUIRED',
          `required column(s) ${missingColumns.join(', ')} are missing; the row was skipped.`
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

      for (const [header, value] of leftover) {
        if (header === AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY) continue;
        const valueJson = JSON.stringify(value);
        if (Buffer.byteLength(valueJson, 'utf8') > AMP_LIMITS.extensionJsonBytes) {
          warn('CSV_CUSTOM_FIELD_TOO_LARGE', `unmapped column "${header}" exceeds the ${AMP_LIMITS.extensionJsonBytes}-byte custom field value limit and was dropped.`);
          continue;
        }
        customFieldValues.push({
          package_record_id: `cfv-${++customFieldId}`,
          entity_type: entityType,
          entity_package_record_id: packageRecordId,
          field_name: header,
          value_json: valueJson,
        });
      }
      const extensionValues = new Map([...leftover].filter(([key]) => key === AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY));
      if (assumedCurrency !== undefined) {
        extensionValues.set(AMP_ASSUMED_CURRENCY_EXTENSION_KEY, assumedCurrency);
      }
      if (extensionValues.size > 0) {
        const json = JSON.stringify(Object.fromEntries(extensionValues));
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
  return { entityRows, customFieldValues, rowCounts };
}

function validateMapping(input: EntityRowsInput): void {
  const { entityType, label, mapping } = input;
  const allowedColumns = AMP_TABLE_COLUMNS[entityType];
  for (const [header, target] of Object.entries(mapping)) {
    if (!input.headers.includes(header)) {
      throw new Error(
        `${label}: mapped source column "${header}" is not present in the file header (${input.headers.join(', ')}).`
      );
    }
    if (DERIVED_COLUMNS.includes(target)) {
      throw new Error(
        `${label}: mapping target "${target}" is derived by the converter and cannot be mapped from source column "${header}".`
      );
    }
    if (SPECIAL_MAPPING_TARGETS.has(target)) {
      if (entityType !== 'contacts') {
        throw new Error(
          `${label}: mapping target "${target}" is only valid for contacts.`
        );
      }
      continue;
    }
    if (!allowedColumns.includes(target)) {
      throw new Error(
        `${label}: mapping target "${target}" is not a column of AMP entity "${entityType}". ` +
          `Allowed targets: ${allowedColumns.join(', ')}.`
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
