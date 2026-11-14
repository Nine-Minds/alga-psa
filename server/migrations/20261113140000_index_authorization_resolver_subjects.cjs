/**
 * Native authorization probes must not read feature tables for ordinary tenants.
 * Keep conservative resolver membership in the authorization layer. A colocated
 * FK makes missing membership impossible, including for revoked seat assignments;
 * no trigger or rollout flag is involved. Feature facts remain authoritative.
 * Constraints enforce new writes immediately; 20261113140100 validates existing
 * rows separately so the validation scan does not hold this migration's DDL locks.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'authorization_resolver_subjects';
const SEATS = 'co_managed_seat_assignments';
const FK = 'co_managed_seat_assignment_resolver_subject_fk';
const CHECK = 'co_managed_seat_assignment_resolver_id_check';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.text('resolver_id').notNullable();
      table.uuid('user_id').notNullable();
      table.primary(['tenant', 'resolver_id', 'user_id']);
    });
  }
  await ensureTenantDistribution(knex, TABLE);
  await ensureTenantDistribution(knex, SEATS);

  if (!(await knex.schema.hasColumn(SEATS, 'authority_resolver_id'))) {
    await knex.schema.alterTable(SEATS, (table) => {
      table.text('authority_resolver_id').notNullable().defaultTo('co-managed-seat');
    });
  }
  await knex.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = '${CHECK}' AND conrelid = '${SEATS}'::regclass) THEN
      ALTER TABLE ${SEATS} ADD CONSTRAINT ${CHECK}
        CHECK (authority_resolver_id = 'co-managed-seat') NOT VALID;
    END IF;
  END $$`);

  // Migration-wide backfill: carry each source row's tenant into its index key.
  // Every state counts, including revoked assignments and ended arrangements.
  await knex.raw(`INSERT INTO ${TABLE} (tenant, resolver_id, user_id)
    SELECT DISTINCT tenant, authority_resolver_id, user_id FROM ${SEATS}
    WHERE user_id IS NOT NULL
    ON CONFLICT (tenant, resolver_id, user_id) DO NOTHING`);

  // Both tables are tenant-distributed and colocated. Never skip this FK:
  // it is the safety guarantee behind the probe's negative answer.
  await knex.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = '${FK}' AND conrelid = '${SEATS}'::regclass) THEN
      ALTER TABLE ${SEATS} ADD CONSTRAINT ${FK}
      FOREIGN KEY (tenant, authority_resolver_id, user_id)
      REFERENCES ${TABLE} (tenant, resolver_id, user_id) NOT VALID;
    END IF;
  END $$`);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable(TABLE)) {
    if (await knex(TABLE).whereNot('resolver_id', 'co-managed-seat').first()) {
      throw new Error('Cannot remove membership retained by other authorization resolvers');
    }
  }
  await knex.raw(`ALTER TABLE ${SEATS} DROP CONSTRAINT IF EXISTS ${FK}`);
  await knex.raw(`ALTER TABLE ${SEATS} DROP CONSTRAINT IF EXISTS ${CHECK}`);
  if (await knex.schema.hasColumn(SEATS, 'authority_resolver_id')) {
    await knex.schema.alterTable(SEATS, (table) => table.dropColumn('authority_resolver_id'));
  }
  await knex.schema.dropTableIfExists(TABLE);
};
