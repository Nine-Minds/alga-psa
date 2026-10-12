import { describe, expect, it } from 'vitest';
import knex from 'knex';

import { whereLiveClientCadenceRecurringLine } from '../liveClientCadenceRecurringLine';

const db = knex({ client: 'pg' });

function compile() {
  const query = db('client_contracts as cc')
    .join('contracts as ct', 'ct.contract_id', 'cc.contract_id')
    .join('contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
  return whereLiveClientCadenceRecurringLine(query).toSQL().toNative();
}

describe('whereLiveClientCadenceRecurringLine', () => {
  it('excludes an inactive assignment, an inactive contract header and an inactive line', () => {
    const { sql, bindings } = compile();

    expect(sql).toContain('"cc"."is_active" = $1');
    expect(sql).toContain('"ct"."is_active" = $2');
    expect(sql).toContain('"cl"."is_active" = $3');
    expect(bindings.slice(0, 3)).toEqual([true, true, true]);
  });

  it('keeps only client-cadence lines of non-system-default contracts that have timing', () => {
    const { sql, bindings } = compile();

    expect(sql).toContain('"ct"."is_system_managed_default" is null or "ct"."is_system_managed_default" = $4');
    expect(sql).toContain('"cl"."cadence_owner" = $5');
    expect(sql).toContain('"cl"."billing_timing" is not null');
    expect(bindings.slice(3)).toEqual([false, 'client']);
  });
});
