import { describe, it, expect } from 'vitest';
import { CsvImporter } from '@/lib/imports/CsvImporter';
import ExcelJS from 'exceljs';

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
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    worksheet.addRow(['name', 'asset_type']);
    worksheet.addRow(['Server-1', 'server']);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const records = await importer.parse(buffer);

    expect(records).toHaveLength(1);
    expect(records[0].raw).toEqual({ name: 'Server-1', asset_type: 'server' });
  });

  it('formats XLSX numbers, dates, and empty cells like text output', async () => {
    const importer = new CsvImporter();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    worksheet.addRow(['name', 'purchase_count', 'purchased_at', 'notes']);
    worksheet.addRow(['Server-1', 42, new Date(Date.UTC(2026, 0, 15, 10, 30, 0)), null]);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const records = await importer.parse(buffer);

    expect(records).toHaveLength(1);
    expect(records[0].raw).toEqual({
      name: 'Server-1',
      purchase_count: '42',
      purchased_at: '2026-01-15T10:30:00',
      notes: null,
    });
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
