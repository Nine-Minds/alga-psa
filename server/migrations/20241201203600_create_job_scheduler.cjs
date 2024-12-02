const PgBoss = require('pg-boss');

exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  const connection = knex.client.config.connection;
  
  const boss = new PgBoss({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password
  });

  await boss.start();
  await boss.stop();

  return knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_tenant 
    ON pgboss.job ((data->>'tenantId'));

    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_name_tenant 
    ON pgboss.job (name, (data->>'tenantId'));

    CREATE INDEX IF NOT EXISTS idx_pgboss_jobs_state_created 
    ON pgboss.job (state, created_on);
  `);
};

exports.down = async function(knex) {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_tenant;
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_name_tenant;
    DROP INDEX IF EXISTS pgboss.idx_pgboss_jobs_state_created;
  `);

  return knex.schema.raw('DROP SCHEMA IF EXISTS pgboss CASCADE');
};
