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
 * Citus: tag_references matches tag_definitions' distribution, decided at migration time. If
 * tag_definitions is distributed, tag_references is distributed on `tenant` co-located with it;
 * otherwise (plain Postgres, or tag_definitions coordinator-local, which is the case for every
 * migration in this repo) it stays local. Either way both sides share a distribution state, so
 * ensureCompositeFk adds the FK. (ensureTenantDistribution is not used: it co-locates with `tenants`.)
 * Distribution happens before the FK and the backfill. Application code still deletes a tag's
 * references explicitly in TagDefinition.delete.
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

  const {
    ensureCompositeFk, hasCitus, isDistributed, canCreateDistributedTable,
  } = require('./utils/citusDistribution.cjs');

  // Match tag_definitions' distribution so the composite FK is legal in both cases.
  if (
    (await hasCitus(knex)) &&
    (await canCreateDistributedTable(knex)) &&
    (await isDistributed(knex, 'tag_definitions')) &&
    !(await isDistributed(knex, TABLE))
  ) {
    await knex.raw(`SELECT create_distributed_table('${TABLE}', 'tenant', colocate_with => 'tag_definitions')`);
  }

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

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
