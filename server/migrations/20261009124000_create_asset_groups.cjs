/**
 * Asset groups: bundles and shared workspaces (FR-E1).
 *
 * `asset_relationships` is pairwise parent/child with a free-text type and no
 * people, so it could not say "these six things are the front-desk setup" or
 * "this is a hot desk three people use". Two kinds:
 *
 *  - `bundle`: travels and is assigned as one unit — at most one `owner`
 *    contact, no `user` contacts.
 *  - `shared_workspace`: a place plus the people who use it — `user` contacts,
 *    no owner, and its member assets carry no single assignee.
 *
 * One group per asset (UNIQUE (tenant, asset_id) on the member table), decided
 * with the product owner. The kind/role invariants beyond the CHECKs live in
 * packages/assets/src/lib/assetGroups.ts.
 *
 * No RLS: tenant isolation is app-layer (scoped queries + Citus distribution).
 *
 * `location_id` gets its foreign key only where Citus allows one:
 * `client_locations` is still a coordinator-local table, and Citus refuses to
 * distribute a table that references one, so the constraint is added after
 * distribution and only when both sides match — the same bargain
 * `assets.location_id` struck in 20260518120000.
 */

const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const LOCATION_FK = {
  table: 'asset_groups',
  constraint: 'asset_groups_tenant_location_id_foreign',
  columns: ['tenant', 'location_id'],
  referencedTable: 'client_locations',
  referencedColumns: ['tenant', 'location_id'],
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_groups'))) {
    await knex.schema.createTable('asset_groups', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('group_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('client_id').notNullable();
      table.text('name').notNullable();
      table.text('kind').notNullable().defaultTo('bundle');
      table.uuid('location_id').nullable();
      table.text('description').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'group_id']);
      table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
      table.index(['tenant', 'client_id'], 'idx_asset_groups_client');
    });

    await knex.raw(`
      ALTER TABLE asset_groups
      ADD CONSTRAINT asset_groups_kind_check
      CHECK (kind IN ('bundle', 'shared_workspace'))
    `);
  }

  if (!(await knex.schema.hasTable('asset_group_members'))) {
    await knex.schema.createTable('asset_group_members', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('group_id').notNullable();
      table.uuid('asset_id').notNullable();
      table.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('added_by').nullable();

      table.primary(['tenant', 'group_id', 'asset_id']);
      // One group per asset (PRD open question 3, decided).
      table.unique(['tenant', 'asset_id'], 'asset_group_members_tenant_asset_uk');
      table.foreign(['tenant', 'group_id']).references(['tenant', 'group_id']).inTable('asset_groups').onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasTable('asset_group_contacts'))) {
    await knex.schema.createTable('asset_group_contacts', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('group_id').notNullable();
      table.uuid('contact_name_id').notNullable();
      table.text('role').notNullable().defaultTo('user');
      table.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'group_id', 'contact_name_id']);
      table.foreign(['tenant', 'group_id']).references(['tenant', 'group_id']).inTable('asset_groups').onDelete('CASCADE');
      table.index(['tenant', 'contact_name_id'], 'idx_asset_group_contacts_contact');
    });

    await knex.raw(`
      ALTER TABLE asset_group_contacts
      ADD CONSTRAINT asset_group_contacts_role_check
      CHECK (role IN ('owner', 'user'))
    `);
  }

  // An earlier run of this migration created the location FK inline, which
  // leaves create_distributed_table failing forever; clear it first so a
  // half-applied database can still be brought forward.
  await knex.raw(`ALTER TABLE asset_groups DROP CONSTRAINT IF EXISTS ${LOCATION_FK.constraint}`);

  await ensureTenantDistribution(knex, 'asset_groups');
  await ensureTenantDistribution(knex, 'asset_group_members');
  await ensureTenantDistribution(knex, 'asset_group_contacts');

  await ensureCompositeFk(knex, LOCATION_FK);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_group_contacts');
  await knex.schema.dropTableIfExists('asset_group_members');
  await knex.schema.dropTableIfExists('asset_groups');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
