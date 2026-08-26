import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmpSqliteReader, validateAmpPackage } from '@alga-psa/migration-sdk';
import {
  convertSpreadsheets,
  convertSpreadsheetsToAmp,
  inferSpreadsheetMapping,
  type CsvConvertConfig,
} from '../src/csv/index';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'csv');

const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const ORGANIZATIONS_MAPPING = {
  'Account #': 'source_record_id',
  'Company Name': 'name',
  'Web Site': 'website',
  'Main Phone': 'phone',
};

const LOCATIONS_MAPPING = {
  'Location Id': 'source_record_id',
  'Account #': 'organization_package_record_id',
  'Location Name': 'name',
  Street: 'address_line1',
  City: 'city',
  State: 'region',
  'Postal Code': 'postal_code',
};

function fixtureConfig(outputPath: string): CsvConvertConfig {
  return {
    outputPath,
    namespace: 'fixture-csv:2026-08',
    sourceSystem: 'generic-csv',
    files: [
      {
        entityType: 'organizations',
        path: 'organizations.csv',
        mapping: { ...ORGANIZATIONS_MAPPING },
      },
      {
        entityType: 'locations',
        path: 'locations.csv',
        mapping: { ...LOCATIONS_MAPPING },
        referenceBy: 'source_record_id',
      },
    ],
  };
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'amp-csv-test-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('convertSpreadsheets', () => {
  it('infers canonical headers and legacy asset aliases', async () => {
    const canonicalPath = join(workDir, 'canonical-assets.csv');
    await writeFile(canonicalPath, 'name,serial_number,asset_type_name\nrouter,R-1,network_device\n');
    await expect(inferSpreadsheetMapping(canonicalPath, 'assets')).resolves.toEqual({
      name: 'name', serial_number: 'serial_number', asset_type_name: 'asset_type_name',
    });
    const legacyPath = join(workDir, 'legacy-assets.csv');
    await writeFile(legacyPath, 'Asset Name,Asset Type,Serial Number,MAC Address\nrouter,network_device,R-1,00:11:22:33:44:55\n');
    await expect(inferSpreadsheetMapping(legacyPath, 'assets')).resolves.toEqual({
      'Asset Name': 'name', 'Asset Type': 'asset_type_name', 'Serial Number': 'serial_number',
    });
  });

  it('returns no mapping for a spreadsheet without recognized headers', async () => {
    const path = join(workDir, 'unknown.csv');
    await writeFile(path, 'Unrelated,Columns\na,b\n');
    await expect(inferSpreadsheetMapping(path, 'assets')).resolves.toEqual({});
    await expect(convertSpreadsheets({
      outputPath: join(workDir, 'unknown.amp'), namespace: 'unknown', sourceSystem: 'unknown',
      files: [{ entityType: 'assets', path, mapping: await inferSpreadsheetMapping(path, 'assets') }],
    }, workDir)).rejects.toThrow(/mapping must be a non-empty object/);
  });

  it('converts a legacy asset CSV through inferred mapping into a valid AMP package', async () => {
    const inputPath = join(workDir, 'legacy-convert.csv');
    const outputPath = join(workDir, 'legacy-convert.amp');
    await writeFile(inputPath, 'Asset Name,Asset Type,Serial Number,MAC Address\nrouter,network_device,R-1,00:11:22:33:44:55\n');
    const result = await convertSpreadsheets({ outputPath, namespace: 'legacy-assets', sourceSystem: 'legacy-asset-csv', files: [{ entityType: 'assets', path: inputPath, mapping: await inferSpreadsheetMapping(inputPath, 'assets') }] }, workDir);
    expect(result.valid).toBe(true);
    const reader = new AmpSqliteReader(outputPath);
    try {
      expect(reader.allRows('assets')[0]).toMatchObject({ name: 'router', asset_type_name: 'network_device', serial_number: 'R-1' });
      expect(JSON.parse(String(reader.allRows('assets')[0].extension_json))).toEqual({ 'MAC Address': '00:11:22:33:44:55' });
    } finally { reader.close(); }
  });

  it('converts the generic fixtures into a valid package', async () => {
    const outputPath = join(workDir, 'generic.amp');
    const result = await convertSpreadsheets(fixtureConfig(outputPath), fixturesDir);

    expect(result.valid).toBe(true);
    expect(result.validationDiagnosticCount).toBe(0);
    expect(result.rowCounts).toEqual({ organizations: 3, locations: 3 });

    expect(result.manifest.producer_name).toBe('alga-csv-adapter');
    expect(result.manifest.producer_version).toBe('1.0.0');
    expect(result.manifest.source_system).toBe('generic-csv');
    expect(result.manifest.created_at).toMatch(RFC3339_SECONDS);

    const skip = result.diagnostics.find((diagnostic) => diagnostic.code === 'CSV_MISSING_REQUIRED');
    expect(skip).toMatchObject({
      severity: 'warning',
      entityType: 'organizations',
      sourceRow: 3,
    });
    expect(skip?.message).toContain('name');

    const validation = validateAmpPackage(outputPath);
    expect(validation.valid).toBe(true);

    const reader = new AmpSqliteReader(outputPath);
    try {
      const organizations = reader.allRows('organizations');
      const bluebird = organizations.find(
        (row) => row.package_record_id === 'organizations-ACME-002'
      );
      expect(bluebird).toBeDefined();
      expect(bluebird?.external_identifier_namespace).toBe('fixture-csv:2026-08');
      expect(JSON.parse(String(bluebird?.extension_json))).toEqual({ Region: 'West' });

      const cascade = organizations.find(
        (row) => row.package_record_id === 'organizations-ACME-004'
      );
      expect(cascade?.extension_json).toBeNull();

      const locations = reader.allRows('locations');
      const mainOffice = locations.find((row) => row.package_record_id === 'locations-L-1');
      expect(mainOffice?.organization_package_record_id).toBe('organizations-ACME-001');
      const clinic = locations.find((row) => row.package_record_id === 'locations-L-3');
      expect(clinic?.organization_package_record_id).toBe('organizations-ACME-004');

      const diagnosticRows = reader.allRows('package_diagnostics');
      const skipRow = diagnosticRows.find((row) => row.code === 'CSV_MISSING_REQUIRED');
      expect(skipRow).toMatchObject({
        severity: 'warning',
        entity_type: 'organizations',
      });
    } finally {
      reader.close();
    }
  });

  it('rejects a mapping that targets an unknown canonical column', async () => {
    const config = fixtureConfig(join(workDir, 'never-written.amp'));
    config.files[0].mapping['Company Name'] = 'company_name';
    await expect(convertSpreadsheets(config, fixturesDir)).rejects.toThrow(
      /"company_name" is not a column of AMP entity "organizations"/
    );
  });

  it('converts XLSX sources through the same mapping engine', async () => {
    const xlsxPath = join(workDir, 'organizations.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('organizations');
    sheet.addRow(['Account #', 'Company Name', 'Region']);
    sheet.addRow(['X-1', 'Juniper Bookkeeping', 'North']);
    sheet.addRow(['X-2', 'Copperleaf Landscaping', 'South']);
    await workbook.xlsx.writeFile(xlsxPath);

    const outputPath = join(workDir, 'from-xlsx.amp');
    const result = await convertSpreadsheets(
      {
        outputPath,
        namespace: 'fixture-xlsx:2026-08',
        sourceSystem: 'generic-xlsx',
        files: [
          {
            entityType: 'organizations',
            path: xlsxPath,
            mapping: { 'Account #': 'source_record_id', 'Company Name': 'name' },
          },
        ],
      },
      workDir
    );

    expect(result.valid).toBe(true);
    expect(result.rowCounts).toEqual({ organizations: 2 });

    const reader = new AmpSqliteReader(outputPath);
    try {
      const juniper = reader
        .allRows('organizations')
        .find((row) => row.package_record_id === 'organizations-X-1');
      expect(juniper?.name).toBe('Juniper Bookkeeping');
      expect(JSON.parse(String(juniper?.extension_json))).toEqual({ Region: 'North' });
    } finally {
      reader.close();
    }
  });
});

describe('convertSpreadsheetsToAmp', () => {
  it('resolves file and output paths relative to the config file location', async () => {
    const configPath = join(workDir, 'convert-config.json');
    const config: CsvConvertConfig = {
      outputPath: 'from-config.amp',
      namespace: 'fixture-csv:config',
      sourceSystem: 'generic-csv',
      files: [
        {
          entityType: 'organizations',
          path: join(fixturesDir, 'organizations.csv'),
          mapping: { ...ORGANIZATIONS_MAPPING },
        },
      ],
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await convertSpreadsheetsToAmp(configPath);
    expect(result.valid).toBe(true);
    expect(result.outputPath).toBe(join(workDir, 'from-config.amp'));
    expect(validateAmpPackage(join(workDir, 'from-config.amp')).valid).toBe(true);
  });

  it('fails fast on an unreadable config path', async () => {
    await expect(convertSpreadsheetsToAmp(join(workDir, 'missing.json'))).rejects.toThrow(
      /Cannot read conversion config/
    );
  });
});
