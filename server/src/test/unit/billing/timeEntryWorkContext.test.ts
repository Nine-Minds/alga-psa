import knexFactory from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTRIBUTED_WORK_ALIAS, activeTimeEntryWorkContributors, joinContributedTimeEntryWork,
  registerTimeEntryWorkContributor, resetTimeEntryWorkContributorsForTests,
} from '../../../../../packages/billing/src/lib/billing/timeEntryWorkContext';

// Billing work-context seam (stands in for L6a1/T0-2). The neutrality contract: with no serving contributor
// the time-entry query is untouched and names no contributor table.
const knex = knexFactory({ client: 'pg' });
const contributor = (served: boolean) => ({
  kind: 'fake', workItemTypes: ['fake'] as const, serves: async () => served,
  fragment: (tenant: string) => ({ sql: 'SELECT ?::uuid AS tenant, e.entry_id FROM co_managed_time_work_references e', bindings: [tenant] }),
});
const base = () => knex('time_entries').select('time_entries.entry_id');

afterEach(() => resetTimeEntryWorkContributorsForTests());

describe('timeEntryWorkContext seam', () => {
  it('returns no contributors and leaves the query byte-identical when nothing is registered', async () => {
    const before = base().toSQL().sql;
    const q = base();
    const active = await activeTimeEntryWorkContributors('t1');
    expect(active).toEqual([]);
    expect(joinContributedTimeEntryWork(knex, 't1', q, active)).toBe(false);
    expect(q.toSQL().sql).toBe(before);
    expect(q.toSQL().sql).not.toContain('co_managed');
  });

  it('treats a registered contributor that does not serve the tenant as absent', async () => {
    registerTimeEntryWorkContributor(contributor(false));
    const q = base();
    const active = await activeTimeEntryWorkContributors('t1');
    expect(active).toEqual([]);
    joinContributedTimeEntryWork(knex, 't1', q, active);
    expect(q.toSQL().sql).not.toContain('co_managed');
  });

  it('adds one tenant+entry keyed LEFT JOIN when a contributor serves the tenant', async () => {
    registerTimeEntryWorkContributor(contributor(true));
    const q = base();
    const active = await activeTimeEntryWorkContributors('t1');
    expect(joinContributedTimeEntryWork(knex, 't1', q, active)).toBe(true);
    const { sql, bindings } = q.toSQL();
    expect(sql).toContain('left join (SELECT');
    expect(sql).toContain(`AS ${CONTRIBUTED_WORK_ALIAS}`);
    expect(sql).toContain(`"${CONTRIBUTED_WORK_ALIAS}"."tenant" = "time_entries"."tenant"`);
    expect(sql).toContain(`"${CONTRIBUTED_WORK_ALIAS}"."entry_id" = "time_entries"."entry_id"`);
    expect(bindings).toEqual(['t1']);
  });

  it('refuses a second contributor of the same kind', () => {
    registerTimeEntryWorkContributor(contributor(true));
    expect(() => registerTimeEntryWorkContributor(contributor(true))).toThrow(/already registered/);
  });
});
