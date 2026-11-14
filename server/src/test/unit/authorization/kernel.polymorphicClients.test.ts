import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import {
  clientResolvers,
  compileRelationshipTemplateSql,
  createClientResolverRegistry,
  polymorphicClientsHook,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';

// T004 (offline). The applyClients hook is optional: an adapter without it, or
// with an empty client set, must deny exactly as adapters did before the hook.

const db = knexFactory({ client: 'pg' });
afterAll(async () => {
  await db.destroy();
});

const subject: AuthorizationSubject = {
  tenant: 'tenant-1',
  userId: 'user-1',
  userType: 'internal',
  teamIds: [],
  managedUserIds: [],
  portfolioClientIds: ['client-1', 'client-2'],
  clientId: 'client-1',
};

const noHook: RelationshipSqlAdapter = { applyAssignedUsers: (b) => void b.whereRaw('1 = 0') };
const withHook: RelationshipSqlAdapter = { ...noHook, applyClients: polymorphicClientsHook('time_entries', 'te') };

const sqlFor = (template: 'same_client' | 'client_portfolio' | 'selected_clients', adapter: RelationshipSqlAdapter, ctx: Partial<Parameters<typeof compileRelationshipTemplateSql>[2]> = {}) => {
  const builder = db('time_entries as te');
  compileRelationshipTemplateSql(builder, template, { subject, adapter, selectedClientIds: ['client-1'], ...ctx });
  return builder.toSQL().toNative();
};

describe('client templates on adapters without applyClients', () => {
  it.each(['same_client', 'client_portfolio', 'selected_clients'] as const)('%s denies when there is neither a client column nor the hook', (template) => {
    expect(sqlFor(template, noHook).sql).toMatch(/where 1 = 0$/);
  });

  it('an adapter with a client column behaves as before and never touches the hook', () => {
    let called = false;
    const adapter: RelationshipSqlAdapter = { ...noHook, clientColumn: 't.client_id', applyClients: () => { called = true; } };
    const native = sqlFor('client_portfolio', adapter);
    expect(native.sql).toMatch(/"t"\."client_id" in \(\$1, \$2\)/);
    expect(called).toBe(false);
  });
});

describe('client templates on adapters with applyClients', () => {
  it.each(['client_portfolio', 'selected_clients', 'same_client'] as const)('%s compiles to a per-discriminator EXISTS scoped by tenant', (template) => {
    const { sql } = sqlFor(template, withHook);
    expect(sql).not.toContain('1 = 0');
    expect(sql).toContain('exists (select "p0"."tenant" from "tickets" as "p0"');
    expect(sql).toContain('"p0"."tenant" = "te"."tenant"');
    expect(sql).toContain('"p0"."ticket_id" = "te"."work_item_id"');
    // Every hop of the two-hop project_task path joins on tenant.
    expect(sql).toMatch(/inner join "project_phases" as "p1" on "p1"."tenant" = "p0"."tenant" and "p1"."phase_id" = "p0"."phase_id"/);
    expect(sql).toMatch(/inner join "projects" as "p2" on "p2"."tenant" = "p1"."tenant" and "p2"."project_id" = "p1"."project_id"/);
  });

  it('denies an empty client set without calling the hook', () => {
    expect(sqlFor('client_portfolio', withHook, { subject: { ...subject, portfolioClientIds: [] } }).sql).toMatch(/where 1 = 0$/);
    expect(sqlFor('selected_clients', withHook, { selectedClientIds: [] }).sql).toMatch(/where 1 = 0$/);
    expect(sqlFor('same_client', withHook, { subject: { ...subject, clientId: null } }).sql).toMatch(/where 1 = 0$/);
  });
});

describe('client resolver registry', () => {
  it('an unknown resolver or discriminator has no client and an unknown resolver matches nothing in SQL', async () => {
    expect(clientResolvers.has('work_item', 'ticket')).toBe(true);
    expect(clientResolvers.has('work_item', 'ad_hoc')).toBe(false);
    expect(await clientResolvers.resolveClient(db, 't', 'no_such', 'ticket', 'x')).toBeNull();
    const builder = db('time_entries as te');
    createClientResolverRegistry().applyClients(builder, 'work_item', { tenantRef: 'te.tenant', discriminatorRef: 'te.work_item_type', idRef: 'te.work_item_id' }, ['c1']);
    expect(builder.toSQL().sql).toMatch(/where 1 = 0$/);
  });

  it('refuses to overwrite a registered discriminator', () => {
    const registry = createClientResolverRegistry();
    const entry = clientResolvers as never;
    registry.register('r', { k: entry });
    expect(() => registry.register('r', { k: entry })).toThrow(/already has an entry/);
  });

  it('polymorphicClientsHook rejects a table that is not resolver-owned', () => {
    expect(() => polymorphicClientsHook('tickets', 't')).toThrow(/not declared as client-owned by a resolver/);
    expect(() => polymorphicClientsHook('no_such_table', 't')).toThrow();
  });

  it('every built-in resolver name matches the manifest declaration of its polymorphic tables', async () => {
    const { tenantClientOwnership } = await import('@alga-psa/db');
    const expected: Record<string, string> = { time_entries: 'work_item', schedule_entries: 'work_item', tag_mappings: 'tagged_entity', document_associations: 'document_entity' };
    for (const [table, resolver] of Object.entries(expected)) {
      const ownership = tenantClientOwnership(table);
      expect(ownership).toMatchObject({ by: 'resolver', resolver });
      expect(clientResolvers.has(resolver, 'ticket')).toBe(true);
    }
  });
});
