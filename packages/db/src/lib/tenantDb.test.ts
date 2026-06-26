import { afterAll, describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import { isTenantScopedQuery } from './tenantScopedQuery';
import { parseTableExpression, tenantTableMetadata } from './tenantTableMetadata';
import { tenantDb } from './tenantDb';

const knex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await knex.destroy();
});

describe('tenantDb facade', () => {
  it('parses table aliases for metadata lookup and tenant qualification', () => {
    expect(parseTableExpression('tickets as t')).toEqual({
      tableExpression: 'tickets as t',
      tableName: 'tickets',
      rootAlias: 't',
    });
    expect(parseTableExpression('public.clients c')).toEqual({
      tableExpression: 'public.clients c',
      tableName: 'clients',
      rootAlias: 'c',
    });
  });

  it('scopes tenant table roots through metadata', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('tickets as t').where('t.ticket_id', 'ticket-1');

    expect(query.toString()).toBe(
      `select * from "tickets" as "t" where "t"."tenant" = 'tenant-1' and "t"."ticket_id" = 'ticket-1'`
    );
  });

  it('returns a branded scoped query for safety-sensitive engines', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.scoped('tickets as t');

    expect(isTenantScopedQuery(query)).toBe(true);
    expect(query.tenant).toBe('tenant-1');
    expect(query.rootAlias).toBe('t');

    const filtered = query.withBuilder(query.builder.clone().where('t.ticket_id', 'ticket-1'));
    expect(isTenantScopedQuery(filtered)).toBe(true);
    expect(filtered.builder.toString()).toContain('"t"."ticket_id" = \'ticket-1\'');
  });

  it('fails closed for unknown tables', () => {
    const db = tenantDb(knex, 'tenant-1');

    expect(() => db.table('widgets')).toThrow('No tenant table metadata registered for widgets');
  });

  it('blocks admin-scoped tables through tenant queries', () => {
    tenantTableMetadata.tenant_db_admin_test = { scope: 'admin' };

    try {
      const db = tenantDb(knex, 'tenant-1');

      expect(() => db.table('tenant_db_admin_test')).toThrow(
        'Admin table tenant_db_admin_test cannot be accessed through tenantDb.table'
      );
    } finally {
      delete tenantTableMetadata.tenant_db_admin_test;
    }
  });

  it('allows registered global tables without a tenant predicate', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('knex_migrations');

    expect(query.toString()).toBe('select * from "knex_migrations"');
  });

  it('adds tenant equality when joining tenant tables', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('tickets as t').select('t.ticket_id');

    db.tenantJoin(query, 'clients as c', 'c.client_id', 't.client_id');

    expect(query.toString()).toContain(
      'inner join "clients" as "c" on "c"."client_id" = "t"."client_id" and "c"."tenant" = "t"."tenant"'
    );
  });

  it('supports left tenant joins with explicit root tenant columns', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('workstation_assets as aw').select('aw.asset_id');

    db.tenantJoin(query, 'assets as a', 'a.asset_id', 'aw.asset_id', {
      type: 'left',
      rootTenantColumn: 'aw.tenant',
    });

    expect(query.toString()).toContain(
      'left join "assets" as "a" on "a"."asset_id" = "aw"."asset_id" and "a"."tenant" = "aw"."tenant"'
    );
  });

  it('supports additional join predicates inside tenant joins', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('clients as c').select('c.client_id');

    db.tenantJoin(query, 'document_associations as da', 'c.client_id', 'da.entity_id', {
      type: 'left',
      on: (join) => join.andOnVal('da.entity_type', '=', 'client'),
    });

    expect(query.toString()).toContain(
      `left join "document_associations" as "da" on "c"."client_id" = "da"."entity_id" and "da"."tenant" = "c"."tenant" and "da"."entity_type" = 'client'`
    );
  });

  it('requires an explicit reason for unscoped access', () => {
    const db = tenantDb(knex, 'tenant-1');

    expect(() => db.unscoped('tenants', '')).toThrow('tenantDb.unscoped requires a reason');
    expect(db.unscoped('tenants', 'tenant discovery').toString()).toBe('select * from "tenants"');
  });
});
