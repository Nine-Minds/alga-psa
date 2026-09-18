/**
 * KB article import staging table.
 *
 * Uploaded markdown/HTML files are written here by the server action and then
 * parsed + turned into articles by the 'kb-article-import' background job, so
 * a multi-megabyte file never blocks a web request. Rows are consumed
 * idempotently (only 'pending' rows are processed) and their content column is
 * nulled out once the row reaches a terminal state.
 *
 * job_id points at jobs.job_id but carries no FK: `jobs` is not a distributed
 * table on Citus clusters, and a distributed -> local FK is rejected.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  // Guarded: with transaction:false a failure after this CREATE (e.g. in the
  // Citus distribution below) leaves the table behind on retry.
  if (!(await knex.schema.hasTable('kb_import_files'))) {
    await knex.schema.createTable('kb_import_files', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('import_file_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('job_id').notNullable();
      table.text('filename').notNullable();
      table.text('content').nullable();
      table.text('status').notNullable().defaultTo('pending');
      table.text('error').nullable();
      table.uuid('article_id').nullable();
      table.text('audience').nullable();
      table.text('article_type').nullable();
      table.uuid('category_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'import_file_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.index(['tenant', 'job_id'], 'kb_import_files_tenant_job_idx');
    });

    await knex.raw(`
      ALTER TABLE kb_import_files
      ADD CONSTRAINT kb_import_files_status_check
      CHECK (status IN ('pending', 'imported', 'failed'))
    `);
  }

  await ensureTenantDistribution(knex, 'kb_import_files');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kb_import_files');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
