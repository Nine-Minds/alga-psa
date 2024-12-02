const { PgBoss } = require('pg-boss');

exports.up = async function(knex) {
  // First create the pgcrypto extension if it doesn't exist
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // Install pg-boss schema
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL || knex.client.config.connection
  });
  await boss.start();
  await boss.stop();

  // Add our custom indexes for job querying performance
  return knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_tenant 
    ON pgboss.job ((data->>'tenantId'));

    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_name_tenant 
    ON pgboss.job (name, (data->>'tenantId'));

    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_state_created 
    ON pgboss.job (state, createdon);
  `);
};

exports.down = async function(knex) {
  // Drop our custom indexes
  await knex.schema.raw(`
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_tenant;
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_name_tenant;
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_state_created;
  `);

  // Drop pg-boss schema
  return knex.schema.raw('DROP SCHEMA IF EXISTS pgboss CASCADE');
};
