/**
 * Re-introduce provider-level inbound ticket defaults link
 * Adds nullable inbound_ticket_defaults_id to email_providers and indexes it.
 */

exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('email_providers', 'inbound_ticket_defaults_id');
  if (!hasColumn) {
    await knex.schema.alterTable('email_providers', (table) => {
      table.uuid('inbound_ticket_defaults_id').nullable();
    });
    // Helpful index for lookups by tenant + defaults
    try {
      await knex.schema.alterTable('email_providers', (table) => {
        table.index(['tenant', 'inbound_ticket_defaults_id'], 'idx_email_providers_tenant_defaults');
      });
    } catch (_) {}
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('email_providers', 'inbound_ticket_defaults_id');
  if (hasColumn) {
    try { await knex.schema.alterTable('email_providers', (table) => { table.dropIndex(['tenant', 'inbound_ticket_defaults_id'], 'idx_email_providers_tenant_defaults'); }); } catch (_) {}
    await knex.schema.alterTable('email_providers', (table) => {
      table.dropColumn('inbound_ticket_defaults_id');
    });
  }
};
