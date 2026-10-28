const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('file_upload_sessions'))) {
    await knex.schema.createTable('file_upload_sessions', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('session_id').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.integer('attempts').notNullable().defaultTo(0);
      table.text('last_error');
      table.primary(['tenant', 'session_id']);
      table.index(['tenant', 'expires_at']);
    });
  }
  if (!(await knex.schema.hasTable('file_upload_session_files'))) {
    await knex.schema.createTable('file_upload_session_files', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('session_id').notNullable();
      table.uuid('file_id').notNullable();
      table.text('storage_path').notNullable();
      table.primary(['tenant', 'file_id']);
      table.index(['tenant', 'session_id']);
    });
  }
  await ensureTenantDistribution(knex, 'file_upload_sessions');
  await ensureTenantDistribution(knex, 'file_upload_session_files');
  await ensureCompositeFk(knex, {
    table: 'file_upload_session_files',
    columns: ['tenant', 'session_id'],
    referencedTable: 'file_upload_sessions',
    referencedColumns: ['tenant', 'session_id'],
    constraint: 'file_upload_session_files_session_fk',
  });
};

exports.down = async function (knex) {
  // Pending paths must be recovered before removing the only durable cleanup record.
  const pending = await knex('file_upload_session_files').first('file_id');
  if (pending) throw new Error('Recover pending file uploads before rolling back this migration');
  await knex.schema.dropTableIfExists('file_upload_session_files');
  await knex.schema.dropTableIfExists('file_upload_sessions');
};
