'use strict';

/**
 * Documentation links on ticket templates (2026-11-09).
 * See docs/plans/2026-11-09-hudu-doc-links-plan.md §2.1, §2.2, §2.3.
 *
 *  1. external_entity_links_external_unique becomes a partial unique index covering only the identity
 *     relationships (origin, mirror). A `reference` is a citation and may sit on many tickets.
 *  2. external_entity_links_reference_unique keeps one reference per record per entity.
 *  3. external_entity_links.title (nullable) — human title for a citation.
 *  4. ticket_template_links — links a ticket template carries (always `reference` when copied).
 *
 * Every index includes the Citus distribution column (`tenant`). Runs outside a transaction (Citus).
 */

const LINKS = 'external_entity_links';
const TEMPLATE_LINKS = 'ticket_template_links';
const TEMPLATES = 'ticket_templates';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addConstraint(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

/** Index definition as Postgres reports it, or null when the index does not exist. */
async function indexDefinition(knex, indexName) {
  const result = await knex.raw('SELECT indexdef FROM pg_indexes WHERE indexname = ?', [indexName]);
  return result.rows?.[0]?.indexdef ?? null;
}

/**
 * Whether a usable index of that name exists. A failed CREATE INDEX CONCURRENTLY leaves an invalid
 * index behind, which is dropped here so the next run builds it again.
 */
async function hasValidIndex(knex, indexName) {
  const result = await knex.raw(
    `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ?`,
    [indexName]
  );
  const row = result.rows?.[0];
  if (!row) return false;
  if (row.valid) return true;
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
  return false;
}

const LEGACY_EXTERNAL_UNIQUE = 'external_entity_links_external_unique_legacy';

exports.up = async function up(knex) {
  // --- 1 + 2: relationship-scoped uniqueness ---------------------------------
  // external_entity_links already holds data, so every index here is built CONCURRENTLY, and the
  // old tenant-wide index stays in force (under a legacy name) until its partial replacement is
  // built: origin/mirror rows are never without their uniqueness rule while this runs.
  // Each step runs only when it is still to do, so a rerun (or a caller that has already applied
  // this part) issues no concurrent DDL at all.
  if (!(await hasValidIndex(knex, 'external_entity_links_reference_unique'))) {
    await knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS external_entity_links_reference_unique
      ON ${LINKS} (tenant, entity_type, entity_id, system, external_id, COALESCE(external_parent_id, ''))
      WHERE relationship = 'reference'
    `);
  }

  const current = await indexDefinition(knex, 'external_entity_links_external_unique');
  if (current && !/\bWHERE\b/i.test(current)) {
    await knex.raw(`ALTER INDEX external_entity_links_external_unique RENAME TO ${LEGACY_EXTERNAL_UNIQUE}`);
  }
  if (!(await hasValidIndex(knex, 'external_entity_links_external_unique'))) {
    await knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS external_entity_links_external_unique
      ON ${LINKS} (tenant, system, external_id, COALESCE(external_parent_id, ''), entity_type)
      WHERE relationship IN ('origin', 'mirror')
    `);
  }
  if (await indexDefinition(knex, LEGACY_EXTERNAL_UNIQUE)) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${LEGACY_EXTERNAL_UNIQUE}`);
  }

  // --- 3: title ---------------------------------------------------------------
  await knex.raw(`ALTER TABLE ${LINKS} ADD COLUMN IF NOT EXISTS title text NULL`);

  // --- 4: ticket_template_links ----------------------------------------------
  if (!(await knex.schema.hasTable(TEMPLATE_LINKS))) {
    await knex.schema.createTable(TEMPLATE_LINKS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_link_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.text('system').notNullable().comment('Registry key: built-in or custom:<slug>.');
      table.text('external_id').notNullable();
      table.text('realm').nullable();
      table.text('url').nullable().comment('Stored absolute; never re-resolved at ticket creation.');
      table.text('title').nullable();
      table.integer('order_number').notNullable().defaultTo(0);
      table.jsonb('metadata').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'template_link_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TEMPLATE_LINKS}_template
    ON ${TEMPLATE_LINKS} (tenant, template_id)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TEMPLATE_LINKS);

  // Unique after distribution; includes the distribution column.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TEMPLATE_LINKS}_template_external_unique
    ON ${TEMPLATE_LINKS} (tenant, template_id, system, external_id)
  `);

  await addConstraint(knex, TEMPLATE_LINKS, `${TEMPLATE_LINKS}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addConstraint(knex, TEMPLATE_LINKS, `${TEMPLATE_LINKS}_template_foreign`,
    `FOREIGN KEY (tenant, template_id) REFERENCES ${TEMPLATES} (tenant, template_id) ON DELETE CASCADE`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TEMPLATE_LINKS);
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS external_entity_links_reference_unique');
  // Restoring the tenant-wide rule fails if multiple tickets now share a reference; remove those
  // duplicates (keeping the oldest row per record) so the rollback is possible.
  await knex.raw(`
    DELETE FROM ${LINKS} l
    USING (
      SELECT tenant, link_id,
             row_number() OVER (
               PARTITION BY tenant, system, external_id, COALESCE(external_parent_id, ''), entity_type
               ORDER BY created_at, link_id
             ) AS rn
      FROM ${LINKS}
    ) d
    WHERE l.tenant = d.tenant AND l.link_id = d.link_id AND d.rn > 1
  `);
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS external_entity_links_external_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS external_entity_links_external_unique
    ON ${LINKS} (tenant, system, external_id, COALESCE(external_parent_id, ''), entity_type)
  `);
  await knex.raw(`ALTER TABLE ${LINKS} DROP COLUMN IF EXISTS title`);
};

exports.config = { transaction: false };
