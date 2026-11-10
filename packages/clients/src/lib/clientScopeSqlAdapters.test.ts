import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  compileTenantScopedResourceReadAuthorizationSql,
  type AuthorizationSubject,
  type BundleNarrowingRule,
} from '@alga-psa/authorization/kernel';
import { AUTHORIZATION_RESOURCE_TYPE_CATALOG } from '@alga-psa/authorization/bundles/catalog';
import { createClientRelationshipSqlAdapter, createContactRelationshipSqlAdapter } from './clientScopeSqlAdapters';

const db = knexFactory({ client: 'pg' });
afterAll(async () => {
  await db.destroy();
});

const subject: AuthorizationSubject = { tenant: 'tenant-1', userId: 'user-1', userType: 'internal', portfolioClientIds: ['c-1', 'c-2'] };

const rule = (resource: string, templateKey: BundleNarrowingRule['templateKey'], extra: Partial<BundleNarrowingRule> = {}): BundleNarrowingRule => ({
  id: 'r', resource, action: 'read', templateKey, ...extra,
});

function sql(table: string, resource: 'client' | 'contact', alias: string, rules: BundleNarrowingRule[]) {
  const adapter = resource === 'client' ? createClientRelationshipSqlAdapter(alias) : createContactRelationshipSqlAdapter(alias);
  const query = tenantDb(db, subject.tenant).scoped(`${table} as ${alias}`);
  const result = compileTenantScopedResourceReadAuthorizationSql(query, {
    resourceType: resource, action: 'read', builtinRules: [], bundleRules: rules, ctx: { subject, adapter },
  });
  return { result, text: query.builder.toString() };
}

describe('client and contact SQL adapters', () => {
  it('lists client and contact in the resource-type catalog', () => {
    expect([...AUTHORIZATION_RESOURCE_TYPE_CATALOG].sort()).toEqual(['client', 'contact']);
  });

  it('maps the client column from the ownership declaration, under the query alias', () => {
    expect(createClientRelationshipSqlAdapter('c').clientColumn).toBe('c.client_id');
    expect(createContactRelationshipSqlAdapter('ct').clientColumn).toBe('ct.client_id');
  });

  it('narrows clients to selected_clients on the client\'s own id', () => {
    const { result, text } = sql('clients', 'client', 'c', [rule('client', 'selected_clients', { selectedClientIds: ['c-1', 'c-2'] })]);
    expect(result.supported).toBe(true);
    expect(text).toContain(`"c"."client_id" in ('c-1', 'c-2')`);
  });

  it('narrows contacts by contacts.client_id with client_portfolio', () => {
    const { text } = sql('contacts', 'contact', 'contacts', [rule('contact', 'client_portfolio')]);
    expect(text).toContain(`"contacts"."client_id" in ('c-1', 'c-2')`);
  });

  it('denies everything when selected_clients selects nothing', () => {
    expect(sql('contacts', 'contact', 'contacts', [rule('contact', 'selected_clients', { selectedClientIds: [] })]).text).toContain('1 = 0');
  });

  it.each(['own', 'assigned', 'managed', 'same_team', 'selected_boards'] as const)(
    'denies the %s template: neither table has that relation',
    (template) => {
      expect(sql('clients', 'client', 'c', [rule('client', template)]).text).toContain('1 = 0');
    }
  );

  it('denies client_visible_only: neither table has a visibility column', () => {
    const { text } = sql('contacts', 'contact', 'contacts', [rule('contact', null, { constraintKey: 'client_visible_only' })]);
    expect(text).toContain('1 = 0');
  });

  it('adds nothing when no rule matches the resource', () => {
    const { text } = sql('contacts', 'contact', 'contacts', [rule('ticket', 'selected_clients', { selectedClientIds: ['c-1'] })]);
    expect(text).not.toMatch(/client_id/);
  });
});
