/**
 * Tests for the pure parsing/mapping half of the Xero CSV tax import:
 * Invoice Details Report CSV -> normalized row objects, and the
 * reference -> Alga invoice id extraction.
 */
import { describe, expect, it, vi } from 'vitest';

// The service module imports createTenantKnex at module scope; stub the DB
// package so no connection configuration is required. The DB is only used by
// the matching/import methods, which are not exercised here.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    throw new Error('DB access not expected in parsing tests');
  })
}));

import {
  XeroCsvTaxImportService,
  extractInvoiceIdFromReference
} from '../xeroCsvTaxImportService';

const UUID = '0b9f8c52-1d4e-4a8e-9a51-6a4c2f9d2f10';

describe('extractInvoiceIdFromReference', () => {
  it('returns a bare UUID reference as-is', () => {
    expect(extractInvoiceIdFromReference(UUID)).toBe(UUID);
    expect(extractInvoiceIdFromReference(`  ${UUID}  `)).toBe(UUID);
  });

  it('extracts the UUID prefix from decorated references', () => {
    expect(extractInvoiceIdFromReference(`${UUID} | PO 12345`)).toBe(UUID);
  });

  it('finds an embedded UUID anywhere in the reference', () => {
    expect(extractInvoiceIdFromReference(`Invoice ${UUID} exported`)).toBe(UUID);
  });

  it('returns null when no valid UUID is present', () => {
    expect(extractInvoiceIdFromReference('INV-1001')).toBeNull();
    expect(extractInvoiceIdFromReference('')).toBeNull();
    // Right shape but invalid UUID version/variant characters are rejected
    expect(extractInvoiceIdFromReference('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBeNull();
  });
});

describe('XeroCsvTaxImportService.parseInvoiceDetailsReport', () => {
  const service = new XeroCsvTaxImportService();

  it('parses a standard Invoice Details Report into normalized rows', () => {
    const csv = [
      'Invoice Number,Invoice Date,Due Date,Status,Reference,Contact Name,Description,Quantity,Unit Amount,Line Amount,Tax Type,Tax Rate,Tax Amount',
      'INV-100,2024-03-15,2024-04-14,AUTHORISED,REF-1,Acme Corp,Managed services,2,500.00,1000.00,OUTPUT,10,100.00'
    ].join('\n');

    expect(service.parseInvoiceDetailsReport(csv)).toEqual([
      {
        invoiceNumber: 'INV-100',
        invoiceDate: '2024-03-15',
        dueDate: '2024-04-14',
        status: 'AUTHORISED',
        reference: 'REF-1',
        contactName: 'Acme Corp',
        lineDescription: 'Managed services',
        quantity: 2,
        unitAmount: 500,
        lineAmount: 1000,
        taxType: 'OUTPUT',
        taxRate: 10,
        taxAmount: 100,
        trackingCategory1Name: undefined,
        trackingCategory1Option: undefined,
        trackingCategory2Name: undefined,
        trackingCategory2Option: undefined,
        sourceSystem: undefined,
        externalInvoiceId: undefined
      }
    ]);
  });

  it('supports the *-prefixed Sales Invoices export header variants', () => {
    const csv = [
      '*InvoiceNumber,*InvoiceDate,*ContactName,*Total,*TaxAmount',
      'INV-200,2024-05-01,Beta LLC,250.00,25.00'
    ].join('\n');

    const rows = service.parseInvoiceDetailsReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNumber: 'INV-200',
      invoiceDate: '2024-05-01',
      contactName: 'Beta LLC',
      lineAmount: 250,
      taxAmount: 25
    });
  });

  it('strips currency symbols and thousands separators from numeric fields', () => {
    const csv = [
      'Invoice Number,Contact Name,Line Amount,Tax Amount',
      '"INV-300","Gamma Inc","$1,234.56","$123.45"'
    ].join('\n');

    const rows = service.parseInvoiceDetailsReport(csv);
    expect(rows[0].lineAmount).toBe(1234.56);
    expect(rows[0].taxAmount).toBe(123.45);
  });

  it('extracts the Alga invoice id from tracking category columns', () => {
    const csv = [
      'Invoice Number,Contact Name,Line Amount,Tax Amount,Tracking Name 1,Tracking Option 1,Tracking Name 2,Tracking Option 2',
      `INV-400,Delta Co,100.00,10.00,Source System,AlgaPSA,External Invoice ID,${UUID}`
    ].join('\n');

    const rows = service.parseInvoiceDetailsReport(csv);
    expect(rows[0].sourceSystem).toBeUndefined();
    expect(rows[0].trackingCategory1Name).toBe('Source System');
    expect(rows[0].trackingCategory1Option).toBe('AlgaPSA');
    expect(rows[0].externalInvoiceId).toBe(UUID);
  });

  it('prefers a direct External Invoice ID column over tracking categories', () => {
    const csv = [
      'Invoice Number,Contact Name,Line Amount,Tax Amount,External Invoice ID',
      `INV-500,Epsilon,100.00,10.00,${UUID}`
    ].join('\n');

    expect(service.parseInvoiceDetailsReport(csv)[0].externalInvoiceId).toBe(UUID);
  });

  it('skips rows missing essential data and defaults missing tax to 0', () => {
    const csv = [
      'Invoice Number,Contact Name,Line Amount,Tax Amount',
      ',No Invoice Number,100.00,10.00',
      'INV-601,,100.00,10.00',
      'INV-602,No Line Amount,,10.00',
      'INV-603,Tax Defaults,100.00,'
    ].join('\n');

    const rows = service.parseInvoiceDetailsReport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNumber: 'INV-603',
      contactName: 'Tax Defaults',
      lineAmount: 100,
      taxAmount: 0
    });
  });

  it('returns an empty array for empty or header-only content', () => {
    expect(service.parseInvoiceDetailsReport('')).toEqual([]);
    expect(
      service.parseInvoiceDetailsReport('Invoice Number,Contact Name,Line Amount,Tax Amount')
    ).toEqual([]);
  });
});
