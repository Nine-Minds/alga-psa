/**
 * Default time-entry service for tickets.
 *
 * When a technician logs time against a ticket, the service can be defaulted
 * from billing configuration instead of forcing a manual pick. Two nullable
 * columns carry the cascade:
 *
 *   - client_billing_settings.default_time_entry_service_id
 *       Per-client default. NULL means "inherit the tenant default".
 *   - default_billing_settings.default_time_entry_service_id
 *       Tenant-wide fallback used when the client has no default (or the
 *       client's default no longer resolves).
 *
 * Both are intentionally nullable with no default and no backfill. The
 * application resolver validates the candidate against the live service
 * catalog and client contract eligibility, and leaves the entry's service
 * empty when nothing valid resolves so the existing required-field behavior
 * is unchanged. A column FK is intentionally omitted: `service_catalog` is a
 * distributed table and FKs from reference tables to distributed tables are
 * unsupported, plus a hard FK would block service deletion (services are
 * soft-deactivated via `is_active`).
 */

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

async function addColumnIfMissing(knex, tableName) {
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log(`⊘ Skipping: ${tableName} table not found`);
    return;
  }

  if (await hasColumn(knex, tableName, 'default_time_entry_service_id')) {
    console.log(`⊘ ${tableName}.default_time_entry_service_id already exists, skipping`);
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.uuid('default_time_entry_service_id').nullable().defaultTo(null);
  });

  console.log(`✓ Added default_time_entry_service_id to ${tableName}`);
}

async function dropColumnIfPresent(knex, tableName) {
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    return;
  }

  if (!(await hasColumn(knex, tableName, 'default_time_entry_service_id'))) {
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn('default_time_entry_service_id');
  });

  console.log(`✓ Removed default_time_entry_service_id from ${tableName}`);
}

exports.up = async function up(knex) {
  await addColumnIfMissing(knex, 'client_billing_settings');
  await addColumnIfMissing(knex, 'default_billing_settings');
};

exports.down = async function down(knex) {
  await dropColumnIfPresent(knex, 'default_billing_settings');
  await dropColumnIfPresent(knex, 'client_billing_settings');
};

exports.config = { transaction: false };
