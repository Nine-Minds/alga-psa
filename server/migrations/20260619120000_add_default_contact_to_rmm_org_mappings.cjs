/**
 * Add an optional default notification contact to RMM organization mappings.
 *
 * The FK is tenant-scoped. On PostgreSQL 15+ the column-targeted SET NULL
 * keeps tenant intact when a referenced contact is deleted. Some Citus
 * deployments reject post-hoc colocated FKs; in that case the nullable column
 * and lookup index remain, and runtime validation enforces contact ownership.
 */

exports.config = { transaction: false };

const TABLE = 'rmm_organization_mappings';
const COLUMN = 'default_contact_id';
const INDEX = 'idx_rmm_org_mappings_default_contact';
const FK = 'rmm_org_mappings_tenant_default_contact_foreign';

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);
  if (!hasColumn) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.uuid(COLUMN).nullable();
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ${INDEX}
    ON ${TABLE} (tenant, ${COLUMN})
    WHERE ${COLUMN} IS NOT NULL
  `);

  const existingFk = await knex('pg_constraint')
    .where({ conname: FK })
    .first('conname');
  if (existingFk) {
    return;
  }

  try {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${FK}
      FOREIGN KEY (tenant, ${COLUMN})
      REFERENCES contacts (tenant, contact_name_id)
      ON DELETE SET NULL (${COLUMN})
    `);
  } catch (error) {
    console.warn(
      `[${FK}] could not add tenant-scoped contact FK; continuing with column and index only`,
      error,
    );
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK}`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);

  const hasColumn = await knex.schema.hasColumn(TABLE, COLUMN);
  if (hasColumn) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.dropColumn(COLUMN);
    });
  }
};
