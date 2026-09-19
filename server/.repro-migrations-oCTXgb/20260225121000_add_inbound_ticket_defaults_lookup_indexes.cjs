/**
 * Add tenant-scoped lookup indexes for inbound destination references.
 *
 * Indexes:
 * - clients(tenant, inbound_ticket_defaults_id)
 * - contacts(tenant, inbound_ticket_defaults_id)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasClientsTable = await knex.schema.hasTable('clients');
  const hasContactsTable = await knex.schema.hasTable('contacts');

  if (hasClientsTable) {
    const hasClientColumn = await knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id');
    if (hasClientColumn) {
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_clients_tenant_inbound_ticket_defaults
        ON clients (tenant, inbound_ticket_defaults_id)
      `);
    }
  }

  if (hasContactsTable) {
    const hasContactColumn = await knex.schema.hasColumn('contacts', 'inbound_ticket_defaults_id');
    if (hasContactColumn) {
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_contacts_tenant_inbound_ticket_defaults
        ON contacts (tenant, inbound_ticket_defaults_id)
      `);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_clients_tenant_inbound_ticket_defaults');
  await knex.raw('DROP INDEX IF EXISTS idx_contacts_tenant_inbound_ticket_defaults');
};
