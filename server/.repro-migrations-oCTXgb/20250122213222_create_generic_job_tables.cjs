exports.up = async knex => {
  await knex.raw(`
    CREATE TYPE job_status AS ENUM (
      'pending', 
      'processing', 
      'completed', 
      'failed'
    )
  `);
  
  await knex.schema.createTable('jobs', t => {
      t.uuid('tenant').notNullable();
      t.uuid('job_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      t.string('type').notNullable();
      t.jsonb('metadata');
      t.specificType('status', 'job_status').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at');
      t.uuid('user_id').notNullable();
      t.primary(['tenant', 'job_id']);
      t.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.schema.createTable('job_details', t => {
      t.uuid('tenant').notNullable();
      t.uuid('detail_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      t.uuid('job_id').notNullable();
      t.string('step_name').notNullable();
      t.specificType('status', 'job_status').notNullable();
      t.jsonb('result');
      t.timestamp('processed_at');
      t.integer('retry_count').defaultTo(0);
      t.primary(['tenant', 'detail_id']);
      t.foreign(['tenant', 'job_id']).references(['tenant', 'job_id']).inTable('jobs');
  });

  await knex.raw(`
    ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE job_details ENABLE ROW LEVEL SECURITY;
  `);
};

exports.down = async knex => {
  await knex.schema.dropTable('job_details');
  await knex.schema.dropTable('jobs');
  await knex.raw('DROP TYPE job_status');
};
