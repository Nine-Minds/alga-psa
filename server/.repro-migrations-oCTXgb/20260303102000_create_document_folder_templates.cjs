/**
 * Creates the document_default_folders table.
 *
 * Defines which folders are automatically created when documents are first
 * accessed for an entity of a given type.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

const DEFAULTS = [
  {
    entity_type: 'client',
    items: [
      { folder_path: '/Clients',                        folder_name: 'Clients',        sort_order: 0,  is_client_visible: false },
      { folder_path: '/Clients/Logos',                   folder_name: 'Logos',          sort_order: 1,  is_client_visible: false },
      { folder_path: '/Clients/Contracts',               folder_name: 'Contracts',      sort_order: 2,  is_client_visible: true },
      { folder_path: '/Clients/Contracts/SLAs',          folder_name: 'SLAs',           sort_order: 3,  is_client_visible: true },
      { folder_path: '/Clients/Invoices',                folder_name: 'Invoices',       sort_order: 4,  is_client_visible: true },
      { folder_path: '/Clients/Onboarding',              folder_name: 'Onboarding',     sort_order: 5,  is_client_visible: true },
      { folder_path: '/Clients/Technical',               folder_name: 'Technical',      sort_order: 6,  is_client_visible: false },
      { folder_path: '/Clients/Technical/Runbooks',      folder_name: 'Runbooks',       sort_order: 7,  is_client_visible: false },
      { folder_path: '/Clients/Meeting Notes',           folder_name: 'Meeting Notes',  sort_order: 8,  is_client_visible: true },
    ],
  },
  {
    entity_type: 'contact',
    items: [
      { folder_path: '/Contacts',                       folder_name: 'Contacts',       sort_order: 0,  is_client_visible: false },
      { folder_path: '/Contacts/Avatars',                folder_name: 'Avatars',        sort_order: 1,  is_client_visible: false },
      { folder_path: '/Contacts/Correspondence',         folder_name: 'Correspondence', sort_order: 2,  is_client_visible: false },
      { folder_path: '/Contacts/Agreements',             folder_name: 'Agreements',     sort_order: 3,  is_client_visible: false },
      { folder_path: '/Contacts/Notes',                  folder_name: 'Notes',          sort_order: 4,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'user',
    items: [
      { folder_path: '/Users',                          folder_name: 'Users',          sort_order: 0,  is_client_visible: false },
      { folder_path: '/Users/Avatars',                   folder_name: 'Avatars',        sort_order: 1,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'team',
    items: [
      { folder_path: '/Teams',                          folder_name: 'Teams',          sort_order: 0,  is_client_visible: false },
      { folder_path: '/Teams/Logos',                     folder_name: 'Logos',          sort_order: 1,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'ticket',
    items: [
      { folder_path: '/Tickets',                        folder_name: 'Tickets',        sort_order: 0,  is_client_visible: false },
      { folder_path: '/Tickets/Attachments',             folder_name: 'Attachments',    sort_order: 1,  is_client_visible: false },
      { folder_path: '/Tickets/Screenshots',             folder_name: 'Screenshots',    sort_order: 2,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'project_task',
    items: [
      { folder_path: '/Tasks',                          folder_name: 'Tasks',          sort_order: 0,  is_client_visible: false },
      { folder_path: '/Tasks/Deliverables',              folder_name: 'Deliverables',   sort_order: 1,  is_client_visible: false },
      { folder_path: '/Tasks/Specifications',            folder_name: 'Specifications', sort_order: 2,  is_client_visible: false },
      { folder_path: '/Tasks/Reference',                 folder_name: 'Reference',      sort_order: 3,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'contract',
    items: [
      { folder_path: '/Contracts',                      folder_name: 'Contracts',      sort_order: 0,  is_client_visible: false },
      { folder_path: '/Contracts/Agreement',             folder_name: 'Agreement',      sort_order: 1,  is_client_visible: false },
      { folder_path: '/Contracts/Amendments',            folder_name: 'Amendments',     sort_order: 2,  is_client_visible: false },
      { folder_path: '/Contracts/Terms',                 folder_name: 'Terms',          sort_order: 3,  is_client_visible: false },
    ],
  },
  {
    entity_type: 'asset',
    items: [
      { folder_path: '/Assets',                         folder_name: 'Assets',         sort_order: 0,  is_client_visible: false },
      { folder_path: '/Assets/Manuals',                  folder_name: 'Manuals',        sort_order: 1,  is_client_visible: false },
      { folder_path: '/Assets/Configuration',            folder_name: 'Configuration',  sort_order: 2,  is_client_visible: false },
      { folder_path: '/Assets/Licenses',                 folder_name: 'Licenses',       sort_order: 3,  is_client_visible: false },
    ],
  },
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('document_default_folders'))) {
    await knex.schema.createTable('document_default_folders', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('default_folder_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('entity_type').notNullable();
      table.text('folder_path').notNullable();
      table.text('folder_name').notNullable();
      table.boolean('is_client_visible').notNullable().defaultTo(false);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'default_folder_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');

      table.unique(['tenant', 'entity_type', 'folder_path'], 'uq_doc_default_folders_tenant_entity_type_path');
      table.index(['tenant', 'entity_type'], 'idx_doc_default_folders_tenant_entity_type');
    });
  }

  await distributeIfCitus(knex, 'document_default_folders');

  // Seed default folders for all existing tenants
  const tenants = await knex('tenants').select('tenant');
  const now = knex.fn.now();

  for (const { tenant } of tenants) {
    for (const def of DEFAULTS) {
      const rows = def.items.map((item) => ({
        tenant,
        default_folder_id: knex.raw('gen_random_uuid()'),
        entity_type: def.entity_type,
        folder_path: item.folder_path,
        folder_name: item.folder_name,
        sort_order: item.sort_order,
        is_client_visible: item.is_client_visible,
        created_at: now,
        updated_at: now,
      }));

      await knex('document_default_folders').insert(rows);
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_default_folders');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
