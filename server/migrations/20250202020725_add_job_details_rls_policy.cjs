/**
 * Add RLS policy to job_details table
 */
exports.up = async function(knex) {
  await knex.schema.raw('ALTER TABLE job_details ENABLE ROW LEVEL SECURITY');
  
  // Create policy to enforce tenant isolation
  await knex.schema.raw(`
    CREATE POLICY tenant_isolation_policy ON job_details
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT)
  `);
};

exports.down = async function(knex) {
  // Drop the policy first
  await knex.schema.raw('DROP POLICY IF EXISTS tenant_isolation_policy ON job_details');
  
  // Then disable RLS
  await knex.schema.raw('ALTER TABLE job_details DISABLE ROW LEVEL SECURITY');
};

