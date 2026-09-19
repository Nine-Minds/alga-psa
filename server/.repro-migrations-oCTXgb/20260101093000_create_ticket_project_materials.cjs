/**
 * Create ticket_materials and project_materials tables for recording product/material usage that
 * flows into invoicing via the billing engine.
 *
 * V1 decisions:
 * - Materials are recorded on tickets and projects (not time entries yet)
 * - Materials auto-bill (no approval gate)
 * - Materials are ingested into billing engine as charges (like usage/time), then persisted to invoice items during invoice generation
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('ticket_materials', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('ticket_material_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('service_id').notNullable(); // product (service_catalog)

    table.integer('quantity').notNullable().defaultTo(1);
    table.bigInteger('rate').notNullable(); // cents
    table.text('currency_code').notNullable().defaultTo('USD');
    table.text('description').nullable();

    table.boolean('is_billed').notNullable().defaultTo(false);
    table.uuid('billed_invoice_id').nullable();
    table.timestamp('billed_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'ticket_material_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
  });

  await knex.schema.createTable('project_materials', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('project_material_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('project_id').notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('service_id').notNullable(); // product (service_catalog)

    table.integer('quantity').notNullable().defaultTo(1);
    table.bigInteger('rate').notNullable(); // cents
    table.text('currency_code').notNullable().defaultTo('USD');
    table.text('description').nullable();

    table.boolean('is_billed').notNullable().defaultTo(false);
    table.uuid('billed_invoice_id').nullable();
    table.timestamp('billed_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'project_material_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'project_id']).references(['tenant', 'project_id']).inTable('projects').onDelete('CASCADE');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('RESTRICT');
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_ticket_materials_unbilled
    ON ticket_materials (tenant, ticket_id, is_billed, created_at);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_materials_unbilled
    ON project_materials (tenant, project_id, is_billed, created_at);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_ticket_materials_client_unbilled
    ON ticket_materials (tenant, client_id, is_billed, created_at);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_project_materials_client_unbilled
    ON project_materials (tenant, client_id, is_billed, created_at);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_project_materials_client_unbilled;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_ticket_materials_client_unbilled;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_project_materials_unbilled;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_ticket_materials_unbilled;`);
  await knex.schema.dropTableIfExists('project_materials');
  await knex.schema.dropTableIfExists('ticket_materials');
};
