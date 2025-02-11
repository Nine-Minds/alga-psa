/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('api_keys', (table) => {
      table.uuid('api_key_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('api_key').notNullable().unique();
      table.uuid('user_id').notNullable();
      table.string('tenant').notNullable();
      table.string('description').nullable();
      table.boolean('active').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('last_used_at', { useTz: true }).nullable();
      table.timestamp('expires_at', { useTz: true }).nullable();
      
      // Index on user_id for lookups
      table.index('user_id');
      
      // Index on api_key for fast lookups
      table.index('api_key');
      
      // Index on tenant for multi-tenant queries
      table.index('tenant');
    })
    .then(() => {
      // Enable Row Level Security
      return knex.raw('ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY');
    })
    .then(() => {
      // Create RLS policy for tenant isolation
      return knex.raw(`
        CREATE POLICY tenant_isolation_policy ON api_keys
        FOR ALL
        USING (tenant = current_setting('app.current_tenant')::text)
        WITH CHECK (tenant = current_setting('app.current_tenant')::text)
      `);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('api_keys');
};
