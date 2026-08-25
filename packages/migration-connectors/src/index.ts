import { createHash, randomUUID } from 'node:crypto';
import { AmpPackageBuilder } from '@alga-psa/migration-sdk';
import {
  AMP_ENTITY_TABLES,
  type AmpEntityType,
  type AmpManifest,
  type AmpRecord,
} from '@alga-psa/migration-spec';

/**
 * Shared connector contract. A connector converts source-system rows into
 * canonical AMP records. Connectors are deliberately pure: they can produce a
 * package file but can never read or mutate an Alga tenant.
 */
export interface ConnectorDeclaration {
  name: string;
  version: string;
  supportedAmpVersions: readonly string[];
  entityCoverage: readonly AmpEntityType[];
  knownOmissions: readonly string[];
  sourceSystemVersions?: readonly string[];
  licensingPrerequisites?: string;
}

/** One parsed source row: CSV cells, spreadsheet cells, or API fields. */
export type SourceRow = Record<string, string | number | boolean | null | undefined>;

/** Per-entity source rows, keyed by the AMP entity table they map into. */
export type ConnectorSourceTables = Partial<Record<AmpEntityType, SourceRow[]>>;

export type CanonicalRecords = Partial<Record<AmpEntityType, AmpRecord[]>>;

export interface MigrationConnector {
  declaration: ConnectorDeclaration;
  convert(source: ConnectorSourceTables): CanonicalRecords;
}

/** A conversion problem tied to a source row; connectors collect, not throw. */
export interface ConnectorRowError {
  entity: AmpEntityType;
  sourceRow: number;
  field: string;
  message: string;
}

export class ConnectorConversionError extends Error {
  constructor(readonly errors: ConnectorRowError[]) {
    super(
      `Conversion failed with ${errors.length} row error(s); first: ` +
        `${errors[0].entity} row ${errors[0].sourceRow}: ${errors[0].message}`
    );
  }
}

