exports.up = async function(knex) {
  // Step 1: Add columns without constraints
  await knex.schema.alterTable('priorities', (table) => {
    table.integer('order_number');
    table.text('color');
    table.text('item_type');
    table.timestamp('updated_at');
  });
  
  // Step 2: Set default values for ALL rows
  const currentTimestamp = new Date();
  
  // Check if there are any rows to update
  const rowCount = await knex('priorities').count('* as count').first();
  console.log(`Found ${rowCount.count} rows in priorities table`);
  
  // Update ALL rows unconditionally to ensure no NULLs remain
  await knex('priorities').update({
    order_number: 50,
    color: '#6B7280', 
    item_type: 'ticket',
    updated_at: currentTimestamp
  });
  
  // Verify no NULL values remain
  const nullCount = await knex('priorities')
    .whereNull('order_number')
    .orWhereNull('color')
    .orWhereNull('item_type')
    .orWhereNull('updated_at')
    .count('* as count')
    .first();
  
  if (nullCount.count > 0) {
    throw new Error(`Still found ${nullCount.count} rows with NULL values after update`);
  }
  
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