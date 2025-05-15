exports.up = async function(knex) {
  // Remove document associations for schedule type
  await knex.raw(`DELETE FROM document_associations WHERE entity_type = 'schedule';`);

  // Remove row-level security policy for schedules table
  const schedulesTableExists = await knex.schema.hasTable('schedules');
  if (schedulesTableExists) {
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation_policy ON schedules;');
    await knex.raw('ALTER TABLE schedules DISABLE ROW LEVEL SECURITY;');
  }

  // Drop the schedules table
  await knex.schema.dropTableIfExists('schedules');
}

exports.down = async function(knex) {
  // Recreate the schedules table
  await knex.schema.createTable('schedules', function(table) {
    table.uuid('tenant').notNullable();
    table.uuid('schedule_id').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('user_id').nullable();
    table.uuid('contact_name_id').nullable();
    table.uuid('company_id').nullable();
    table.text('status').notNullable();
    table.timestamp('scheduled_start', { useTz: true }).nullable();
    table.timestamp('scheduled_end', { useTz: true }).nullable();
    table.timestamp('actual_start', { useTz: true }).nullable();
    table.timestamp('actual_end', { useTz: true }).nullable();
    table.integer('duration_minutes').nullable();
    table.text('description').nullable();
    table.timestamp('created_at', { useTz: true }).nullable();
    table.timestamp('updated_at', { useTz: true }).nullable();

    // Primary key
    table.primary(['tenant', 'schedule_id']);

    // Foreign keys
    table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    table.foreign(['tenant', 'contact_name_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    table.foreign(['tenant']).references(['tenant']).inTable('tenants');
    table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets');
    table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
  });

  // Add row-level security policy
  await knex.raw('ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;');
  await knex.raw(`CREATE POLICY tenant_isolation_policy ON schedules
                  USING (tenant::text = current_setting('app.current_tenant'));`);
}
