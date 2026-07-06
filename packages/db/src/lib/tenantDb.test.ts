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

  it('registers tenant deletion helper tables in metadata', () => {
    for (const table of [
      'vectors',
      'gmail_processed_history',
      'kb_article_relations',
      'stripe_accounts',
      'storage_configurations',
      'provider_events',
      'storage_providers',
      'approval_thresholds',
      'approval_levels',
      'attribute_definitions',
      'tenant_time_period_settings',
      'time_period_types',
      'email_rate_limits',
      'email_templates',
    ]) {
      expect(tenantTableMetadata[table], table).toEqual({ scope: 'tenant' });
    }

    for (const table of [
      'extension_event_subscription',
      'extension_execution_log',
      'extension_quota_usage',
    ]) {
      expect(tenantTableMetadata[table], table).toEqual({ scope: 'tenant', tenantColumn: 'tenant_id' });
    }
  });

  it('scopes tenant_id table roots through metadata', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('extension_execution_log as eel').where('eel.request_id', 'request-1');

    expect(query.toString()).toBe(
      `select * from "extension_execution_log" as "eel" where "eel"."tenant_id" = 'tenant-1' and "eel"."request_id" = 'request-1'`
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

  it('scopes tenantless child tables through registered tenant-owned parents', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.parentScopedTable('tax_holidays as th').where('th.name', 'Holiday');

    expect(query.toString()).toContain(
      `from "tax_holidays" as "th" where exists (select 1 from "tax_rates" as "__th_tenant_parent" where "__th_tenant_parent"."tenant" = 'tenant-1' and "__th_tenant_parent"."tax_rate_id" = "th"."tax_rate_id")`
    );
    expect(query.toString()).toContain(`"th"."name" = 'Holiday'`);
  });

  it('fails closed when parent-scoped child tables use direct tenant roots', () => {
    const db = tenantDb(knex, 'tenant-1');

    expect(() => db.table('tax_holidays')).toThrow(
      'Parent-scoped child table tax_holidays must use tenantDb.parentScopedTable'
    );
    expect(() => db.parentScopedTable('tax_rates')).toThrow(
      'Table tax_rates is not registered as tenant-scoped through a parent'
    );
  });

  it('fails closed for malformed parent-scoped inserts before querying', async () => {
    const db = tenantDb(knex, 'tenant-1');

    await expect(
      db.insertParentScoped('tax_rates', { tax_rate_id: 'tax-rate-1' })
    ).rejects.toThrow('Table tax_rates is not registered as tenant-scoped through a parent');

    await expect(
      db.insertParentScoped('tax_holidays as th', { tax_rate_id: 'tax-rate-1' })
    ).rejects.toThrow('Parent-scoped inserts must target a table name without alias');

    await expect(
      db.insertParentScoped('tax_holidays', { name: 'Holiday' })
    ).rejects.toThrow('Parent-scoped insert into tax_holidays requires tax_rate_id');
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

  it('supports tenant joins against the facade tenant for global roots', () => {
    const db = tenantDb(knex, 'tenant-1');
    const query = db.table('notification_categories as nc').select('nc.id');

    db.tenantJoin(query, 'tenant_notification_category_settings as tcs', 'tcs.category_id', 'nc.id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    expect(query.toString()).toContain(
      `left join "tenant_notification_category_settings" as "tcs" on "tcs"."category_id" = "nc"."id" and "tcs"."tenant" = 'tenant-1'`
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

  it('supports tenant joins to derived subqueries', () => {
    const db = tenantDb(knex, 'tenant-1');
    const latestLocations = db.table('client_locations as cl')
      .select('cl.tenant', 'cl.client_id', knex.raw('1 as rn'))
      .as('latest_locations');
    const query = db.table('clients as c').select('c.client_id');

    db.tenantJoinSubquery(query, latestLocations, 'c.client_id', 'latest_locations.client_id', {
      type: 'left',
      rootTenantColumn: 'c.tenant',
      joinedTenantColumn: 'latest_locations.tenant',
      on(join) {
        join.andOn('latest_locations.rn', '=', knex.raw('1'));
      },
    });

    expect(query.toString()).toContain(
      `left join (select "cl"."tenant", "cl"."client_id", 1 as rn from "client_locations" as "cl" where "cl"."tenant" = 'tenant-1') as "latest_locations" on "c"."client_id" = "latest_locations"."client_id" and "latest_locations"."tenant" = "c"."tenant" and "latest_locations"."rn" = 1`
    );
  });

  it('supports correlated tenant predicates outside joins', () => {
    const db = tenantDb(knex, 'tenant-1');
    const waitSearch = db
      .unscoped('workflow_run_waits as w', 'all-tenant workflow wait search')
      .select(1)
      .whereRaw('?? = ??', ['w.run_id', 'r.run_id']);
    const query = db
      .unscoped('workflow_runs as r', 'all-tenant workflow run search')
      .whereExists(db.tenantWhereColumn(waitSearch, 'w.tenant', 'r.tenant'));

    expect(query.toString()).toContain(
      'where exists (select 1 from "workflow_run_waits" as "w" where "w"."run_id" = "r"."run_id" and "w"."tenant" = "r"."tenant")'
    );
  });

  it('requires an explicit reason for unscoped access', () => {
    const db = tenantDb(knex, 'tenant-1');

    expect(() => db.unscoped('tenants', '')).toThrow('tenantDb.unscoped requires a reason');
    expect(db.unscoped('tenants', 'tenant discovery').toString()).toBe('select * from "tenants"');
  });
});
