import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkProducerConformance, validateAmpPackage } from '@alga-psa/migration-sdk';
import {
  BUILT_IN_CONNECTORS,
  ConnectorConversionError,
  connectWisePsaConnector,
  csvConnector,
  packageRecordId,
  writeAlgaExport,
  writeConnectorPackage,
  type ConnectorSourceTables,
} from '../src/index';
import { convertSpreadsheetsToAmp } from '../src/csv';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'amp-connectors-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Six-entity source fixture using the canonical source headers. */
function sixEntitySource(): ConnectorSourceTables {
  return {
    organizations: [
      { id: 'org-1', name: 'Acme Managed Networks', website: 'https://acme.example', phone: '+1-555-0100' },
    ],
    locations: [
      { id: 'loc-1', organization_id: 'org-1', name: 'HQ', city: 'Springfield', country_code: 'US' },
    ],
    contacts: [
      { id: 'c-1', organization_id: 'org-1', location_id: 'loc-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.example' },
    ],
    tickets: [
      { id: 't-1', organization_id: 'org-1', requester_id: 'c-1', title: 'VPN drops', status: 'Open', priority: 'High' },
    ],
    ticket_comments: [
      { id: 'tc-1', ticket_id: 't-1', author_id: 'c-1', body: 'Happened again.', is_internal: 'yes' },
    ],
    assets: [
      { id: 'a-1', organization_id: 'org-1', location_id: 'loc-1', name: 'Edge Firewall', asset_type: 'Firewall', serial_number: 'FW-1', purchase_date: '2023-08-15' },
    ],
  };
}

describe('csvConnector', () => {
  it('converts all six entity tables with resolvable references', () => {
    const records = csvConnector.convert(sixEntitySource());

    for (const entity of csvConnector.declaration.entityCoverage) {
      expect(records[entity], entity).toHaveLength(1);
    }
    expect(records.locations?.[0].organization_package_record_id).toBe(
      records.organizations?.[0].package_record_id
    );
    expect(records.tickets?.[0].requester_package_record_id).toBe(
      records.contacts?.[0].package_record_id
    );
    expect(records.ticket_comments?.[0].ticket_package_record_id).toBe(
      records.tickets?.[0].package_record_id
    );
    expect(records.ticket_comments?.[0].is_internal).toBe(1);
    expect(JSON.parse(String(records.organizations?.[0].extension_json))).toEqual({
      source_row: 2,
    });
  });

  it('produces a package that passes shared conformance', () => {
    const path = join(dir, 'csv-connector.amp');
    const records = csvConnector.convert(sixEntitySource());
    writeConnectorPackage(path, csvConnector.declaration, records);

    const report = checkProducerConformance(path, {
      expectedCounts: {
        organizations: 1,
        locations: 1,
        contacts: 1,
        tickets: 1,
        ticket_comments: 1,
        assets: 1,
      },
    });
    expect(report.validation.diagnostics).toEqual([]);
    expect(report.conformant).toBe(true);
  });

  it('collects row errors for missing required fields instead of emitting bad records', () => {
    expect(() =>
      csvConnector.convert({ organizations: [{ id: 'org-1', website: 'https://no-name.example' }] })
    ).toThrowError(ConnectorConversionError);
    try {
      csvConnector.convert({ organizations: [{ id: 'org-1' }] });
    } catch (error) {
      const conversionError = error as ConnectorConversionError;
      expect(conversionError.errors).toEqual([
        { entity: 'organizations', sourceRow: 2, field: 'name', message: '"name" is required.' },
      ]);
    }
  });
});

