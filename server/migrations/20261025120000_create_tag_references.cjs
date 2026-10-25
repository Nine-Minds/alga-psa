'use strict';

/**
 * Tag references: configuration that points at a tag definition.
 *
 *   tag_references (tenant, tag_id, referrer_type, referrer_id, created_at)
 *
 * A referrer (a display rule, later a service-request audience, ...) registers the tag definitions
 * it points at through replaceTagReferences / deleteTagReferences (packages/tags), in the same
 * transaction as its own write. Orphan cleanup deletes only definitions that have no mappings AND no
 * tag_references row, so packages/tags never needs to know which referrer types exist. It is a table,
 * not an in-process registry, because cleanup also runs in workflow-worker and tenant jobs.
 *
 * Citus: no migration distributes tag_definitions, so it is coordinator-local. tag_references is kept
 * coordinator-local too (no ensureTenantDistribution), which lets the composite FK to tag_definitions
 * actually hold (ensureCompositeFk requires both sides distributed or both local). If tag_definitions
 * is ever distributed, distribute this table on `tenant` colocated with it in that same change.
 * Application code still deletes a tag's references explicitly in TagDefinition.delete.
 *
 * Backfill: one row per existing tag_display_rules row. No now() inside CASE/COALESCE.
 */

const TABLE = 'tag_references';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('tag_id').notNullable();
      table.text('referrer_type').notNullable();
      table.uuid('referrer_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'tag_id', 'referrer_type', 'referrer_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_referrer
    ON ${TABLE} (tenant, referrer_type, referrer_id)
  `);

  const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_tag_definition_foreign`,
    columns: ['tenant', 'tag_id'],
    referencedTable: 'tag_definitions',
    referencedColumns: ['tenant', 'tag_id'],
    onDelete: 'CASCADE',
  });

  if (await knex.schema.hasTable('tag_display_rules')) {
    await knex.raw(`
      INSERT INTO ${TABLE} (tenant, tag_id, referrer_type, referrer_id)
      SELECT r.tenant, r.tag_id, 'tag_display_rule', r.rule_id
      FROM tag_display_rules r
      ON CONFLICT DO NOTHING
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
