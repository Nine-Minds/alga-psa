import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import {
  cloneTenantScopedQuery,
  createTenantScopedQuery,
  isTenantScopedQuery,
  withTenantScopedQueryBuilder,
} from './tenantScopedQuery';

const db = knexFactory({ client: 'pg' });

afterAll(async () => {
  await db.destroy();
});

describe('tenant scoped query helper', () => {
  it('creates a branded query with the root tenant predicate', () => {
    const query = createTenantScopedQuery(db, {
      table: 'tickets as t',
      alias: 't',
      tenant: 'tenant-1',
    });

    expect(isTenantScopedQuery(query)).toBe(true);
    expect(query.tenant).toBe('tenant-1');
    expect(query.rootAlias).toBe('t');
    expect(query.qualifiedTenantColumn).toBe('t.tenant');
    expect(query.builder.toString()).toBe(
      `select * from "tickets" as "t" where "t"."tenant" = 'tenant-1'`
    );
  });

  it('infers the root tenant column for common table expressions', () => {
    const plainTableQuery = createTenantScopedQuery(db, {
      table: 'clients',
      tenant: 'tenant-1',
    });
    const aliasedTableQuery = createTenantScopedQuery(db, {
      table: 'tickets as t',
      tenant: 'tenant-1',
    });

    expect(plainTableQuery.rootAlias).toBe('clients');
    expect(plainTableQuery.qualifiedTenantColumn).toBe('clients.tenant');
    expect(plainTableQuery.builder.toString()).toBe(
      `select * from "clients" where "clients"."tenant" = 'tenant-1'`
    );
    expect(aliasedTableQuery.rootAlias).toBe('t');
    expect(aliasedTableQuery.qualifiedTenantColumn).toBe('t.tenant');
    expect(aliasedTableQuery.builder.toString()).toBe(
      `select * from "tickets" as "t" where "t"."tenant" = 'tenant-1'`
    );
  });

  it('preserves tenant metadata across clones and builder replacement', () => {
    const query = createTenantScopedQuery(db, {
      table: 'tickets as t',
      alias: 't',
      tenant: 'tenant-1',
    });

    const clone = cloneTenantScopedQuery(query);
    clone.builder.where('t.ticket_id', 'ticket-1');

    expect(clone.tenant).toBe(query.tenant);
    expect(query.builder.toString()).not.toContain('ticket-1');
    expect(clone.builder.toString()).toContain('"t"."ticket_id" = \'ticket-1\'');

    const replaced = withTenantScopedQueryBuilder(query, query.builder.clone().whereNull('t.closed_at'));
    expect(replaced.tenant).toBe(query.tenant);
    expect(replaced.builder.toString()).toContain('"t"."closed_at" is null');
  });
});
