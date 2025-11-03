import { describe, it, expect } from 'vitest';
import { CsvImporter } from '@/lib/imports/CsvImporter';
import * as XLSX from 'xlsx';

describe('CsvImporter', () => {
  it('parses CSV with headers and trims values', async () => {
    const importer = new CsvImporter();
    const csv = 'name, serial_number\n Workstation-1 , SN-001 \n';

    const records = await importer.parse(csv);

    expect(records).toHaveLength(1);
    expect(records[0].rowNumber).toBe(2);
    expect(records[0].raw).toEqual({ name: 'Workstation-1', serial_number: 'SN-001' });
  });

  it('parses tab-delimited files via delimiter detection', async () => {
    const importer = new CsvImporter();
    const csv = 'name\tasset_type\nDevice\tworkstation';

    const records = await importer.parse(csv);

    expect(records).toHaveLength(1);
    expect(records[0].raw).toEqual({ name: 'Device', asset_type: 'workstation' });
  });

  it('parses XLSX workbook into records', async () => {
    const importer = new CsvImporter();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['name', 'asset_type'],
      ['Server-1', 'server'],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const records = await importer.parse(buffer as Buffer);

    expect(records).toHaveLength(1);
    expect(records[0].raw).toEqual({ name: 'Server-1', asset_type: 'server' });
  });

  it('collects validation errors for empty rows', async () => {
    const importer = new CsvImporter();
    const result = await importer.validate([
      { rowNumber: 1, raw: {}, normalized: {} },
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Row is empty');
  });
});
