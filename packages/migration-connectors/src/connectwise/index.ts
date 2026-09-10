import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import type { AmpConnector, AmpConnectorDescriptor } from '../framework';
import {
  runConversion,
  parseSpreadsheet,
  normalizeDateOnly,
  normalizeTimestamp,
  type CsvValueTransform,
  type EntityRowsInput,
} from '../csv/index';

/**
 * `connectwise-psa-csv`: converts a directory of ConnectWise PSA CSV exports
 * into one AMP package. The expected filenames and columns are documented in
 * README.md next to this file.
 */

interface ConnectWiseFile {
  fileName: string;
  entityType: AmpEntityType;
  mapping: Record<string, string>;
}

const CONNECTWISE_FILES: ConnectWiseFile[] = [
  {
    fileName: 'companies.csv',
    entityType: 'organizations',
    mapping: {
      Company_RecID: 'source_record_id',
      Company_Name: 'name',
      Website_URL: 'website',
      PhoneNbr: 'phone',
    },
  },
  {
    fileName: 'sites.csv',
    entityType: 'locations',
    mapping: {
      Site_RecID: 'source_record_id',
      Company_RecID: 'organization_package_record_id',
      Site_Name: 'name',
      Address_Line1: 'address_line1',
      Address_Line2: 'address_line2',
      City: 'city',
      State_ID: 'region',
      Zip: 'postal_code',
      Country: 'country_code',
    },
  },
  {
    fileName: 'contacts.csv',
    entityType: 'contacts',
    mapping: {
      Contact_RecID: 'source_record_id',
      Company_RecID: 'organization_package_record_id',
      First_Name: 'first_name',
      Last_Name: 'last_name',
      Email: 'email',
      Phone: 'phone',
      Title: 'title',
    },
  },
  {
    fileName: 'service_tickets.csv',
    entityType: 'tickets',
    mapping: {
      SR_Service_RecID: 'source_record_id',
      Company_RecID: 'organization_package_record_id',
      Contact_RecID: 'requester_package_record_id',
      Summary: 'title',
      Detail_Description: 'description',
      Status_Description: 'status_name',
      Urgency: 'priority_name',
      SR_Board_Name: 'category_name',
      Date_Entered_UTC: 'created_at',
      Last_Update_UTC: 'updated_at',
      Date_Closed_UTC: 'closed_at',
    },
  },
  {
    fileName: 'ticket_notes.csv',
    entityType: 'ticket_comments',
    mapping: {
      SR_Detail_RecID: 'source_record_id',
      SR_Service_RecID: 'ticket_package_record_id',
      Contact_RecID: 'author_package_record_id',
      Detail_Notes: 'body',
      Internal_Flag: 'is_internal',
      Date_Created_UTC: 'created_at',
    },
  },
  {
    fileName: 'configurations.csv',
    entityType: 'assets',
    mapping: {
      Config_RecID: 'source_record_id',
      Company_RecID: 'organization_package_record_id',
      Config_Name: 'name',
      Config_Type: 'asset_type_name',
      Serial_Nbr: 'serial_number',
      Manufacturer_Name: 'manufacturer',
      Model_Nbr: 'model',
      Purchase_Date: 'purchase_date',
    },
  },
];

const TIMESTAMP_TARGETS = new Set(['created_at', 'updated_at', 'closed_at']);

const CW_DATE_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const CW_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function pad2(value: string): string {
  return value.padStart(2, '0');
}

