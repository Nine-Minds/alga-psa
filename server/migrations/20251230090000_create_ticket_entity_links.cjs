/**
 * Create polymorphic ticket_entity_links for workflow call actions.
 *
 * Supports tickets.link_entities action and bidirectional references from other actions.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('ticket_entity_links');
  if (exists) return;

  await knex.schema.createTable('ticket_entity_links', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('link_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('ticket_id').notNullable();
    table.text('entity_type').notNullable(); // project | project_task | asset | contract
    table.uuid('entity_id').notNullable();
    table.text('link_type').notNullable();
    table.jsonb('metadata');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'link_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
    table.unique(['tenant', 'ticket_id', 'entity_type', 'entity_id', 'link_type'], { indexName: 'ticket_entity_links_unique' });
    table.index(['tenant', 'ticket_id'], 'ticket_entity_links_ticket_idx');
    table.index(['tenant', 'entity_type', 'entity_id'], 'ticket_entity_links_entity_idx');
  });

  await knex.raw(`
    ALTER TABLE ticket_entity_links ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation_policy ON ticket_entity_links
      USING (tenant = current_setting('app.current_tenant')::uuid);

    CREATE POLICY tenant_isolation_insert_policy ON ticket_entity_links
      FOR INSERT
      WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_insert_policy ON ticket_entity_links;
    DROP POLICY IF EXISTS tenant_isolation_policy ON ticket_entity_links;
  `);
  await knex.schema.dropTableIfExists('ticket_entity_links');
};

