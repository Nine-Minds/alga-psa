import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { availableCreditByClientQuery } from './creditBalance';

describe('availableCreditByClientQuery', () => {
  it('selects and groups by tenant so callers can join on (tenant, client_id)', () => {
    const knex = knexFactory({ client: 'pg' });
    const sql = availableCreditByClientQuery(knex, 'tenant-1').toSQL().sql;
    expect(sql).toContain('"credit_tracking"."tenant"');
    expect(sql).toContain('"credit_tracking"."client_id"');
    expect(sql).toContain('group by "credit_tracking"."tenant", "credit_tracking"."client_id"');
  });
});
