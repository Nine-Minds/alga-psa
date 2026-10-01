import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../actions/_dbTestUtils';
import Invoice from './invoice';
import QuoteDocumentTemplate from './quoteDocumentTemplate';

// Real-database coverage for the designers' "Saved <time>" / "Last Updated" status.
//
// saveTemplate upserts with ON CONFLICT ... MERGE. A merge only writes the columns
// it is given, so without an explicit updated_at the column kept its insert-time
// default forever and the status never advanced after the first save. Each save
// below is its own statement/transaction: now() is fixed for the length of a
// Postgres transaction, so two saves inside one transaction would tie.

const AST = { kind: 'template', version: 1 };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Knex;
let tenant: string;
const createdInvoiceTemplateIds: string[] = [];
const createdQuoteTemplateIds: string[] = [];

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  const seedTenant = await db('tenants').first('tenant');
  tenant = seedTenant.tenant;
});

afterAll(async () => {
  if (db) {
    await db('invoice_templates').where({ tenant }).whereIn('template_id', createdInvoiceTemplateIds).delete();
    await db('quote_document_templates').where({ tenant }).whereIn('template_id', createdQuoteTemplateIds).delete();
    await db.destroy();
  }
});

describe('saveTemplate bumps updated_at on re-save', () => {
  it('invoice templates: second save has a later updated_at and the same created_at', async () => {
    const templateId = uuidv4();
    createdInvoiceTemplateIds.push(templateId);
    const base = { template_id: templateId, name: 'Layout A', version: 1, is_default: false, templateAst: AST } as any;

    // Two separate transactions, so now() differs between the saves.
    const first = await db.transaction((trx) => Invoice.saveTemplate(trx, tenant, base));
    await pause(25);
    const second = await db.transaction((trx) =>
      Invoice.saveTemplate(trx, tenant, { ...base, name: 'Layout A (renamed)' })
    );

    expect(second.name).toBe('Layout A (renamed)');
    expect(new Date(second.created_at as any).getTime()).toBe(new Date(first.created_at as any).getTime());
    expect(new Date(second.updated_at as any).getTime()).toBeGreaterThan(new Date(first.updated_at as any).getTime());

    // The row on disk agrees with what the editor is shown.
    const row = await db('invoice_templates').where({ tenant, template_id: templateId }).first();
    expect(new Date(row.updated_at).getTime()).toBe(new Date(second.updated_at as any).getTime());
  });

  it('invoice templates: works with a plain knex handle as well as a transaction', async () => {
    const templateId = uuidv4();
    createdInvoiceTemplateIds.push(templateId);
    const base = { template_id: templateId, name: 'Layout B', version: 1, is_default: false, templateAst: AST } as any;

    const first = await Invoice.saveTemplate(db, tenant, base);
    await pause(25);
    const second = await Invoice.saveTemplate(db, tenant, { ...base, name: 'Layout B v2' });

    expect(new Date(second.updated_at as any).getTime()).toBeGreaterThan(new Date(first.updated_at as any).getTime());
    expect(new Date(second.created_at as any).getTime()).toBe(new Date(first.created_at as any).getTime());
  });

  it('quote document templates: second save has a later updated_at and the same created_at', async () => {
    const templateId = uuidv4();
    createdQuoteTemplateIds.push(templateId);
    const base = { template_id: templateId, name: 'Quote A', version: 1, is_default: false, templateAst: AST } as any;

    const first = await db.transaction((trx) => QuoteDocumentTemplate.saveTemplate(trx, tenant, base));
    await pause(25);
    const second = await db.transaction((trx) =>
      QuoteDocumentTemplate.saveTemplate(trx, tenant, { ...base, name: 'Quote A (renamed)' })
    );

    expect(second.name).toBe('Quote A (renamed)');
    expect(new Date(second.created_at as any).getTime()).toBe(new Date(first.created_at as any).getTime());
    expect(new Date(second.updated_at as any).getTime()).toBeGreaterThan(new Date(first.updated_at as any).getTime());
  });
});
