exports.config = { transaction: false };

exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('client_portal_visibility_groups', 'ticket_scope')) {
    await knex.schema.alterTable('client_portal_visibility_groups', (table) => {
      table.text('ticket_scope').notNullable().defaultTo('client');
      table.check("ticket_scope IN ('client', 'contact')", [], 'client_portal_visibility_groups_ticket_scope_check');
    });
  }

  // Equality on a contact never matches NULL; exclude those rows from the index.
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_tenant_contact
    ON tickets (tenant, contact_name_id) WHERE contact_name_id IS NOT NULL`);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_tickets_tenant_contact');
  if (await knex.schema.hasColumn('client_portal_visibility_groups', 'ticket_scope')) {
    await knex.schema.alterTable('client_portal_visibility_groups', (table) => {
      table.dropChecks('client_portal_visibility_groups_ticket_scope_check');
      table.dropColumn('ticket_scope');
    });
  }
};
