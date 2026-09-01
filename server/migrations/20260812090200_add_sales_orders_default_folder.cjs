/**
 * Adds /Clients/Sales Orders to the client default folder structure so generated
 * Sales Order documents have somewhere to land. Not client-visible: like
 * invoices, a Sales Order document only reaches the client when it is sent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const FOLDER_PATH = '/Clients/Sales Orders';
// The table key is (tenant, default_folder_id), so this migration-owned UUID
// can identify the row it inserted for each tenant without matching on mutable
// folder attributes or claiming a pre-existing folder at the same path.
const MIGRATION_FOLDER_ID = '20260812-0902-4000-8000-000000000001';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('document_default_folders'))) return;

  const tenants = await knex('tenants').select('tenant');
  const now = new Date();

  for (const { tenant } of tenants) {
    const existing = await knex('document_default_folders')
      .where({ tenant, entity_type: 'client', folder_path: FOLDER_PATH })
      .first();

    if (existing) continue;

    await knex('document_default_folders').insert({
      default_folder_id: MIGRATION_FOLDER_ID,
      tenant,
      entity_type: 'client',
      folder_path: FOLDER_PATH,
      folder_name: 'Sales Orders',
      is_client_visible: false,
      sort_order: 9,
      created_at: now,
      updated_at: now,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('document_default_folders'))) return;

  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await knex('document_default_folders').where({ tenant, default_folder_id: MIGRATION_FOLDER_ID }).del();
  }
};