/** `M/D/YYYY H:MM[:SS]` — ConnectWise exports label these columns `_UTC`. */
function parseConnectWiseDateTime(value: string): string | undefined {
  const match = value.match(CW_DATE_TIME);
  if (!match) {
    return undefined;
  }
  const [, month, day, year, hour = '0', minute = '00', second = '00'] = match;
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${minute}:${second}Z`;
}

function parseConnectWiseDate(value: string): string | undefined {
  const match = value.match(CW_DATE);
  if (!match) {
    return undefined;
  }
  return `${match[3]}-${pad2(match[1])}-${pad2(match[2])}`;
}

const transformConnectWiseValue: CsvValueTransform = (target, value, warn) => {
  if (TIMESTAMP_TARGETS.has(target)) {
    const normalized = normalizeTimestamp(value) ?? parseConnectWiseDateTime(value);
    if (normalized === undefined) {
      warn(
        'CW_INVALID_TIMESTAMP',
        `"${value}" is neither an ISO timestamp nor M/D/YYYY H:MM; the value was dropped.`
      );
      return undefined;
    }
    return normalized;
  }
  if (target === 'purchase_date') {
    const normalized = normalizeDateOnly(value) ?? parseConnectWiseDate(value);
    if (normalized === undefined) {
      warn(
        'CW_INVALID_DATE',
        `"${value}" is neither YYYY-MM-DD nor M/D/YYYY; the value was dropped.`
      );
      return undefined;
    }
    return normalized;
  }
  return value;
};

export const connectwisePsaCsvDescriptor: AmpConnectorDescriptor = {
  name: 'connectwise-psa-csv',
  version: '1.0.0',
  supportedAmpVersions: '1.0.x',
  sourceSystem: 'connectwise-psa',
  sourceSystemVersions: 'ConnectWise PSA (Manage) CSV exports, 2023.1 and later',
  entityCoverage: {
    organizations: 'companies.csv (Companies)',
    locations: 'sites.csv (Company Sites)',
    contacts: 'contacts.csv (Contacts)',
    tickets: 'service_tickets.csv (Service Tickets)',
    ticket_comments: 'ticket_notes.csv (Service Ticket Notes)',
    assets: 'configurations.csv (Configurations)',
  },
  knownOmissions: [
    'Time entries are not exported.',
    'Agreements and agreement additions are not exported.',
    'Invoices and other billing records are not exported.',
    'Attachments and documents are not exported (AMP v1 carries no binaries).',
    'Boards, members, statuses, and workflow rules are tenant taxonomy; only their names travel on tickets.',
  ],
  prerequisites: [
    'CSV exports of Companies, Sites, Contacts, Service Tickets, Ticket Notes, and Configurations, ' +
      'saved with the documented headers as companies.csv, sites.csv, contacts.csv, ' +
      'service_tickets.csv, ticket_notes.csv, and configurations.csv in one directory.',
    'A ConnectWise PSA login with report/export permission over those six record types.',
  ],
};

export const connectwisePsaCsvConnector: AmpConnector = {
  descriptor: connectwisePsaCsvDescriptor,

  async produce({ inputDir, outputPath, namespace }) {
    requireNonEmpty(inputDir, 'inputDir');
    requireNonEmpty(outputPath, 'outputPath');
    requireNonEmpty(namespace, 'namespace');

    const missing = CONNECTWISE_FILES.filter(
      (file) => !existsSync(join(inputDir, file.fileName))
    ).map((file) => file.fileName);
    if (missing.length > 0) {
      throw new Error(
        `ConnectWise export directory ${inputDir} is missing required file(s): ${missing.join(', ')}. ` +
          `Expected: ${CONNECTWISE_FILES.map((file) => file.fileName).join(', ')}.`
      );
    }

    const inputs: EntityRowsInput[] = [];
    for (const file of CONNECTWISE_FILES) {
      const sheet = await parseSpreadsheet(join(inputDir, file.fileName));
      inputs.push({
        entityType: file.entityType,
        label: file.fileName,
        headers: sheet.headers,
        rows: sheet.rows,
        mapping: file.mapping,
        transformValue: transformConnectWiseValue,
      });
    }

    const result = await runConversion({
      outputPath,
      namespace: `connectwise:${namespace}`,
      sourceSystem: connectwisePsaCsvDescriptor.sourceSystem,
      producerName: connectwisePsaCsvDescriptor.name,
      producerVersion: connectwisePsaCsvDescriptor.version,
      inputs,
    });

    if (!result.valid) {
      throw new Error(
        `connectwise-psa-csv produced a package that fails AMP validation ` +
          `(${result.validationDiagnosticCount} diagnostic(s)). ` +
          `Inspect ${outputPath} with "alga-migrate validate".`
      );
    }

    return { manifest: result.manifest, rowCounts: result.rowCounts };
  },
};

function requireNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`connectwise-psa-csv requires a non-empty "${name}".`);
  }
}
