exports.up = function(knex) {
  return knex.raw(`
    -- Enable RLS on jobs table
    ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

    -- Create tenant isolation policy
    CREATE POLICY tenant_isolation_policy ON jobs
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    -- Drop the policy
    DROP POLICY IF EXISTS tenant_isolation_policy ON jobs;

    -- Disable RLS
    ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;
  `);
};