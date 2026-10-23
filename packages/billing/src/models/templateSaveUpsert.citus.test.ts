import { afterAll, describe, expect, it } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import Invoice from './invoice';
import QuoteDocumentTemplate from './quoteDocumentTemplate';

// invoice_templates and quote_document_templates are distributed on Citus, which
// rejects any non-IMMUTABLE function (now(), CURRENT_TIMESTAMP) in the DO UPDATE
// SET list of an upsert: every re-save of a layout failed there with "functions
// used in the DO UPDATE SET clause of INSERTs on distributed tables must be marked
// IMMUTABLE" while plain Postgres accepted it. The saves run against a pg client
// whose driver only records the statement, so the SQL each model sends is checked
// without a database.

type Captured = { sql: string; bindings: readonly unknown[] };

function recordingKnex(captured: Captured[]): Knex {
  const db = knexFactory({ client: 'pg' });
  const client = db.client as any;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => undefined;
  client._query = async (_connection: unknown, query: { sql: string; bindings: unknown[] }) => {
    captured.push({ sql: query.sql, bindings: query.bindings });
    return { ...query, response: { rows: [{}], command: 'INSERT' } };
  };
  return db;
}

const NON_IMMUTABLE = /\b(now\s*\(|current_timestamp|current_date|localtimestamp|clock_timestamp|statement_timestamp|transaction_timestamp)/i;

function doUpdateSetClause(sql: string): string {
  const match = /on conflict[\s\S]*?do update set([\s\S]*?)(?:\bwhere\b|\breturning\b|$)/i.exec(sql);
  expect(match, `expected an ON CONFLICT ... DO UPDATE SET upsert, got: ${sql}`).not.toBeNull();
  return match![1];
}

const dbs: Knex[] = [];

afterAll(async () => {
  await Promise.all(dbs.map((db) => db.destroy()));
});

describe('template saves are valid upserts on Citus distributed tables', () => {
  const template = {
    template_id: '00000000-0000-4000-8000-000000000001',
    name: 'Layout',
    version: 1,
    is_default: false,
    templateAst: { kind: 'template', version: 1 },
  } as any;

  it.each([
    ['invoice templates', (db: Knex) => Invoice.saveTemplate(db, 'tenant-1', template)],
    ['quote document templates', (db: Knex) => QuoteDocumentTemplate.saveTemplate(db, 'tenant-1', template)],
  ])('%s bump updated_at with a bound timestamp, not a database function', async (_label, save) => {
    const captured: Captured[] = [];
    const db = recordingKnex(captured);
    dbs.push(db);

    const before = Date.now();
    await save(db);

    expect(captured).toHaveLength(1);
    const { sql, bindings } = captured[0];
    const setClause = doUpdateSetClause(sql);

    expect(setClause).toMatch(/"updated_at"\s*=\s*\$\d+/);
    expect(setClause).not.toMatch(NON_IMMUTABLE);

    const updatedAtParam = Number(/"updated_at"\s*=\s*\$(\d+)/.exec(setClause)![1]);
    const updatedAt = bindings[updatedAtParam - 1];
    expect(updatedAt).toBeInstanceOf(Date);
    expect((updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});
