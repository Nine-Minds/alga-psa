const TABLES = [
  'accounting_export_batches',
  'accounting_export_lines',
  'accounting_export_errors'
];

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DO $policy$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = '${table}'
            AND policyname = 'tenant_isolation_policy'
        ) THEN
          EXECUTE $alter$
            ALTER POLICY tenant_isolation_policy ON ${table}
              USING (tenant = current_setting('app.current_tenant')::uuid)
              WITH CHECK (tenant = current_setting('app.current_tenant')::uuid)
          $alter$;
        ELSE
          EXECUTE $create$
            CREATE POLICY tenant_isolation_policy ON ${table}
              USING (tenant = current_setting('app.current_tenant')::uuid)
              WITH CHECK (tenant = current_setting('app.current_tenant')::uuid)
          $create$;
        END IF;
      END;
      $policy$;
    `);
  }
};
