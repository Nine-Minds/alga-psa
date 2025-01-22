exports.up = async function(knex) {
  await knex.raw(`
    ALTER TYPE job_status ADD VALUE 'active';
    ALTER TYPE job_status ADD VALUE 'queued';
  `);
};

exports.down = async function(knex) {
  // Cannot remove enum values in PostgreSQL, so we'll create a new type
  await knex.raw(`
    CREATE TYPE job_status_new AS ENUM ('pending');
    ALTER TABLE jobs ALTER COLUMN status TYPE job_status_new USING status::text::job_status_new;
    ALTER TABLE job_details ALTER COLUMN status TYPE job_status_new USING status::text::job_status_new;
    DROP TYPE job_status;
    ALTER TYPE job_status_new RENAME TO job_status;
  `);
};
