/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  const hasTenantId = await knex.schema.hasColumn('email_sending_logs', 'tenant_id');
  const tenantColumn = hasTenant ? 'tenant' : hasTenantId ? 'tenant_id' : null;

  if (!tenantColumn) {
    throw new Error('email_sending_logs is missing both tenant and tenant_id columns');
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_entity
    ON email_sending_logs (${tenantColumn}, entity_type, entity_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_contact
    ON email_sending_logs (${tenantColumn}, contact_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_entity');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_contact');
};

// Disable transaction wrapper for Citus - CREATE INDEX can cause long locks on distributed tables
exports.config = { transaction: false };
