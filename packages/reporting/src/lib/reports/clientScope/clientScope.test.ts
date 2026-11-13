import { describe, expect, it } from 'vitest';
import knex from 'knex';
import {
  classifyTableOwnership,
  createClientOwnershipAdapter,
  describeClientScopeRefusal,
  planQueryNarrowing,
  CLIENT_SCOPE_REFUSAL_MESSAGES,
  type ClientScopeRefusalCode,
} from './index';

const pg = knex({ client: 'pg' });
const sqlOf = (apply: (builder: any) => void, from = 'x') => {
  const builder = pg.queryBuilder().from(from);
  apply(builder);
  return builder.toSQL().toNative();
};

describe('classifyTableOwnership', () => {
  it('reads the S3 ownership declaration', () => {
    expect(classifyTableOwnership('tickets')).toBe('owned');
    expect(classifyTableOwnership('project_tasks')).toBe('owned');
    expect(classifyTableOwnership('time_entries')).toBe('owned');
    expect(classifyTableOwnership('microsoft_profiles')).toBe('exempt');
    expect(classifyTableOwnership('contract_lines')).toBe('undeclared');
    expect(classifyTableOwnership('no_such_table')).toBe('undeclared');
  });
});

describe('createClientOwnershipAdapter: ownership to predicate', () => {
  it('column: names the declared client column under the query alias', () => {
    expect(createClientOwnershipAdapter('tickets', 't', 'u1').clientColumn).toBe('t.client_id');
    expect(createClientOwnershipAdapter('contracts', 'c', 'u1').clientColumn).toBe('c.owner_client_id');
  });

  it('parent chain: a tenant-joined EXISTS along the chain ending on the owned client column', () => {
    const adapter = createClientOwnershipAdapter('project_tasks', 't', 'u1');
    const { sql, bindings } = sqlOf((b) => adapter.applyClients!(b, ['c1', 'c2']));
    expect(adapter.clientColumn).toBeUndefined();
    expect(sql).toMatch(/exists \(select 1 from "project_phases" as "cs\d+_0"/);
    expect(sql).toMatch(/inner join "projects" as "cs\d+_1" on "cs\d+_1"."tenant" = "cs\d+_0"."tenant"/);
    expect(sql).toMatch(/"cs\d+_0"."tenant" = "t"."tenant"/);
    expect(sql).toMatch(/"cs\d+_1"."client_id" in \(\$1, \$2\)/);
    expect(bindings).toEqual(['c1', 'c2']);
  });

  it('parent chain: a hop that lands on clients needs no join of clients', () => {
    const adapter = createClientOwnershipAdapter('invoice_charges', 'ic', 'u1');
    const { sql } = sqlOf((b) => adapter.applyClients!(b, ['c1']));
    expect(sql).toMatch(/from "invoices" as "cs\d+_0"/);
    expect(sql).not.toContain('"clients"');
  });

  it('alternatives: every parent the row has must be in scope, and at least one must be present', () => {
    const adapter = createClientOwnershipAdapter('comment_threads', 'ct', 'u1');
    const { sql } = sqlOf((b) => adapter.applyClients!(b, ['c1']));
    expect(sql).toContain('"ct"."ticket_id" is not null or "ct"."project_task_id" is not null');
    expect(sql).toContain('"ct"."ticket_id" is null or');
    expect(sql).toContain('"ct"."project_task_id" is null or');
  });

  it('resolver: time entries follow the work item; client-less work stays with its own user only', () => {
    const own = sqlOf((b) => createClientOwnershipAdapter('time_entries', 'te', 'user-1').applyClients!(b, ['c1'])).sql;
    expect(own).toContain('"te"."work_item_type"');
    expect(own).toContain('"te"."user_id" = $');
    const noUser = sqlOf((b) => createClientOwnershipAdapter('time_entries', 'te', null).applyClients!(b, ['c1'])).sql;
    expect(noUser).toContain('1 = 0');
    expect(noUser).not.toContain('"te"."user_id"');
  });

  it('an empty client set matches nothing', () => {
    expect(sqlOf((b) => createClientOwnershipAdapter('project_tasks', 't', 'u').applyClients!(b, [])).sql).toContain('1 = 0');
    expect(sqlOf((b) => createClientOwnershipAdapter('comment_threads', 't', 'u').applyClients!(b, [])).sql).toContain('1 = 0');
  });

  it('refuses to build a mapping for a table that is not client-owned', () => {
    expect(() => createClientOwnershipAdapter('contract_lines', 'cl', 'u')).toThrow(/not client-owned/);
    expect(() => createClientOwnershipAdapter('microsoft_profiles', 'mp', 'u')).toThrow(/not client-owned/);
  });
});

describe('planQueryNarrowing', () => {
  const plan = (def: any) => planQueryNarrowing(def);

  it('anchors the primary table and every inner join that is client-owned', () => {
    const result = plan({
      table: 'tickets as t',
      joins: [
        { type: 'inner', table: 'clients as c', on: [{ left: 't.client_id', right: 'c.client_id' }] },
        { type: 'left', table: 'contacts', on: [{ left: 't.contact_name_id', right: 'contacts.contact_name_id' }] },
        { type: 'inner', table: 'statuses as s', on: [{ left: 't.status_id', right: 's.status_id' }] },
      ],
    });
    expect(result).toEqual({ ok: true, value: { anchors: [{ table: 'tickets', alias: 't' }, { table: 'clients', alias: 'c' }] } });
  });

  it('accepts an undeclared table that an anchor restricts', () => {
    const result = plan({
      table: 'client_contracts',
      joins: [{ type: 'inner', table: 'contract_lines', on: [{ left: 'a', right: 'b' }] }],
    });
    expect(result).toMatchObject({ ok: true, value: { anchors: [{ table: 'client_contracts', alias: 'client_contracts' }] } });
  });

  it('refuses raw SQL', () => {
    expect(plan({ table: 'raw_sql', fields: ['select 1'] })).toMatchObject({ ok: false, refusal: { code: 'raw_sql' } });
  });

  it('refuses an undeclared table nothing else restricts, naming it', () => {
    expect(plan({ table: 'contract_lines', aggregation: 'count' })).toMatchObject({
      ok: false,
      refusal: { code: 'undeclared_table', table: 'contract_lines' },
    });
  });

  it('refuses when the only client-owned table is left-joined (it decorates, it does not restrict)', () => {
    expect(
      plan({ table: 'service_catalog', joins: [{ type: 'left', table: 'tickets', on: [{ left: 'a', right: 'b' }] }] })
    ).toMatchObject({ ok: false, refusal: { code: 'undeclared_table', table: 'service_catalog' } });
  });

  it('refuses right and full joins', () => {
    for (const type of ['right', 'full']) {
      expect(plan({ table: 'tickets', joins: [{ type, table: 'clients', on: [{ left: 'a', right: 'b' }] }] })).toMatchObject({
        ok: false,
        refusal: { code: 'unsupported_join', table: 'clients' },
      });
    }
  });

  it('refuses a query whose tables are all exempt', () => {
    expect(plan({ table: 'microsoft_profiles' })).toMatchObject({ ok: false, refusal: { code: 'no_client_anchor' } });
  });
});

describe('describeClientScopeRefusal', () => {
  it('has an English message and an i18n key for every code', () => {
    for (const code of Object.keys(CLIENT_SCOPE_REFUSAL_MESSAGES) as ClientScopeRefusalCode[]) {
      const described = describeClientScopeRefusal({ code, table: 'some_table', reason: 'because' });
      expect(described.key).toBe(`msp/reports:errors.report.clientScopeRefused.${code}`);
      expect(described.message).not.toContain('{{');
      expect(described.params).toEqual({ table: 'some_table' });
    }
  });
});
