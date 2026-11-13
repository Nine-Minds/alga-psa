import { describe, expect, it } from 'vitest';
import { TENANT_TABLE_FOREIGN_KEYS, type TenantTableForeignKey } from './tenantTableForeignKeys';
import {
  TENANT_TABLE_MANIFEST,
  clientOwnershipViolations,
  tenantClientColumns,
  tenantClientKeyedTables,
  tenantClientOwnership,
  type ClientOwnership,
  type TenantTableEntry,
} from './tenantTableManifest';

const table = (name: string, clientKeyed?: ClientOwnership): TenantTableEntry => ({ table: name, deletion: 'ordered', clientKeyed });
const fk = (child: string, column: string, parent: string): TenantTableForeignKey =>
  ({ child, parent, column, deleteRule: 'NO ACTION', name: `${child}_${column}_fk` });

const CLIENTS = table('clients', { by: 'column', column: 'client_id' });
const TICKETS = table('tickets', { by: 'column', column: 'client_id' });
const TICKETS_FK = fk('tickets', 'client_id', 'clients');

describe('client ownership contract (T003)', () => {
  it('every table with a foreign key to clients has an ownership declaration or a stated exemption', () => {
    expect(clientOwnershipViolations(TENANT_TABLE_MANIFEST, TENANT_TABLE_FOREIGN_KEYS)).toEqual([]);
  });

  it('fails for a fixture table whose foreign key to clients has no declaration', () => {
    const manifest = [CLIENTS, TICKETS, table('widget_orders')];
    const foreignKeys = [TICKETS_FK, fk('widget_orders', 'billed_client_id', 'clients'), fk('widget_orders', 'billed_client_id', 'clients')];
    expect(clientOwnershipViolations(manifest, foreignKeys)).toEqual([
      'widget_orders.billed_client_id: foreign key to clients with no ownership declaration or exemption',
    ]);
  });

  it('fails when the real manifest loses a declaration', () => {
    const manifest = TENANT_TABLE_MANIFEST.map(entry => (entry.table === 'purchase_orders' ? { ...entry, clientKeyed: undefined } : entry));
    expect(clientOwnershipViolations(manifest, TENANT_TABLE_FOREIGN_KEYS)).toEqual([
      'purchase_orders.drop_ship_client_id: foreign key to clients with no ownership declaration or exemption',
    ]);
  });

  it('accepts a stated exemption and rejects one without a reason', () => {
    const foreignKeys = [fk('widget_orders', 'billed_client_id', 'clients')];
    expect(clientOwnershipViolations([CLIENTS, table('widget_orders', { by: 'exempt', reason: 'Names the reseller, not the owner.' })], foreignKeys)).toEqual([]);
    expect(clientOwnershipViolations([CLIENTS, table('widget_orders', { by: 'exempt', reason: ' ' })], foreignKeys)).toHaveLength(1);
  });

  it('requires the declaration to account for the column the foreign key is on', () => {
    const manifest = [CLIENTS, table('widget_orders', { by: 'column', column: 'client_id' })];
    const foreignKeys = [fk('widget_orders', 'client_id', 'clients'), fk('widget_orders', 'billed_client_id', 'clients')];
    expect(clientOwnershipViolations(manifest, foreignKeys)).toEqual([
      "widget_orders.billed_client_id: foreign key to clients is not covered by the table's column declaration",
    ]);
    const both: ClientOwnership = {
      by: 'alternatives',
      parents: [[{ column: 'client_id', table: 'clients' }], [{ column: 'billed_client_id', table: 'clients', parentColumn: 'client_id' }]],
    };
    expect(clientOwnershipViolations([CLIENTS, table('widget_orders', both)], foreignKeys)).toEqual([]);
  });
});

