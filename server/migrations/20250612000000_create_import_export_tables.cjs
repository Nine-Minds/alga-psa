exports.up = function(knex) {
  return knex.schema
    // Import sources table
    .createTable('import_sources', function(table) {
      table.text('source_id').primary(); // 'qbo', 'csv', etc.
      table.text('display_name').notNullable();
      table.boolean('enabled').defaultTo(true);
      table.boolean('supports_import').defaultTo(true);
      table.boolean('supports_export').defaultTo(false);
      table.timestamps(true, true);
    })
    // Import jobs table
    .createTable('import_jobs', function(table) {
      table.uuid('job_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('tenant').notNullable();
      table.text('source_id').notNullable().references('source_id').inTable('import_sources');
      table.text('artifact_type').notNullable(); // 'company' | 'contact'
      table.text('requested_by'); // user id
      table.timestamp('requested_at').defaultTo(knex.fn.now());
      table.text('state').defaultTo('PENDING'); // PENDING|RUNNING|SUCCESS|ERROR
      table.jsonb('summary');
      table.text('workflow_execution_id'); // Link to workflow execution
      table.unique(['job_id', 'tenant']);
      table.timestamps(true, true);
      
      // Add tenant index for performance
      table.index(['tenant', 'state']);
      table.index(['tenant', 'requested_at']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('import_jobs')
    .dropTableIfExists('import_sources');
};