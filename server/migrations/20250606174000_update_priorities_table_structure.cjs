exports.up = async function(knex) {
  // Step 1: Add columns without constraints
  await knex.schema.alterTable('priorities', (table) => {
    table.integer('order_number');
    table.text('color');
    table.text('item_type');
    table.timestamp('updated_at');
  });
  
  // Step 2: Set default values for ALL rows (update each column separately)
  const currentTimestamp = new Date();
  
  // Update order_number for any NULL values
  await knex.raw(`UPDATE priorities SET order_number = 50 WHERE order_number IS NULL`);
  
  // Update color for any NULL values  
  await knex.raw(`UPDATE priorities SET color = '#6B7280' WHERE color IS NULL`);
  
  // Update item_type for any NULL values
  await knex.raw(`UPDATE priorities SET item_type = 'ticket' WHERE item_type IS NULL`);
  
  // Update updated_at for any NULL values
  await knex.raw(`UPDATE priorities SET updated_at = ? WHERE updated_at IS NULL`, [currentTimestamp]);
  
  // Step 3: Add NOT NULL constraints
  await knex.schema.alterTable('priorities', (table) => {
    table.integer('order_number').notNullable().alter();
    table.text('color').notNullable().alter();
    table.text('item_type').notNullable().alter();
  });
  
  // Step 4: Add CHECK constraint with explicit name
  await knex.schema.raw(`
    ALTER TABLE priorities 
    ADD CONSTRAINT priorities_item_type_check 
    CHECK (item_type IN ('ticket', 'project_task'))
  `);
  
  // Step 5: Add unique constraint with explicit name
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