describe('client ownership declarations are structurally sound', () => {
  it('a column or hop is backed by a foreign key or says enforced: false, never both', () => {
    const unbacked = [CLIENTS, table('widget_orders', { by: 'column', column: 'client_id' })];
    expect(clientOwnershipViolations(unbacked, [])).toHaveLength(1);
    const stated = [CLIENTS, table('widget_orders', { by: 'column', column: 'client_id', enforced: false })];
    expect(clientOwnershipViolations(stated, [])).toEqual([]);
    expect(clientOwnershipViolations(stated, [fk('widget_orders', 'client_id', 'clients')])).toHaveLength(1);

    const hop = (enforced?: false): TenantTableEntry[] =>
      [CLIENTS, TICKETS, table('ticket_notes', { by: 'parent', chain: [{ column: 'ticket_id', table: 'tickets', enforced }] })];
    expect(clientOwnershipViolations(hop(), [TICKETS_FK])).toHaveLength(1);
    expect(clientOwnershipViolations(hop(false), [TICKETS_FK])).toEqual([]);
    expect(clientOwnershipViolations(hop(), [TICKETS_FK, fk('ticket_notes', 'ticket_id,assigned_to', 'tickets')])).toEqual([]);
  });

  it('a chain has one to three hops, stays in the manifest, never loops and ends on a client column', () => {
    const chainOf = (...tables: string[]): ClientOwnership =>
      ({ by: 'parent', chain: tables.map(name => ({ column: `${name}_id`, table: name, enforced: false as const })) });
    const middle = ['a', 'b', 'c'].map(name => table(name));
    const run = (ownership: ClientOwnership) => clientOwnershipViolations([CLIENTS, TICKETS, ...middle, table('leaf', ownership)], [TICKETS_FK]);

    expect(run(chainOf('a', 'b', 'tickets'))).toEqual([]);
    expect(run(chainOf('a', 'clients'))).toEqual([]);
    expect(run({ by: 'parent', chain: [] })).toEqual(['leaf.clientKeyed: a chain has 1 to 3 hops, found 0']);
    expect(run(chainOf('a', 'b', 'c', 'tickets'))).toEqual(['leaf.clientKeyed: a chain has 1 to 3 hops, found 4']);
    expect(run(chainOf('a', 'b'))).toEqual(['leaf.clientKeyed: the chain ends on b, which is not clients and declares no client column']);
    expect(run(chainOf('a', 'leaf', 'tickets'))).toEqual(['leaf.clientKeyed: leaf appears twice in the chain']);
    expect(run(chainOf('missing', 'tickets'))).toEqual(['leaf.clientKeyed: missing is not a manifest table']);
  });

  it('alternatives need two parents and check each one; a resolver names all three parts', () => {
    const one: ClientOwnership = { by: 'alternatives', parents: [[{ column: 'ticket_id', table: 'tickets', enforced: false }]] };
    expect(clientOwnershipViolations([CLIENTS, TICKETS, table('leaf', one)], [TICKETS_FK])).toHaveLength(1);
    const second: ClientOwnership = {
      by: 'alternatives',
      parents: [[{ column: 'ticket_id', table: 'tickets', enforced: false }], [{ column: 'gone_id', table: 'gone', enforced: false }]],
    };
    expect(clientOwnershipViolations([CLIENTS, TICKETS, table('leaf', second)], [TICKETS_FK])).toEqual([
      'leaf.clientKeyed[1]: gone is not a manifest table',
      'leaf.clientKeyed[1]: the chain ends on gone, which is not clients and declares no client column',
    ]);
    const resolver: ClientOwnership = { by: 'resolver', resolver: '', discriminator: 'kind', id: 'kind_id' };
    expect(clientOwnershipViolations([CLIENTS, table('leaf', resolver)], [])).toHaveLength(1);
  });
});

describe('client ownership in the manifest', () => {
  it('requires the ticket template client foreign key while preserving client merge discovery', () => {
    expect(tenantClientColumns()).toContainEqual({ table: 'ticket_templates', column: 'client_id', owned: true });
    expect(tenantClientKeyedTables()).toContain('ticket_templates');
    expect(clientOwnershipViolations(TENANT_TABLE_MANIFEST, TENANT_TABLE_FOREIGN_KEYS)).toEqual([]);

    const withoutTemplateClientKey = TENANT_TABLE_FOREIGN_KEYS.filter(
      key => !(key.child === 'ticket_templates' && key.parent === 'clients'),
    );
    expect(clientOwnershipViolations(TENANT_TABLE_MANIFEST, withoutTemplateClientKey)).toEqual([
      'ticket_templates.clientKeyed: no foreign key ticket_templates.client_id -> clients; fix the declaration or mark it enforced: false',
    ]);
  });

  it('discovers seat arrangements as client-owned without requiring a database foreign key', () => {
    expect(tenantClientOwnership('co_managed_seat_arrangements')).toEqual({
      by: 'column', column: 'client_id', enforced: false,
    });
    expect(tenantClientColumns()).toContainEqual({
      table: 'co_managed_seat_arrangements', column: 'client_id', owned: true,
    });
    expect(tenantClientKeyedTables()).toContain('co_managed_seat_arrangements');
    expect(clientOwnershipViolations(TENANT_TABLE_MANIFEST, TENANT_TABLE_FOREIGN_KEYS)).toEqual([]);
  });

  it('includes user portfolios in client ownership and client merge discovery', () => {
    expect(tenantClientOwnership('user_client_portfolios')).toEqual({ by: 'column', column: 'client_id' });
    expect(tenantClientColumns()).toContainEqual({ table: 'user_client_portfolios', column: 'client_id', owned: true });
    expect(tenantClientKeyedTables()).toContain('user_client_portfolios');
  });

  it('names the client columns that are not client_id', () => {
    expect(tenantClientOwnership('contracts')).toEqual({ by: 'column', column: 'owner_client_id' });
    expect(tenantClientOwnership('purchase_orders')).toEqual({ by: 'column', column: 'drop_ship_client_id' });
    const keyed = tenantClientKeyedTables();
    expect(keyed).not.toContain('contracts');
    expect(keyed).not.toContain('purchase_orders');
    expect(keyed).toContain('tickets');
  });

  it('declares the polymorphic tables by resolver', () => {
    for (const name of ['time_entries', 'schedule_entries', 'document_associations', 'tag_mappings']) {
      expect(tenantClientOwnership(name)?.by, name).toBe('resolver');
    }
  });

  it('lists exemptions among the client columns without calling them owned', () => {
    const columns = tenantClientColumns();
    expect(columns.find(entry => entry.table === 'mcp_oauth_grants')).toEqual({ table: 'mcp_oauth_grants', column: 'client_id', owned: false });
    expect(columns.find(entry => entry.table === 'tickets')).toEqual({ table: 'tickets', column: 'client_id', owned: true });
  });
});
