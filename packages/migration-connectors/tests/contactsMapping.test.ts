import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmpSqliteReader } from '@alga-psa/migration-sdk';
import {
  CLIENT_NAME_COLUMN,
  convertSpreadsheets,
  FULL_NAME_COLUMN,
  inferSpreadsheetMapping,
  type CsvConvertConfig,
} from '../src/csv/index';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'amp-contacts-test-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeSpreadsheet(name: string, contents: string): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, contents);
  return path;
}

async function convertContacts(path: string, mapping?: Record<string, string>) {
  const outputPath = join(workDir, `${path.split('/').pop()}.amp`);
  const config: CsvConvertConfig = {
    outputPath,
    namespace: 'contacts-test',
    sourceSystem: 'contacts-csv',
    files: [
      {
        entityType: 'contacts',
        path,
        mapping: mapping ?? (await inferSpreadsheetMapping(path, 'contacts')),
      },
    ],
  };
  return convertSpreadsheets(config, workDir);
}

describe('contacts header mapping', () => {
  it('maps Name, Email, and Client for contacts', async () => {
    const path = await writeSpreadsheet('name-email-client.csv', 'Name,Email,Client\nJane Doe,jane@example.com,Acme\n');
    await expect(inferSpreadsheetMapping(path, 'contacts')).resolves.toEqual({
      Name: FULL_NAME_COLUMN,
      Email: 'email',
      Client: CLIENT_NAME_COLUMN,
    });
  });

  it('is separator-insensitive and covers common contact spellings', async () => {
    const path = await writeSpreadsheet(
      'separators.csv',
      'First-Name,last_name,Email Address,Phone Number,Job Title,Company Name\n'
    );
    await expect(inferSpreadsheetMapping(path, 'contacts')).resolves.toEqual({
      'First-Name': 'first_name',
      last_name: 'last_name',
      'Email Address': 'email',
      'Phone Number': 'phone',
      'Job Title': 'title',
      'Company Name': CLIENT_NAME_COLUMN,
    });
  });

  it('maps client, company, and account spellings for organizations', async () => {
    const path = await writeSpreadsheet('orgs.csv', 'Company Name,Account,Website\n');
    await expect(inferSpreadsheetMapping(path, 'organizations')).resolves.toEqual({
      'Company Name': 'name',
      Account: 'name',
      Website: 'website',
    });
  });

  it('preserves existing asset header inference', async () => {
    const path = await writeSpreadsheet('assets.csv', 'Asset Name,Asset Type,Serial Number,MAC Address\n');
    await expect(inferSpreadsheetMapping(path, 'assets')).resolves.toEqual({
      'Asset Name': 'name',
      'Asset Type': 'asset_type_name',
      'Serial Number': 'serial_number',
    });
  });

  it('splits full names in First Last and Last, First forms, and keeps single tokens usable', async () => {
    const path = await writeSpreadsheet(
      'names.csv',
      'Name,Email\nJane Doe,jane@example.com\n"Doe, John",john@example.com\nPrince,prince@example.com\n'
    );
    const result = await convertContacts(path);
    expect(result.valid).toBe(true);
    expect(result.rowCounts).toEqual({ contacts: 3 });

    const reader = new AmpSqliteReader(result.outputPath);
    try {
      const byEmail = Object.fromEntries(reader.allRows('contacts').map((row) => [row.email, row]));
      expect(byEmail['jane@example.com']).toMatchObject({ first_name: 'Jane', last_name: 'Doe' });
      expect(byEmail['john@example.com']).toMatchObject({ first_name: 'John', last_name: 'Doe' });
      expect(byEmail['prince@example.com']).toMatchObject({ first_name: 'Prince', last_name: null });
    } finally {
      reader.close();
    }
  });

  it('carries the client name through conversion instead of dropping it', async () => {
    const path = await writeSpreadsheet('client.csv', 'Name,Email,Client\nJane Doe,jane@example.com,Acme Managed Networks\n');
    const result = await convertContacts(path);
    expect(result.valid).toBe(true);

    const reader = new AmpSqliteReader(result.outputPath);
    try {
      const [contact] = reader.allRows('contacts');
      expect(JSON.parse(String(contact.extension_json))).toEqual({
        __contact_client_name: 'Acme Managed Networks',
      });
    } finally {
      reader.close();
    }
  });

  it('skips rows with no email or no name and reports a diagnostic', async () => {
    const path = await writeSpreadsheet(
      'unusable.csv',
      'Name,Email\nJane Doe,\n,orphan@example.com\nGood Name,good@example.com\n'
    );
    const result = await convertContacts(path);
    expect(result.valid).toBe(true);
    expect(result.rowCounts).toEqual({ contacts: 1 });

    const missing = result.diagnostics.filter((diagnostic) => diagnostic.code === 'CSV_MISSING_REQUIRED');
    expect(missing).toHaveLength(2);
    expect(missing.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
  });

  it('names every header that did not map as a diagnostic', async () => {
    const path = await writeSpreadsheet('unmapped.csv', 'Name,Email,Favorite Color\nJane Doe,jane@example.com,Blue\n');
    const result = await convertContacts(path);

    const unmapped = result.diagnostics.find((diagnostic) => diagnostic.code === 'CSV_UNMAPPED_COLUMN');
    expect(unmapped).toBeDefined();
    expect(unmapped?.message).toContain('Favorite Color');
    expect(unmapped?.message).toContain('extension_json');
  });

  it('rejects a contacts mapping that targets another entity sentinel', async () => {
    const path = await writeSpreadsheet('bad-target.csv', 'Name,Email\nJane Doe,jane@example.com\n');
    await expect(
      convertContacts(path, { Name: FULL_NAME_COLUMN, Email: 'email', Extra: 'client_name' })
    ).rejects.toThrow(/mapped source column "Extra" is not present/);
  });
});
