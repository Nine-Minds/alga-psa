import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';

import { AccountingExportRepository } from '../../src/repositories/accountingExportRepository';

const TENANT = '22222222-2222-4222-8222-222222222222';
const BATCH = '11111111-1111-4111-8111-111111111111';
const LINE = '33333333-3333-4333-8333-333333333333';

/** Real knex query building against a recorded, in-memory response (no connection). */
function makeRepository(existingRow: Record<string, unknown> | undefined) {
  const knex = knexFactory({ client: 'pg' });
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const client = knex.client as any;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => undefined;
  client.query = async (_conn: unknown, obj: any) => {
    queries.push({ sql: obj.sql, bindings: obj.bindings });
    const isSelect = obj.sql.trimStart().startsWith('select');
    obj.response = isSelect ? (existingRow ? [existingRow] : []) : [{ error_id: 'new' }];
    return obj;
  };
  client.processResponse = (obj: any) => (obj.method === 'first' ? obj.response[0] : obj.response);
  return { repository: new AccountingExportRepository(knex, TENANT), queries };
}

describe('AccountingExportRepository.addError idempotency', () => {
  it('returns the existing open row instead of inserting', async () => {
    const existing = { error_id: 'existing', batch_id: BATCH, line_id: LINE, code: 'missing_item_mapping' };
    const { repository, queries } = makeRepository(existing);
    const result = await repository.addError({ batch_id: BATCH, line_id: LINE, code: 'missing_item_mapping', message: 'm' });
    expect(result).toMatchObject({ error_id: 'existing' });
    expect(queries.some((q) => q.sql.startsWith('insert'))).toBe(false);
    expect(queries[0].sql).toContain('"resolution_state"');
    expect(queries[0].bindings).toEqual(expect.arrayContaining([TENANT, BATCH, LINE, 'missing_item_mapping', 'open']));
  });

  it('inserts when no open row matches', async () => {
    const { repository, queries } = makeRepository(undefined);
    await repository.addError({ batch_id: BATCH, line_id: LINE, code: 'c', message: 'm' });
    expect(queries.some((q) => q.sql.startsWith('insert'))).toBe(true);
  });

  it('matches a null line_id with IS NULL, not = null', async () => {
    const { repository, queries } = makeRepository(undefined);
    await repository.addError({ batch_id: BATCH, line_id: null, code: 'c', message: 'm' });
    expect(queries[0].sql).toContain('"line_id" is null');
    expect(queries[0].sql).not.toContain('"line_id" =');
  });
});