/** Deterministic package_record_id from a source key, stable across runs. */
export function packageRecordId(
  namespace: string,
  entity: AmpEntityType,
  sourceRecordId: string
): string {
  return createHash('sha256')
    .update(`${namespace}:${entity}:${sourceRecordId}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Canonical source-field layout per entity. `text` fields copy through;
 * `ref` fields carry a *source* id of the target entity and are rewritten to
 * that target's deterministic package_record_id.
 */
interface EntityField {
  column: string;
  source: string;
  kind: 'text' | 'ref';
  target?: AmpEntityType;
  required?: boolean;
}

const SHARED_OPTIONAL_FIELDS: EntityField[] = [
  { column: 'created_at', source: 'created_at', kind: 'text' },
  { column: 'updated_at', source: 'updated_at', kind: 'text' },
];

export const ENTITY_SOURCE_FIELDS: Record<AmpEntityType, EntityField[]> = {
  organizations: [
    { column: 'name', source: 'name', kind: 'text', required: true },
    { column: 'website', source: 'website', kind: 'text' },
    { column: 'phone', source: 'phone', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
  locations: [
    {
      column: 'organization_package_record_id',
      source: 'organization_id',
      kind: 'ref',
      target: 'organizations',
      required: true,
    },
    { column: 'name', source: 'name', kind: 'text', required: true },
    { column: 'address_line1', source: 'address_line1', kind: 'text' },
    { column: 'address_line2', source: 'address_line2', kind: 'text' },
    { column: 'city', source: 'city', kind: 'text' },
    { column: 'region', source: 'region', kind: 'text' },
    { column: 'postal_code', source: 'postal_code', kind: 'text' },
    { column: 'country_code', source: 'country_code', kind: 'text' },
    { column: 'phone', source: 'phone', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
  contacts: [
    {
      column: 'organization_package_record_id',
      source: 'organization_id',
      kind: 'ref',
      target: 'organizations',
    },
    {
      column: 'location_package_record_id',
      source: 'location_id',
      kind: 'ref',
      target: 'locations',
    },
    { column: 'first_name', source: 'first_name', kind: 'text' },
    { column: 'last_name', source: 'last_name', kind: 'text' },
    { column: 'email', source: 'email', kind: 'text' },
    { column: 'phone', source: 'phone', kind: 'text' },
    { column: 'title', source: 'title', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
  tickets: [
    {
      column: 'organization_package_record_id',
      source: 'organization_id',
      kind: 'ref',
      target: 'organizations',
    },
    {
      column: 'location_package_record_id',
      source: 'location_id',
      kind: 'ref',
      target: 'locations',
    },
    {
      column: 'requester_package_record_id',
      source: 'requester_id',
      kind: 'ref',
      target: 'contacts',
    },
    { column: 'title', source: 'title', kind: 'text', required: true },
    { column: 'description', source: 'description', kind: 'text' },
    { column: 'status_name', source: 'status', kind: 'text' },
    { column: 'priority_name', source: 'priority', kind: 'text' },
    { column: 'category_name', source: 'category', kind: 'text' },
    { column: 'closed_at', source: 'closed_at', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
  ticket_comments: [
    {
      column: 'ticket_package_record_id',
      source: 'ticket_id',
      kind: 'ref',
      target: 'tickets',
      required: true,
    },
    {
      column: 'author_package_record_id',
      source: 'author_id',
      kind: 'ref',
      target: 'contacts',
    },
    { column: 'body', source: 'body', kind: 'text', required: true },
    { column: 'is_internal', source: 'is_internal', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
  assets: [
    {
      column: 'organization_package_record_id',
      source: 'organization_id',
      kind: 'ref',
      target: 'organizations',
    },
    {
      column: 'location_package_record_id',
      source: 'location_id',
      kind: 'ref',
      target: 'locations',
    },
    { column: 'name', source: 'name', kind: 'text', required: true },
    { column: 'asset_type_name', source: 'asset_type', kind: 'text' },
    { column: 'serial_number', source: 'serial_number', kind: 'text' },
    { column: 'manufacturer', source: 'manufacturer', kind: 'text' },
    { column: 'model', source: 'model', kind: 'text' },
    { column: 'purchase_date', source: 'purchase_date', kind: 'text' },
    ...SHARED_OPTIONAL_FIELDS,
  ],
};

function cellText(value: SourceRow[string]): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Convert one entity's source rows to canonical records. `sourceRowNumber`
 * of the first data row defaults to 2 (row 1 is the header line).
 */
export function convertEntityRows(
  entity: AmpEntityType,
  rows: SourceRow[],
  namespace: string,
  errors: ConnectorRowError[],
  firstSourceRowNumber = 2
): AmpRecord[] {
  const fields = ENTITY_SOURCE_FIELDS[entity];
  const records: AmpRecord[] = [];

  rows.forEach((row, index) => {
    const sourceRowNumber = firstSourceRowNumber + index;
    const sourceRecordId = cellText(row.id) ?? String(index + 1);
    const record: AmpRecord = {
      package_record_id: packageRecordId(namespace, entity, sourceRecordId),
      source_record_id: sourceRecordId,
      external_identifier_namespace: namespace,
      extension_json: JSON.stringify({ source_row: sourceRowNumber }),
    };

    for (const field of fields) {
      const value = cellText(row[field.source]);
      if (value === undefined) {
        if (field.required) {
          errors.push({
            entity,
            sourceRow: sourceRowNumber,
            field: field.source,
            message: `"${field.source}" is required.`,
          });
        }
        continue;
      }
      if (field.kind === 'ref' && field.target) {
        record[field.column] = packageRecordId(namespace, field.target, value);
      } else if (field.column === 'is_internal') {
        record[field.column] = ['1', 'true', 'yes'].includes(value.toLowerCase()) ? 1 : 0;
      } else {
        record[field.column] = value;
      }
    }
    records.push(record);
  });

  return records;
}

/**
 * The built-in CSV/XLSX adapter: each entity arrives as its own table of
 * rows using the canonical source headers above (see docs/reference/amp).
 */
export const csvConnector: MigrationConnector = {
  declaration: {
    name: 'alga-csv-adapter',
    version: '1.0.0',
    supportedAmpVersions: ['1.0.x'],
    entityCoverage: [...AMP_ENTITY_TABLES],
    knownOmissions: ['CSV/XLSX cannot carry binary attachments.'],
  },
  convert(source) {
    const errors: ConnectorRowError[] = [];
    const records: CanonicalRecords = {};
    for (const entity of AMP_ENTITY_TABLES) {
      const rows = source[entity];
      if (rows && rows.length > 0) {
        records[entity] = convertEntityRows(entity, rows, 'csv', errors);
      }
    }
    if (errors.length > 0) {
      throw new ConnectorConversionError(errors);
    }
    return records;
  },
};

/**
 * ConnectWise Manage CSV exports: companies, contacts, and service tickets,
 * exported as separate CSVs whose vendor headers are normalized here. Only
 * portable business fields are carried; boards, members, agreements, and
 * attachments are intentionally omitted (operator mapping resolves targets).
 */
export const connectWisePsaConnector: MigrationConnector = {
  declaration: {
    name: 'connectwise-psa-csv',
    version: '1.0.0',
    supportedAmpVersions: ['1.0.x'],
    sourceSystemVersions: ['ConnectWise PSA (Manage) CSV export'],
    entityCoverage: ['organizations', 'contacts', 'tickets'],
    knownOmissions: [
      'Boards, members, agreements, time entries, invoices, and attachments are not converted.',
    ],
    licensingPrerequisites:
      'A ConnectWise Manage export with permission to read Companies, Contacts, and Service Tickets.',
  },
  convert(source) {
    const errors: ConnectorRowError[] = [];
    const namespace = 'connectwise-manage';
    const normalized: ConnectorSourceTables = {
      organizations: (source.organizations ?? []).map((row) => ({
        id: row.id ?? row.ID ?? row.RecID,
        name: row.name ?? row.Company ?? row['Company Name'],
        website: row.website ?? row.Website,
        phone: row.phone ?? row.Phone ?? row.PhoneNumber,
      })),
      contacts: (source.contacts ?? []).map((row) => ({
        id: row.id ?? row.ID ?? row.RecID,
        organization_id: row.organization_id ?? row.company_id ?? row['Company RecID'],
        first_name: row.first_name ?? row['First Name'],
        last_name: row.last_name ?? row['Last Name'],
        email: row.email ?? row.Email,
        phone: row.phone ?? row.Phone,
        title: row.title ?? row.Title,
      })),
      tickets: (source.tickets ?? []).map((row) => ({
        id: row.id ?? row.ID ?? row['Ticket #'] ?? row.RecID,
        organization_id: row.organization_id ?? row.company_id ?? row['Company RecID'],
        title: row.title ?? row.summary ?? row.Summary,
        description: row.description ?? row.Description ?? row['Initial Description'],
        status: row.status ?? row.Status,
        priority: row.priority ?? row.Priority,
        category: row.category ?? row.Type ?? row['Service Type'],
        closed_at: row.closed_at ?? row['Closed Date'],
      })),
    };
    const records: CanonicalRecords = {};
    for (const entity of ['organizations', 'contacts', 'tickets'] as const) {
      const rows = normalized[entity] ?? [];
      if (rows.length > 0) {
        records[entity] = convertEntityRows(entity, rows, namespace, errors);
      }
    }
    if (errors.length > 0) {
      throw new ConnectorConversionError(errors);
    }
    return records;
  },
};

export const BUILT_IN_CONNECTORS: readonly MigrationConnector[] = [
  csvConnector,
  connectWisePsaConnector,
];

/** Write a package for a connector's canonical records. */
export function writeConnectorPackage(
  path: string,
  declaration: ConnectorDeclaration,
  records: CanonicalRecords,
  sourceSystem = declaration.name,
  sourceInstanceId?: string
): AmpManifest {
  return new AmpPackageBuilder(path).write(
    {
      format_version: '1.0.0',
      package_id: randomUUID(),
      created_at: new Date().toISOString(),
      producer_name: declaration.name,
      producer_version: declaration.version,
      source_system: sourceSystem,
      source_instance_id: sourceInstanceId ?? null,
    },
    records as Record<string, AmpRecord[]>
  );
}

export const ALGA_EXPORT_DECLARATION: ConnectorDeclaration = {
  name: 'alga-export',
  version: '1.0.0',
  supportedAmpVersions: ['1.0.x'],
  entityCoverage: [...AMP_ENTITY_TABLES],
  knownOmissions: ['Binary attachments are not included in AMP v1.'],
};

/**
 * Package an Alga tenant export. Callers (the server-side export service)
 * supply already-tenant-filtered canonical records; this package never
 * queries Alga itself.
 */
export function writeAlgaExport(
  path: string,
  records: CanonicalRecords,
  sourceInstanceId: string
): AmpManifest {
  return writeConnectorPackage(path, ALGA_EXPORT_DECLARATION, records, 'alga-psa', sourceInstanceId);
}