describe('connectWisePsaConnector', () => {
  it('normalizes vendor headers and produces a conformant package', () => {
    const records = connectWisePsaConnector.convert({
      organizations: [{ RecID: '19318', Company: 'Globex', Website: 'https://globex.example' }],
      contacts: [
        { RecID: '551', 'Company RecID': '19318', 'First Name': 'Hank', 'Last Name': 'Scorpio', Email: 'hank@globex.example' },
      ],
      tickets: [
        { 'Ticket #': '88123', 'Company RecID': '19318', Summary: 'Server down', Status: 'New', Priority: 'Priority 1', 'Service Type': 'Incident' },
      ],
    });

    expect(records.contacts?.[0].organization_package_record_id).toBe(
      packageRecordId('connectwise-manage', 'organizations', '19318')
    );
    expect(records.tickets?.[0].title).toBe('Server down');

    const path = join(dir, 'connectwise.amp');
    writeConnectorPackage(
      path,
      connectWisePsaConnector.declaration,
      records,
      'connectwise-manage'
    );
    const report = checkProducerConformance(path, {
      expectedCounts: { organizations: 1, contacts: 1, tickets: 1 },
    });
    expect(report.validation.diagnostics).toEqual([]);
    expect(report.conformant).toBe(true);
  });
});

describe('every built-in connector declaration', () => {
  it('declares a name, version, supported AMP versions, coverage, and omissions', () => {
    for (const connector of BUILT_IN_CONNECTORS) {
      expect(connector.declaration.name).toBeTruthy();
      expect(connector.declaration.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(connector.declaration.supportedAmpVersions.length).toBeGreaterThan(0);
      expect(connector.declaration.entityCoverage.length).toBeGreaterThan(0);
      expect(connector.declaration.knownOmissions.length).toBeGreaterThan(0);
    }
  });
});

describe('convertSpreadsheetsToAmp', () => {
  it('converts CSV and XLSX sources into one validated package', async () => {
    await writeFile(
      join(dir, 'orgs.csv'),
      'id,Company Name,website\norg-1,Acme Managed Networks,https://acme.example\n'
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('contacts');
    sheet.addRow(['id', 'organization_id', 'first_name', 'last_name', 'email']);
    sheet.addRow(['c-1', 'org-1', 'Jane', 'Doe', 'jane@acme.example']);
    await workbook.xlsx.writeFile(join(dir, 'contacts.xlsx'));

    const configPath = join(dir, 'convert.json');
    await writeFile(
      configPath,
      JSON.stringify({
        outputPath: 'converted.amp',
        sourceSystem: 'legacy-psa',
        entities: {
          organizations: { file: 'orgs.csv', mapping: { 'Company Name': 'name' } },
          contacts: { file: 'contacts.xlsx' },
        },
      })
    );

    const result = await convertSpreadsheetsToAmp(configPath);
    expect(result.counts).toEqual({ organizations: 1, contacts: 1 });
    expect(result.validation.valid).toBe(true);

    const revalidated = validateAmpPackage(result.outputPath);
    expect(revalidated.valid).toBe(true);
    expect(revalidated.manifest?.producer_name).toBe('alga-csv-adapter');
    expect(revalidated.manifest?.source_system).toBe('legacy-psa');
  });

  it('rejects unknown entity keys', async () => {
    const configPath = join(dir, 'bad-convert.json');
    await writeFile(
      configPath,
      JSON.stringify({ outputPath: 'bad.amp', entities: { invoices: { file: 'orgs.csv' } } })
    );
    await expect(convertSpreadsheetsToAmp(configPath)).rejects.toThrow(/Unknown entity "invoices"/);
  });
});

describe('writeAlgaExport', () => {
  it('packages tenant-filtered canonical records as a conforming producer', () => {
    const path = join(dir, 'alga-export.amp');
    const namespace = 'alga:tenant-1';
    const manifest = writeAlgaExport(
      path,
      {
        organizations: [
          {
            package_record_id: 'org-1',
            source_record_id: 'client-uuid-1',
            external_identifier_namespace: namespace,
            name: 'Exported Client',
          },
        ],
      },
      'tenant-1'
    );
    expect(manifest.producer_name).toBe('alga-export');
    expect(manifest.source_system).toBe('alga-psa');
    expect(manifest.source_instance_id).toBe('tenant-1');

    const validation = validateAmpPackage(path);
    expect(validation.diagnostics).toEqual([]);
    expect(validation.valid).toBe(true);
  });
});
