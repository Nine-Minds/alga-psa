'use strict';

/**
 * Tag display rules: which tag definitions render as chips next to an entity, per audience.
 *
 *   tag_display_rules (tenant, rule_id, tagged_type, audience, tag_id, position, created_at, created_by)
 *
 * `audience` is 'internal' (MSP users) or 'client' (client-portal users); no rule for an audience
 * means no chip tags for it. `tag_id` is the tag DEFINITION id (tag_definitions.tag_id), so a rule
 * survives the tag being untagged everywhere (orphan cleanup keeps referenced definitions) and is
 * deleted together with the definition: by the FK cascade where the FK exists, and explicitly by
 * TagDefinition.delete (application code) everywhere, since the FK may be absent on Citus.
 *
 * Seed: existing contact and client definitions whose text is "VIP" (any case) get an internal rule,
 * so users who already tag VIP see the chip without configuring anything.
 *
 * Citus: new table (no pre-existing rows to truncate), distributed on `tenant` colocated with
 * `tenants`; the unique index includes the distribution column. No migration distributes
 * tag_definitions, so it is coordinator-local there, and ensureCompositeFk skips the composite FK
 * to tag_definitions ("incompatible distribution": one side distributed, the other not). On Citus
 * the FK and its ON DELETE CASCADE may therefore not exist; application code deletes the rules
 * explicitly. Plain Postgres gets the FK. The seed uses no now() inside CASE/COALESCE.
 */

const TABLE = 'tag_display_rules';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('rule_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('tagged_type').notNullable();
      table.text('audience').notNullable();
      table.uuid('tag_id').notNullable();
      table.integer('position').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by').nullable();

      table.primary(['tenant', 'rule_id']);
    });
  }

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${TABLE}_audience_check' AND conrelid = '${TABLE}'::regclass) THEN
        ALTER TABLE ${TABLE} ADD CONSTRAINT ${TABLE}_audience_check CHECK (audience IN ('internal', 'client'));
      END IF;
    END $$;
  `);

  const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TABLE}_unique_tag
    ON ${TABLE} (tenant, tagged_type, audience, tag_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_lookup
    ON ${TABLE} (tenant, tagged_type, audience, position)
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${TABLE}_tenant_foreign' AND conrelid = '${TABLE}'::regclass) THEN
        ALTER TABLE ${TABLE} ADD CONSTRAINT ${TABLE}_tenant_foreign FOREIGN KEY (tenant) REFERENCES tenants(tenant);
      END IF;
    END $$;
  `);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_tag_definition_foreign`,
    columns: ['tenant', 'tag_id'],
    referencedTable: 'tag_definitions',
    referencedColumns: ['tenant', 'tag_id'],
    onDelete: 'CASCADE',
  });

  await knex.raw(`
    INSERT INTO ${TABLE} (tenant, tagged_type, audience, tag_id, position)
    SELECT td.tenant, td.tagged_type, 'internal', td.tag_id, 0
    FROM tag_definitions td
    WHERE td.tagged_type IN ('contact', 'client')
      AND lower(btrim(td.tag_text)) = 'vip'
    ON CONFLICT (tenant, tagged_type, audience, tag_id) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
