exports.up = async function(knex) {
  // Step 1: Add columns with defaults only (no NOT NULL constraints for CitusDB compatibility)
  await knex.schema.alterTable('priorities', (table) => {
    table.integer('order_number').defaultTo(50);
    table.text('color').defaultTo('#6B7280');
    table.text('item_type').defaultTo('ticket');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  
  // Step 2: Add CHECK constraint with explicit name
  await knex.schema.raw(`
    ALTER TABLE priorities 
    ADD CONSTRAINT priorities_item_type_check 
    CHECK (item_type IN ('ticket', 'project_task'))
  `);
  
  // Step 3: Add unique constraint with explicit name
  await knex.schema.raw(`
    ALTER TABLE priorities 
    ADD CONSTRAINT priorities_tenant_name_type_unique 
    UNIQUE (tenant, priority_name, item_type)
  `);
};

exports.down = async function(knex) {
  // Drop constraints first
  await knex.schema.raw('ALTER TABLE priorities DROP CONSTRAINT IF EXISTS priorities_tenant_name_type_unique');
  await knex.schema.raw('ALTER TABLE priorities DROP CONSTRAINT IF EXISTS priorities_item_type_check');
  
  // Then drop columns
  await knex.schema.alterTable('priorities', (table) => {
    table.dropColumn('order_number');
    table.dropColumn('color');
    table.dropColumn('item_type');
    table.dropColumn('updated_at');
  });
};