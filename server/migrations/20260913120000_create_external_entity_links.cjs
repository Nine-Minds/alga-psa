/**
 * Ticket external system links (2026-09-13)
 *
 * Gives tickets and their comments structured, tenant-isolated references to
 * records in external systems (Discord threads, GitHub issues, vendor cases).
 * Two tables:
 *
 *  - tenant_external_systems  tenant-defined `custom:<slug>` system registry
 *                             (built-in systems live in code)
 *  - external_entity_links    one row per external reference, at ticket or
 *                             comment level
 *
 * See docs/plans/2026-09-13-ticket-external-system-link-plan.md §2.
 *
 * Composite (tenant, id) primary keys, Citus distribution by tenant, and no
 * RLS policies — application-level tenant scoping, following ticket_audit_logs
 * and the 2026-06-10 ticket close rules migration.
 */

// Distribute tenant-scoped tables, colocated with `tenants`. No-op on plain
// Postgres and on already-distributed tables. See
// docs/architecture/citus-migration-best-practices.md §Best Practices #1.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

// Helper: add a composite FK only if it doesn't already exist
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
  // --- tenant_external_systems --------------------------------------------
  if (!(await knex.schema.hasTable('tenant_external_systems'))) {
    await knex.schema.createTable('tenant_external_systems', (table) => {
      table.uuid('tenant').notNullable();
      table.text('key').notNullable()
        .comment('custom:<slug>; built-in system keys live in code.');
      table.text('label').notNullable();
      table.text('url_template').nullable()
        .comment('Optional {realm}/{external_id} template; links may still carry an explicit url.');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'key']);
    });

    await knex.raw(`
      ALTER TABLE tenant_external_systems
      ADD CONSTRAINT tenant_external_systems_key_check
      CHECK (key ~ '^custom:[a-z0-9_]+$')
    `);
  }

  // --- external_entity_links ----------------------------------------------
  if (!(await knex.schema.hasTable('external_entity_links'))) {
    await knex.schema.createTable('external_entity_links', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('link_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('entity_type').notNullable()
        .comment("'ticket' | 'comment'");
      table.uuid('entity_id').notNullable()
        .comment('ticket_id or comment_id, per entity_type.');
      table.uuid('ticket_id').notNullable()
        .comment('Always set (comment links denormalize the owning ticket).');
      table.text('system').notNullable()
        .comment('Registry key: built-in or custom:<slug>.');
      table.text('external_id').notNullable();
      table.text('external_parent_id').nullable()
        .comment('For comment links, the ticket-level external id (thread / issue).');
      table.text('realm').nullable()
        .comment('Repository, server, workspace, etc.');
      table.text('url').nullable()
        .comment('Explicit link-out; overrides the system url_template when present.');
      table.text('relationship').notNullable().defaultTo('reference')
        .comment("'origin' | 'mirror' | 'reference'");
      table.jsonb('actor').nullable()
        .comment('{ id?, handle?, display_name?, url? } who acted in the external system.');
      table.text('external_status').nullable();
      table.timestamp('external_updated_at', { useTz: true }).nullable();
      table.timestamp('last_synced_at', { useTz: true }).nullable();
      table.jsonb('metadata').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'link_id']);
    });

    await knex.raw(`
      ALTER TABLE external_entity_links
      ADD CONSTRAINT external_entity_links_entity_type_check
      CHECK (entity_type IN ('ticket', 'comment'))
    `);
    await knex.raw(`
      ALTER TABLE external_entity_links
      ADD CONSTRAINT external_entity_links_relationship_check
      CHECK (relationship IN ('origin', 'mirror', 'reference'))
    `);

    // One Alga entity per external record per level. COALESCE keeps two
    // ticket-level references (null parent) from both passing NULL-distinct
    // uniqueness. Includes the Citus distribution column (tenant).
    await knex.raw(`
      CREATE UNIQUE INDEX external_entity_links_external_unique
      ON external_entity_links (
        tenant, system, external_id, COALESCE(external_parent_id, ''), entity_type
      )
    `);

    // At most one origin per Alga entity.
    await knex.raw(`
      CREATE UNIQUE INDEX external_entity_links_origin_unique
      ON external_entity_links (tenant, entity_type, entity_id)
      WHERE relationship = 'origin'
    `);

    await knex.raw(`
      CREATE INDEX external_entity_links_ticket_idx
      ON external_entity_links (tenant, ticket_id)
    `);

    await knex.raw(`
      CREATE INDEX external_entity_links_external_lookup_idx
      ON external_entity_links (tenant, system, external_id)
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'tenant_external_systems');
  await ensureTenantDistribution(knex, 'external_entity_links');

  await addForeignKeyIfMissing(knex, 'tenant_external_systems_tenant_fkey', `
    ALTER TABLE tenant_external_systems
      ADD CONSTRAINT tenant_external_systems_tenant_fkey
      FOREIGN KEY (tenant)
      REFERENCES tenants(tenant)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'external_entity_links_tenant_fkey', `
    ALTER TABLE external_entity_links
      ADD CONSTRAINT external_entity_links_tenant_fkey
      FOREIGN KEY (tenant)
      REFERENCES tenants(tenant)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'external_entity_links_ticket_fkey', `
    ALTER TABLE external_entity_links
      ADD CONSTRAINT external_entity_links_ticket_fkey
      FOREIGN KEY (tenant, ticket_id)
      REFERENCES tickets(tenant, ticket_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'external_entity_links_created_by_fkey', `
    ALTER TABLE external_entity_links
      ADD CONSTRAINT external_entity_links_created_by_fkey
      FOREIGN KEY (tenant, created_by)
      REFERENCES users(tenant, user_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('external_entity_links');
  await knex.schema.dropTableIfExists('tenant_external_systems');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
