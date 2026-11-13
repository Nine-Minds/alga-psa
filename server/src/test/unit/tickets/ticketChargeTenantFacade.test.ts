import { createRequire } from 'node:module';
import { afterAll, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { claimTicketChargeSources } from '../../../../../packages/billing/src/lib/billing/ticketChargeClaims';
import { tenantDb } from '@alga-psa/db/tenantDb';

const require = createRequire(import.meta.url);
const { tenantDb: migrationTenantDb } = require('../../../../migrations/utils/tenantDb.cjs') as {
  tenantDb: typeof tenantDb;
};
const knex = knexFactory({ client: 'pg' });
afterAll(async () => { await knex.destroy(); });

describe.each([
  ['application', tenantDb],
  ['migration shim', migrationTenantDb],
] as const)('ticket charge tenant isolation (%s)', (_name, facade) => {
  it('scopes fixed-fee roots and catalog joins without a live database', () => {
    const db = facade(knex, 'tenant-a');
    const query = db.table('ticket_fixed_fee_services as f').where('f.ticket_id', 'ticket-a');
    db.tenantJoin(query, 'service_catalog as s', 's.service_id', 'f.service_id');
    const sql = query.toString();
    expect(sql).toContain('"f"."tenant" = \'tenant-a\'');
    expect(sql).toContain('"f"."ticket_id" = \'ticket-a\'');
    expect(sql).toMatch(/"s"\."tenant" = "f"\."tenant"|"s"\."tenant" = 'tenant-a'/);
  });

});

it('uses the set-based source claim helper with an explicit tenant predicate', async () => {
  const raw = vi.fn(async (sql: string, bindings: Array<string | number | null>) => ({
    rows: [{ source_id: 'material-a' }],
    sql,
    bindings,
  }));
  const trx = { raw } as unknown as Knex.Transaction;

  const claimed = await claimTicketChargeSources(
    trx,
    'tenant-a',
    'ticket_material',
    [{ sourceId: 'material-a', sourceUpdatedAt: '2026-11-12T15:00:00.123456Z' }],
    'invoice-a',
    '2026-11-12T15:01:00Z',
  );

  expect(claimed).toEqual(new Set(['material-a']));
  const [sql, bindings] = raw.mock.calls[0];
  expect(sql).toContain('UPDATE ticket_materials AS source');
  expect(sql).toContain('FROM (VALUES (?::uuid, ?::timestamptz');
  expect(sql).toContain('source.tenant = ?');
  expect(sql).toContain('source.is_billed = FALSE');
  expect(bindings.at(-1)).toBe('tenant-a');
});
