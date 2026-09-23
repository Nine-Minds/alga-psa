import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behaviour tests for the merge engine against an in-memory stand-in for the
 * tenant database.
 *
 * The orchestration is what is worth testing here and it is not visible from
 * the pure planning module: *which* tables are written, in what order, and
 * whether the invariants hold afterwards — the source keeps exactly one default
 * profile, work items never arrive on the parent unattributed, a moved contact
 * still resolves its visibility group. A fake database makes those assertions
 * about state rather than about SQL strings, which is the only way they stay
 * true when the query shape changes.
 *
 * What this cannot cover is billing output: proving that a moved cycle
 * regenerates an identical invoice needs the billing engine and a real
 * database. That is recorded in tests.json as unimplemented.
 */

type Row = Record<string, any>;

const state: Record<string, Row[]> = {};

function table(name: string): Row[] {
  if (!state[name]) state[name] = [];
  return state[name];
}

let uuidCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++uuidCounter}`;

/** Resolves `alias.column` and bare `column` against a joined candidate row. */
function valueOf(row: Row, key: string): any {
  if (key in row) return row[key];
  const bare = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return row[bare];
}

interface Join {
  table: string;
  left: string;
  right: string;
}

class FakeBuilder {
  private predicates: Array<(row: Row) => boolean> = [];
  private joins: Join[] = [];
  private projection: string[] = [];
  private orders: Array<{ column: string; direction: string }> = [];
  private conflictColumns: string[] | null = null;
  private conflictMerge: string[] | null = null;
  private conflictIgnore = false;

  constructor(private readonly tableName: string) {}

  addJoin(join: Join) {
    this.joins.push(join);
    return this;
  }

  where(criteria: Row | string, value?: any) {
    if (typeof criteria === 'string') {
      this.predicates.push((row) => valueOf(row, criteria) === value);
    } else {
      this.predicates.push((row) =>
        Object.entries(criteria).every(([key, expected]) => valueOf(row, key) === expected));
    }
    return this;
  }

  whereIn(column: string, values: any[]) {
    this.predicates.push((row) => values.includes(valueOf(row, column)));
    return this;
  }

  whereNull(column: string) {
    this.predicates.push((row) => valueOf(row, column) === null || valueOf(row, column) === undefined);
    return this;
  }

  orderBy(column: string, direction = 'asc') {
    this.orders.push({ column, direction });
    return this;
  }

  distinct(column: string) {
    this.projection = [column];
    return this;
  }

  count(_expression: string) {
    const matched = this.resolve();
    return {
      first: async () => ({ count: String(matched.length) }),
    };
  }

  select(...columns: string[]) {
    this.projection = columns.flat();
    return this;
  }

  async first(..._columns: string[]) {
    const [row] = this.resolve();
    return row;
  }

  /** Knex builders are thenable; awaiting one runs the query it has accrued. */
  then<TResult1 = Row[], TResult2 = never>(
    onFulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.pendingInsert ? this.runInsert() : this.resolve();
    return Promise.resolve(rows).then(onFulfilled, onRejected);
  }

  async update(patch: Row): Promise<number> {
    const matched = this.resolve({ raw: true });
    for (const row of matched) Object.assign(row, patch);
    return matched.length;
  }

  async del(): Promise<number> {
    const matched = new Set(this.resolve({ raw: true }));
    const rows = table(this.tableName);
    const remaining = rows.filter((row) => !matched.has(row));
    const removed = rows.length - remaining.length;
    rows.length = 0;
    rows.push(...remaining);
    return removed;
  }

  onConflict(columns: string[]) {
    this.conflictColumns = columns;
    return this;
  }

  ignore() {
    this.conflictIgnore = true;
    return this;
  }

  merge(columns: string[]) {
    this.conflictMerge = columns;
    return this;
  }

  /**
   * Knex chains `.insert().onConflict().ignore()` on the builder and only runs
   * it when awaited, so the write is deferred to `then()` rather than executed
   * here.
   */
  insert(payload: Row | Row[], returning?: string[]) {
    this.pendingInsert = { payload, returning };
    return this;
  }

  private pendingInsert: { payload: Row | Row[]; returning?: string[] } | null = null;

  private runInsert(): Row[] {
    const { payload, returning } = this.pendingInsert!;
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted: Row[] = [];

    for (const candidate of rows) {
      const row: Row = { ...candidate };
      // The tables this engine writes all default their own key.
      if (this.tableName === 'client_billing_profiles' && !row.billing_profile_id) {
        row.billing_profile_id = nextId('profile');
      }
      if (this.tableName === 'client_merges' && !row.merge_id) {
        row.merge_id = nextId('merge');
      }
      if (this.tableName === 'client_contracts' && !row.client_contract_id) {
        row.client_contract_id = nextId('cc');
      }

      const existing = this.conflictColumns
        ? table(this.tableName).find((candidateRow) =>
          this.conflictColumns!.every((column) => candidateRow[column] === row[column]))
        : undefined;

      if (existing) {
        if (this.conflictIgnore) continue;
        if (this.conflictMerge) {
          for (const column of this.conflictMerge) existing[column] = row[column];
          inserted.push(existing);
          continue;
        }
      }

      table(this.tableName).push(row);
      inserted.push(row);
    }

    return returning
      ? inserted.map((row) => Object.fromEntries(returning.map((column) => [column, row[column]])))
      : inserted;
  }

  private resolve(options: { raw?: boolean } = {}): Row[] {
    let candidates: Row[] = table(this.tableName).map((row) => (options.raw ? row : row));

    if (this.joins.length > 0) {
      // Only ever a single join in this engine (contracts ← client_contracts),
      // so a flat merge of the matched row is enough.
      candidates = candidates.map((row) => {
        const merged: Row = { ...row };
        for (const [column, value] of Object.entries(row)) {
          merged[`${this.tableName}.${column}`] = value;
        }
        for (const join of this.joins) {
          const joinedTable = join.left.split('.')[0];
          const leftColumn = join.left.split('.')[1];
          const rightColumn = join.right.split('.')[1];
          const match = table(joinedTable).find(
            (joinedRow) => joinedRow[leftColumn] === row[rightColumn]);
          if (match) {
            for (const [column, value] of Object.entries(match)) {
              merged[`${joinedTable}.${column}`] = value;
              if (!(column in merged)) merged[column] = value;
            }
          }
        }
        return merged;
      });
    }

    let matched = candidates.filter((row) => this.predicates.every((predicate) => predicate(row)));

    for (const order of [...this.orders].reverse()) {
      matched = [...matched].sort((a, b) => {
        const left = valueOf(a, order.column);
        const right = valueOf(b, order.column);
        const comparison = left === right ? 0 : left > right ? 1 : -1;
        return order.direction === 'desc' ? -comparison : comparison;
      });
    }

    if (options.raw && this.joins.length > 0) {
      // Joined rows are projections; updates through a join are not used.
      throw new Error('Cannot mutate through a join');
    }
    return matched;
  }
}

const rawCalls: string[] = [];

const fakeTrx: any = {
  raw: vi.fn(async (sql: string, bindings?: any[]) => {
    rawCalls.push(sql);
    // The one raw statement with real semantics: re-pointing the soft parent
    // link of other clients at the merge target.
    if (sql.includes("properties->>'parent_client_id'")) {
      const [targetId, targetName, , sourceId] = bindings ?? [];
      for (const client of table('clients')) {
        if (client.properties?.parent_client_id === sourceId) {
          client.properties = {
            ...client.properties,
            parent_client_id: targetId,
            parent_client_name: targetName,
          };
        }
      }
    }
    return { rows: [] };
  }),
  fn: { now: () => 'now()' },
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => new FakeBuilder(name),
    tenantJoin: (builder: any, joinTable: string, left: string, right: string) =>
      builder.addJoin({ table: joinTable, left, right }),
  }),
}));

import { ClientMergeBlockedError, executeClientMerge } from './clientMergeEngine';

const TENANT = 'tenant-1';

function seed() {
  for (const key of Object.keys(state)) delete state[key];
  uuidCounter = 0;
  rawCalls.length = 0;

  for (const name of [
    'clients', 'tenant_companies', 'client_billing_profiles', 'contacts', 'tickets', 'projects',
    'interactions', 'assets', 'client_locations', 'client_inbound_email_domains', 'client_name_aliases',
    'usage_tracking', 'bucket_usage', 'ticket_materials', 'project_materials', 'survey_invitations',
    'survey_responses', 'invoices', 'client_billing_cycles', 'payment_methods', 'transactions',
    'credit_tracking', 'client_tax_settings', 'client_contracts', 'contracts',
    'client_portal_visibility_groups', 'billing_profile_contacts', 'client_merges', 'users',
    'client_portal_user_billing_profiles', 'document_associations', 'asset_associations',
    'tag_mappings', 'tenant_external_entity_mappings',
  ]) {
    state[name] = [];
  }

  table('clients').push(
    { tenant: TENANT, client_id: 'source', client_name: 'Acme North', is_inactive: false, merged_into_client_id: null, properties: {} },
    { tenant: TENANT, client_id: 'target', client_name: 'Acme Group', is_inactive: false, merged_into_client_id: null, properties: {} },
    { tenant: TENANT, client_id: 'sibling', client_name: 'Acme Depot', is_inactive: false, merged_into_client_id: null, properties: { parent_client_id: 'source', parent_client_name: 'Acme North' } },
  );

  table('client_billing_profiles').push(
    { tenant: TENANT, billing_profile_id: 'src-default', client_id: 'source', name: 'Default', is_default: true, is_system_managed_default: true, is_active: true },
    { tenant: TENANT, billing_profile_id: 'src-plant', client_id: 'source', name: 'North Plant', is_default: false, is_system_managed_default: false, is_active: true },
    { tenant: TENANT, billing_profile_id: 'tgt-default', client_id: 'target', name: 'Acme Group', is_default: true, is_system_managed_default: true, is_active: true },
  );

  table('contacts').push(
    { tenant: TENANT, contact_name_id: 'contact-1', client_id: 'source', full_name: 'Dana', email: 'dana@acme.test', portal_visibility_group_id: 'group-1' },
  );
  table('client_portal_visibility_groups').push(
    { tenant: TENANT, group_id: 'group-1', client_id: 'source', name: 'Site staff' },
    { tenant: TENANT, group_id: 'group-2', client_id: 'target', name: 'Site staff' },
  );

  table('tickets').push(
    { tenant: TENANT, ticket_id: 'ticket-null', client_id: 'source', billing_profile_id: null },
    { tenant: TENANT, ticket_id: 'ticket-plant', client_id: 'source', billing_profile_id: 'src-plant' },
  );
  table('invoices').push(
    { tenant: TENANT, invoice_id: 'inv-1', client_id: 'source', billing_profile_id: 'src-default' },
  );
  table('client_billing_cycles').push(
    { tenant: TENANT, billing_cycle_id: 'cycle-1', client_id: 'source', billing_profile_id: 'src-plant', is_active: true },
  );

  table('users').push(
    { tenant: TENANT, user_id: 'portal-1', user_type: 'client', contact_id: 'contact-1' },
  );
}

beforeEach(seed);

describe('executeClientMerge', () => {
  it('moves the profiles, keeps their ids, and leaves the source with one fresh default', async () => {
    const result = await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    expect(result.movedProfileIds.sort()).toEqual(['src-default', 'src-plant']);
    expect(result.movedDefaultProfileId).toBe('src-default');

    const moved = table('client_billing_profiles').filter((row) => result.movedProfileIds.includes(row.billing_profile_id));
    expect(moved.every((row) => row.client_id === 'target')).toBe(true);
    expect(moved.every((row) => row.is_default === false)).toBe(true);
    expect(moved.every((row) => row.is_system_managed_default === false)).toBe(true);
    // The source's default takes the source client's name so it stays
    // identifiable among the parent's profiles.
    expect(moved.find((row) => row.billing_profile_id === 'src-default')!.name).toBe('Acme North');

    const sourceProfiles = table('client_billing_profiles').filter((row) => row.client_id === 'source');
    expect(sourceProfiles).toHaveLength(1);
    expect(sourceProfiles[0]).toMatchObject({ is_default: true, is_system_managed_default: true, name: 'Acme North' });
  });

  it('re-stamps billing history onto the target without touching its profile', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    expect(table('invoices')[0]).toMatchObject({ client_id: 'target', billing_profile_id: 'src-default' });
    expect(table('client_billing_cycles')[0]).toMatchObject({ client_id: 'target', billing_profile_id: 'src-plant' });
  });

  it('stamps unattributed work items with the moved default instead of letting them fall to the parent', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    const tickets = table('tickets');
    expect(tickets.find((row) => row.ticket_id === 'ticket-null')).toMatchObject({
      client_id: 'target',
      billing_profile_id: 'src-default',
    });
    // A ticket that already named a profile keeps it.
    expect(tickets.find((row) => row.ticket_id === 'ticket-plant')).toMatchObject({
      client_id: 'target',
      billing_profile_id: 'src-plant',
    });
  });

  it('renames a colliding visibility group instead of dropping it', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    const moved = table('client_portal_visibility_groups').find((row) => row.group_id === 'group-1');
    // Dropping it would make getClientContactVisibilityContext throw for the
    // contact that still points at it.
    expect(moved).toMatchObject({ client_id: 'target', name: 'Site staff (Acme North)' });
    expect(table('contacts')[0]).toMatchObject({ client_id: 'target', portal_visibility_group_id: 'group-1' });
  });

  it('writes the contact-to-profile assignments the operator chose', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
      contactAssignments: [
        { contactNameId: 'contact-1', billingProfileId: 'src-plant', isManager: true, canViewProfileTickets: true },
        // A profile that did not move is ignored rather than trusted.
        { contactNameId: 'contact-1', billingProfileId: 'tgt-default', canViewProfileTickets: true },
      ],
    });

    expect(table('billing_profile_contacts')).toEqual([
      expect.objectContaining({
        billing_profile_id: 'src-plant',
        contact_name_id: 'contact-1',
        is_manager: true,
        can_view_profile_tickets: true,
      }),
    ]);
  });

  it('pins the segments an unrestricted portal user has today, and can be told not to', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    expect(table('client_portal_user_billing_profiles').map((row) => row.billing_profile_id).sort())
      .toEqual(['src-default', 'src-plant']);

    seed();
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
      pinPortalGrants: false,
    });
    expect(table('client_portal_user_billing_profiles')).toEqual([]);
  });

  it('archives the source, re-points its children and records an audit row', async () => {
    const result = await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    expect(table('clients').find((row) => row.client_id === 'source')).toMatchObject({
      is_inactive: true,
      merged_into_client_id: 'target',
    });
    expect(table('clients').find((row) => row.client_id === 'sibling')!.properties).toMatchObject({
      parent_client_id: 'target',
      parent_client_name: 'Acme Group',
    });

    const audit = table('client_merges');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      source_client_id: 'source',
      target_client_id: 'target',
      source_client_name: 'Acme North',
      merged_by: 'actor-1',
      strategy: 'merge_into_billing_profile',
    });
    expect(audit[0].moved_profile_ids.sort()).toEqual(['src-default', 'src-plant']);
    expect(result.mergeId).toBe(audit[0].merge_id);
  });

  it('takes the billing lock before it moves anything', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });
    // An invoice generation run that had already read a cycle must not have it
    // change owner underneath it.
    expect(rawCalls[0]).toContain('pg_advisory_xact_lock');
    expect(rawCalls[1]).toContain('billing_semantics_locks');
  });

  it('refuses a second merge of the same source', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    await expect(executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    })).rejects.toBeInstanceOf(ClientMergeBlockedError);
  });

  it('refuses a merge into a client recorded as the source\'s own child', async () => {
    table('clients').find((row) => row.client_id === 'target')!.properties = { parent_client_id: 'source' };

    await expect(executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    })).rejects.toThrow(/invert the hierarchy/);
  });
});

describe('executeClientMerge contract handling', () => {
  beforeEach(() => {
    table('contracts').push({ tenant: TENANT, contract_id: 'contract-1', contract_name: 'Managed Services' });
    table('client_contracts').push({
      tenant: TENANT,
      client_contract_id: 'cc-1',
      contract_id: 'contract-1',
      client_id: 'source',
      start_date: '2026-01-01',
      end_date: null,
      billing_profile_id: null,
      is_active: true,
    });
  });

  it('moves a contract with its original dates and stamps its missing profile', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
    });

    expect(table('client_contracts')).toHaveLength(1);
    expect(table('client_contracts')[0]).toMatchObject({
      client_contract_id: 'cc-1',
      client_id: 'target',
      start_date: '2026-01-01',
      billing_profile_id: 'src-default',
    });
  });

  it('terminates the source contract the day before the clone starts', async () => {
    await executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
      contractDecisions: [{ clientContractId: 'cc-1', choice: 'cutover', cutoverDate: '2026-10-01' }],
    });

    const contracts = table('client_contracts');
    expect(contracts).toHaveLength(2);

    const original = contracts.find((row) => row.client_contract_id === 'cc-1');
    expect(original).toMatchObject({ client_id: 'source', end_date: '2026-09-30', is_active: false });

    const clone = contracts.find((row) => row.client_contract_id !== 'cc-1');
    expect(clone).toMatchObject({
      client_id: 'target',
      contract_id: 'contract-1',
      start_date: '2026-10-01',
      end_date: null,
      is_active: true,
      billing_profile_id: 'src-default',
    });
  });

  it('refuses a cutover date outside the contract term rather than moving it anyway', async () => {
    await expect(executeClientMerge(fakeTrx, TENANT, 'actor-1', {
      sourceClientId: 'source',
      targetClientId: 'target',
      contractDecisions: [{ clientContractId: 'cc-1', choice: 'cutover', cutoverDate: '2025-06-01' }],
    })).rejects.toBeInstanceOf(ClientMergeBlockedError);
  });
});
