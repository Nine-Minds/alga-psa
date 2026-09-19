/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Add the new column (nullable)
  console.log("Adding nullable account_manager_id column to companies table...");
  await knex.schema.alterTable('companies', (table) => {
    table.uuid('account_manager_id').nullable();
  });
  console.log("Column added.");

  // 2. Add Foreign Key Constraint and Index (Including tenant for CitusDB compatibility)
  console.log("Adding foreign key constraint (fk_companies_account_manager)");
  await knex.schema.alterTable('companies', (table) => {
    // Explicitly name the foreign key constraint for easier dropping in 'down'
    table.foreign(['tenant', 'account_manager_id'], 'fk_companies_account_manager')
         .references(['tenant', 'user_id'])
         .inTable('users');
    table.index(['tenant', 'account_manager_id'], 'idx_companies_tenant_account_manager');
  });
  console.log("Foreign key and index added successfully.");

};


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log("Dropping foreign key constraint (fk_companies_account_manager) and index (idx_companies_tenant_account_manager)...");
  await knex.schema.alterTable('companies', (table) => {
    // 1. Drop the index
    table.dropIndex(['tenant', 'account_manager_id'], 'idx_companies_tenant_account_manager');

    // 2. Drop the foreign key constraint using the explicit name
    table.dropForeign(['tenant', 'account_manager_id'], 'fk_companies_account_manager');
  });
  console.log("Foreign key and index dropped.");

  // 3. Drop the column
  console.log("Dropping account_manager_id column...");
  await knex.schema.alterTable('companies', (table) => {
    table.dropColumn('account_manager_id');
  });
  console.log("Column dropped.");
};