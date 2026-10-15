/**
 * Named list views (2026-09-22)
 *
 * A named view is a saved configuration of a list screen — filters, sort,
 * columns, density, page size — owned by one user and either private to them
 * or shared with every MSP user who can read that list.
 *
 * See ee/docs/plans/2026-09-22-named-list-views/PRD.md §Data model.
 *
 *  - `list_key` names the list (tickets, projects, …). It is validated in the
 *    application against the list-view registry, not by a check constraint, so
 *    adding a list is a code change rather than a migration.
 *  - `visibility` is text with a check constraint rather than a boolean, so a
 *    later scope (team, role) is an added value, not a type change.
 *  - `settings` is the adapter-validated ListViewSettings envelope; the
 *    `schema_version` lets each adapter migrate older documents on read.
 *
 * Composite (tenant, view_id) primary key, Citus distribution by tenant, and
 * no ON DELETE SET NULL (unsupported on Citus): the user-deletion action
 * removes a departing owner's private views and reassigns their shared ones.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('list_views'))) {
    await knex.schema.createTable('list_views', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('view_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('list_key').notNullable()
        .comment('List the view belongs to (tickets, projects, clients, contacts, assets).');
      table.text('name').notNullable();
      table.uuid('owner_user_id').notNullable();
      table.text('visibility').notNullable()
        .comment("'private' | 'shared'");
      table.jsonb('settings').notNullable()
        .comment('ListViewSettings envelope, validated by the list adapter schema on write.');
      table.integer('schema_version').notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'view_id']);
    });

    await knex.raw(`
      ALTER TABLE list_views
      ADD CONSTRAINT list_views_visibility_check
      CHECK (visibility IN ('private', 'shared'))
    `);
    await knex.raw(`
      ALTER TABLE list_views
      ADD CONSTRAINT list_views_name_length_check
      CHECK (char_length(name) BETWEEN 1 AND 100)
    `);

    await knex.raw(`
      CREATE INDEX list_views_list_visibility_idx
      ON list_views (tenant, list_key, visibility)
    `);

    // A user cannot have two views of the same name on one list. Includes the
    // Citus distribution column (tenant).
    await knex.raw(`
      CREATE UNIQUE INDEX list_views_owner_name_unique
      ON list_views (tenant, list_key, owner_user_id, lower(name))
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'list_views');

  await addForeignKeyIfMissing(knex, 'list_views_tenant_fkey', `
    ALTER TABLE list_views
      ADD CONSTRAINT list_views_tenant_fkey
      FOREIGN KEY (tenant)
      REFERENCES tenants(tenant)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'list_views_owner_fkey', `
    ALTER TABLE list_views
      ADD CONSTRAINT list_views_owner_fkey
      FOREIGN KEY (tenant, owner_user_id)
      REFERENCES users(tenant, user_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('list_views');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
