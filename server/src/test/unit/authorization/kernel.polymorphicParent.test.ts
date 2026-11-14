import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import {
  RequestLocalAuthorizationCache,
  compileRelationshipTemplateSql,
  createClientResolverRegistry,
  parentVisibleViaChildClients,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { BUNDLE_RULE_RESOURCE_TYPE_CATALOG } from '@alga-psa/authorization/bundles/catalog';
import { applyReadScope, resolveNarrowedReadScope } from '@alga-psa/authorization/readScope';
import { createDocumentRelationshipSqlAdapter } from '@shared/lib/documentAuthorization';

// S12 (F019, F020), offline. A parent row (a document, a tag definition) is visible when some child
// polymorphic row (document_associations, tag_mappings) resolves to an in-scope client.

const db = knexFactory({ client: 'pg' });
afterAll(async () => {
  await db.destroy();
});

const subject: AuthorizationSubject = {
  tenant: 'tenant-1',
  userId: 'user-1',
  userType: 'internal',
  teamIds: ['team-1'],
  managedUserIds: [],
  portfolioClientIds: ['client-a', 'client-b'],
};

const deny = (b: any) => void b.whereRaw('1 = 0');
const documentParent = { table: 'document_associations', parentKeyColumn: 'document_id' };
const documentRefs = { tenantRef: 'd.tenant', keyRef: 'd.document_id' };

describe('parentVisibleViaChildClients', () => {
  it('lifts the child hook into a tenant-correlated EXISTS over the children', () => {
    const hook = parentVisibleViaChildClients(documentParent, documentRefs);
    const { sql, bindings } = db('documents as d').modify((q) => hook(q, ['client-a', 'client-b'])).toSQL().toNative();
    expect(sql).toContain('exists (select 1 from "document_associations" as "document_associations_scope"');
    expect(sql).toContain('"document_associations_scope"."tenant" = "d"."tenant"');
    expect(sql).toContain('"document_associations_scope"."document_id" = "d"."document_id"');
    // The document_entity resolver decides per association kind, with a tenant join on the parent record.
    expect(sql).toContain('"document_associations_scope"."entity_type" = $');
    expect(bindings).toEqual(expect.arrayContaining(['ticket', 'client-a', 'client-b']));
  });

  it('denies, without a subquery, when the client set is empty', () => {
    const hook = parentVisibleViaChildClients(documentParent, documentRefs);
    const { sql } = db('documents as d').modify((q) => hook(q, [])).toSQL().toNative();
    expect(sql).toMatch(/where 1 = 0$/);
    expect(sql).not.toContain('exists');
  });

  it('matches nothing for a child kind no resolver is registered for', () => {
    const empty = createClientResolverRegistry({});
    const hook = parentVisibleViaChildClients(documentParent, documentRefs, empty);
    const { sql } = db('documents as d').modify((q) => hook(q, ['client-a'])).toSQL().toNative();
    expect(sql).toContain('1 = 0');
    expect(sql).not.toContain('"tickets"');
  });

  it('never matches the kinds the resolver leaves out (user, team, tenant, document)', () => {
    const hook = parentVisibleViaChildClients(documentParent, documentRefs);
    const { bindings } = db('documents as d').modify((q) => hook(q, ['client-a'])).toSQL().toNative();
    for (const clientLess of ['user', 'team', 'tenant', 'document']) expect(bindings).not.toContain(clientLess);
  });

  it('refuses a child table the manifest does not declare as resolver-owned, at construction', () => {
    expect(() => parentVisibleViaChildClients({ table: 'tickets', parentKeyColumn: 'ticket_id' }, documentRefs)).toThrow(/not declared/);
  });

  it('serves the tag mappings the same way: kinds without a client (workflow_form) are never matched', () => {
    const hook = parentVisibleViaChildClients(
      { table: 'tag_mappings', parentKeyColumn: 'tag_id', alias: 'scope_tm' },
      { tenantRef: 'td.tenant', keyRef: 'td.tag_id' }
    );
    const { sql, bindings } = db('tag_definitions as td').modify((q) => hook(q, ['client-a'])).toSQL().toNative();
    expect(sql).toContain('"scope_tm"."tagged_type" = $');
    expect(bindings).toEqual(expect.arrayContaining(['ticket', 'client-a']));
    for (const clientLess of ['workflow_form', 'knowledge_base_article', 'document']) expect(bindings).not.toContain(clientLess);
  });
});

describe('document SQL adapter', () => {
  const adapter = createDocumentRelationshipSqlAdapter({ documentAlias: 'd', contactId: 'contact-1' });
  const sqlFor = (template: Parameters<typeof compileRelationshipTemplateSql>[1], overrides: Partial<AuthorizationSubject> = {}) => {
    const builder = db('documents as d');
    compileRelationshipTemplateSql(builder, template, { subject: { ...subject, ...overrides }, adapter, selectedClientIds: ['client-a'] });
    return builder.toSQL().toNative();
  };

  it.each(['client_portfolio', 'selected_clients', 'same_client'] as const)('%s goes through the association EXISTS', (template) => {
    const { sql } = sqlFor(template, { clientId: 'client-a' });
    expect(sql).toContain('from "document_associations" as "scope_da"');
  });

  it('a subject with an empty portfolio reads no client-owned document', () => {
    expect(sqlFor('client_portfolio', { portfolioClientIds: [] }).sql).toMatch(/where 1 = 0$/);
  });

  it('own is a user association, or (with none) the contact match, or the creator', () => {
    const { sql } = sqlFor('own');
    expect(sql).toContain('"scope_owner"."entity_type" = $');
    expect(sql).toContain('not exists (select 1 from "document_associations" as "scope_no_owner"');
    expect(sql).toContain('"scope_contact"."entity_type" = $');
    expect(sql).toContain('"d"."created_by" in');
  });

  it('assigned reads user associations and same_team reads team associations', () => {
    expect(sqlFor('assigned').sql).toContain('"scope_assigned"."entity_type" = $');
    const team = sqlFor('same_team');
    expect(team.sql).toContain('"scope_team"."entity_type" = $');
    expect(team.bindings).toEqual(expect.arrayContaining(['team', 'team-1']));
  });

  it('same_team denies a subject with no teams', () => {
    expect(sqlFor('same_team', { teamIds: [] }).sql).toMatch(/where 1 = 0$/);
  });
});

describe('applyReadScope', () => {
  const adapter: RelationshipSqlAdapter = { applyAssignedUsers: deny };
  const rule = (extra: Record<string, unknown>) => ({ id: 'r1', resource: 'document', action: 'read', ...extra }) as any;

  it('denies every row when a rule cannot be expressed in SQL (never runs a partial predicate)', () => {
    const builder = db('documents as d');
    applyReadScope(builder, { subject, bundleRules: [rule({ constraintKey: 'some_future_constraint' })] }, { resourceType: 'document', adapter });
    expect(builder.toSQL().toNative().sql).toMatch(/where 1 = 0$/);
  });

  it('treats hide_sensitive_fields as redaction only: it does not hide rows', () => {
    const builder = db('documents as d');
    applyReadScope(builder, { subject, bundleRules: [rule({ constraintKey: 'hide_sensitive_fields' })] }, { resourceType: 'document', adapter });
    expect(builder.toSQL().toNative().sql).not.toContain('1 = 0');
  });

  it('a closed bundle that does not name the resource denies', () => {
    const builder = db('documents as d');
    applyReadScope(
      builder,
      { subject, bundleRules: [rule({ resource: 'ticket', baseline: 'closed', bundleId: 'b', revisionId: 'v' })] },
      { resourceType: 'document', adapter }
    );
    expect(builder.toSQL().toNative().sql).toMatch(/where 1 = 0$/);
  });
});

describe('S2 fast path', () => {
  it('a tenant with no published assignment adds no clause and issues no statement', async () => {
    const conn = new Proxy({}, { get: () => { throw new Error('the fast path must not touch the database'); } }) as any;
    const cache = new RequestLocalAuthorizationCache();
    cache.set('authorization:tenant-scope:tenant-1', { publishedAssignments: false, portfolios: false, resolverSubjects: false });
    await expect(
      resolveNarrowedReadScope(conn, { tenant: 'tenant-1', user: { user_id: 'u', user_type: 'internal' } as any, resourceType: 'document', requestCache: cache })
    ).resolves.toBeNull();
    await expect(
      resolveNarrowedReadScope(conn, { tenant: 'tenant-1', user: { user_id: 'u', user_type: 'internal' } as any, resourceType: 'tag', requestCache: cache })
    ).resolves.toBeNull();
  });
});

describe('S2 fast path: built-in resolver subjects', () => {
  it('a tenant with no published assignment but a resolver subject (a co-managed seat) leaves the fast path', async () => {
    const conn = new Proxy({}, { get: () => { throw new Error('subject resolution reached the database'); } }) as any;
    const cache = new RequestLocalAuthorizationCache();
    cache.set('authorization:tenant-scope:tenant-1', { publishedAssignments: false, portfolios: false, resolverSubjects: true });
    await expect(
      resolveNarrowedReadScope(conn, { tenant: 'tenant-1', user: { user_id: 'u', user_type: 'internal' } as any, resourceType: 'document', requestCache: cache })
    ).rejects.toThrow();
  });
});

describe('resource type catalog', () => {
  it('declares the tag resource type next to the others', () => {
    expect(BUNDLE_RULE_RESOURCE_TYPE_CATALOG.has('tag')).toBe(true);
    for (const existing of ['ticket', 'document', 'time_entry', 'project', 'asset', 'billing']) {
      expect(BUNDLE_RULE_RESOURCE_TYPE_CATALOG.has(existing)).toBe(true);
    }
  });
});
