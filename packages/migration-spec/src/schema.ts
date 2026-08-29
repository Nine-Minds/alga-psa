import { AMP_TABLE_COLUMNS, AMP_ALLOWLISTED_TABLES, type AmpTable } from './tables';

const COLUMN_TYPES: Record<string, string> = {
  is_internal: 'INTEGER',
};

const NOT_NULL_COLUMNS: Record<AmpTable, readonly string[]> = {
  amp_manifest: [
    'format_version',
    'package_id',
    'created_at',
    'producer_name',
    'producer_version',
    'source_system',
    'content_sha256',
  ],
  organizations: ['package_record_id', 'source_record_id', 'external_identifier_namespace', 'name'],
  locations: [
    'package_record_id',
    'source_record_id',
    'external_identifier_namespace',
    'organization_package_record_id',
    'name',
  ],
  contacts: ['package_record_id', 'source_record_id', 'external_identifier_namespace'],
  tickets: ['package_record_id', 'source_record_id', 'external_identifier_namespace', 'title'],
  ticket_comments: [
    'package_record_id',
    'source_record_id',
    'external_identifier_namespace',
    'ticket_package_record_id',
    'body',
  ],
  assets: ['package_record_id', 'source_record_id', 'external_identifier_namespace', 'name'],
  external_identifiers: [
    'package_record_id',
    'entity_type',
    'entity_package_record_id',
    'namespace',
    'value',
  ],
  custom_field_values: [
    'package_record_id',
    'entity_type',
    'entity_package_record_id',
    'field_name',
    'value_json',
  ],
  package_diagnostics: ['package_record_id', 'severity', 'code', 'message'],
};

function createTableSql(table: AmpTable): string {
  const columns = AMP_TABLE_COLUMNS[table].map((column) => {
    const type = COLUMN_TYPES[column] ?? 'TEXT';
    const notNull = NOT_NULL_COLUMNS[table].includes(column) ? ' NOT NULL' : '';
    const primaryKey = column === 'package_record_id' ? ' PRIMARY KEY' : '';
    return `  ${column} ${type}${primaryKey}${notNull}`;
  });
  return `CREATE TABLE ${table} (\n${columns.join(',\n')}\n);`;
}

/** Canonical DDL for a conforming AMP v1 package. */
export const AMP_SCHEMA_SQL = AMP_ALLOWLISTED_TABLES.map(createTableSql).join('\n');
