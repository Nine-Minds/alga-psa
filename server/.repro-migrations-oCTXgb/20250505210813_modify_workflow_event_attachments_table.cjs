'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    // 1. Add the new event_type column, initially nullable
    table.string('event_type', 255).nullable();
  });

  // 2. Populate the new event_type column using data from event_catalog
  // This assumes event_id exists and is correctly referenced in event_catalog
  await knex.raw(`
    UPDATE workflow_event_attachments AS wea
    SET event_type = ec.event_type
    FROM event_catalog AS ec
    WHERE wea.event_id = ec.event_id AND wea.tenant_id = ec.tenant_id;
  `);

  // 3. Make the event_type column not nullable
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.string('event_type', 255).notNullable().alter();
  });

  // 4. Drop the old unique constraint and foreign key constraint
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.dropUnique(['workflow_id', 'event_id', 'tenant_id'], 'workflow_event_attachments_workflow_id_event_id_tenant_id_uniqu');
    table.dropForeign('event_id', 'workflow_event_attachments_event_id_foreign');
  });

  // 5. Drop the old event_id column
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.dropColumn('event_id');
  });

  // 6. Create the new unique constraint
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.unique(['workflow_id', 'event_type', 'tenant_id'], { indexName: 'workflow_event_attachments_workflow_id_event_type_tenant_id_un' });
  });

  // 7. Add an index on the new event_type column
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.index('event_type');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // 1. Add the event_id column back, initially nullable
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.uuid('event_id').nullable();
  });

  // 2. Populate the event_id column using data from event_catalog based on event_type
  // This assumes event_type + tenant_id is unique in event_catalog
  await knex.raw(`
    UPDATE workflow_event_attachments AS wea
    SET event_id = ec.event_id
    FROM event_catalog AS ec
    WHERE wea.event_type = ec.event_type AND wea.tenant_id = ec.tenant_id;
  `);

  // 3. Make the event_id column not nullable
  // Note: If any event_type didn't exist in event_catalog, those rows will fail this step.
  // Consider adding error handling or cleanup logic if necessary in a real scenario.
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.uuid('event_id').notNullable().alter();
  });

  // 4. Drop the new unique constraint and index
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.dropUnique(['workflow_id', 'event_type', 'tenant_id'], 'workflow_event_attachments_workflow_id_event_type_tenant_id_un');
    table.dropIndex('event_type');
  });

  // 5. Drop the event_type column
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.dropColumn('event_type');
  });

  // 6. Re-add the foreign key constraint
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.foreign('event_id', 'workflow_event_attachments_event_id_foreign')
         .references('event_id')
         .inTable('event_catalog')
         .onDelete('CASCADE'); // Keep the original onDelete behavior
  });

  // 7. Re-add the original unique constraint
  await knex.schema.alterTable('workflow_event_attachments', (table) => {
    table.unique(['workflow_id', 'event_id', 'tenant_id'], { indexName: 'workflow_event_attachments_workflow_id_event_id_tenant_id_uniqu' });
  });
};
