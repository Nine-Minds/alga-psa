'use strict';

/**
 * Contacts associated with a billing profile (M001, M002).
 *
 * A billing profile already names *one* invoice recipient through
 * `client_billing_profiles.billing_contact_id`. This table answers a different
 * question: which people belong to this segment, which one of them runs it, and
 * which of them may see the segment's tickets in the portal.
 *
 * The two booleans are deliberately independent:
 *
 *   - `is_manager` is a label. At most one per profile, enforced by the partial
 *     unique index below rather than by application code, for the same reason
 *     the default-profile rule is a database index.
 *   - `can_view_profile_tickets` is the portal grant, and it defaults to
 *     **false**. Naming someone the manager of a site must not silently widen
 *     what they can read; an MSP that wants every portal user to keep seeing
 *     every ticket changes nothing at all.
 *
 * A contact with no row here, or a row without the grant, keeps exactly the
 * visibility it has today.
 */

const TABLE = 'billing_profile_contacts';

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

async function addForeignKey(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('billing_profile_id').notNullable();
      table.uuid('contact_name_id').notNullable();
      table.boolean('is_manager').notNullable().defaultTo(false);
      table.boolean('can_view_profile_tickets').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by').nullable();
      table.primary(['tenant', 'billing_profile_id', 'contact_name_id']);
    });
  }

  // At most one manager per profile — same partial-unique shape as
  // client_billing_profiles_default_per_client_unique.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS billing_profile_contacts_manager_per_profile_unique
    ON ${TABLE} (tenant, billing_profile_id)
    WHERE is_manager = true
  `);

  // The portal reads this by contact: "which profiles may I see tickets for".
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_contact
    ON ${TABLE} (tenant, contact_name_id)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await addForeignKey(knex, TABLE, `${TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addForeignKey(knex, TABLE, `${TABLE}_billing_profile_foreign`,
    'FOREIGN KEY (tenant, billing_profile_id) REFERENCES client_billing_profiles (tenant, billing_profile_id) ON DELETE CASCADE');
  await addForeignKey(knex, TABLE, `${TABLE}_contact_foreign`,
    'FOREIGN KEY (tenant, contact_name_id) REFERENCES contacts (tenant, contact_name_id) ON DELETE CASCADE');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
