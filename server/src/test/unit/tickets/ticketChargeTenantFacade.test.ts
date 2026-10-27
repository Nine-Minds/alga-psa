import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
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
