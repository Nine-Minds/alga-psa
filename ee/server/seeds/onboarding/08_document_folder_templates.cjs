const { v4: uuidv4 } = require('uuid');

/**
 * Default document folder definitions for each entity type.
 * Applied lazily via ensureEntityFolders() when a user first opens Documents for an entity.
 */
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

exports.seed = async function (knex, tenantId) {
  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping document default folders seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  // Clear existing defaults so the seed is idempotent and picks up new structure
  await knex('document_default_folders')
    .where({ tenant: tenantId })
    .del();

  const now = knex.fn.now();

  for (const def of DEFAULTS) {
    if (def.items.length > 0) {
      const rows = def.items.map((item) => ({
        tenant: tenantId,
        default_folder_id: uuidv4(),
        entity_type: def.entity_type,
        folder_path: item.folder_path,
        folder_name: item.folder_name,
        sort_order: item.sort_order,
        is_client_visible: item.is_client_visible,
        created_at: now,
        updated_at: now,
        created_by: null,
        updated_by: null,
      }));

      await knex('document_default_folders').insert(rows);
    }
  }

  console.log(`Created default folders for ${DEFAULTS.length} entity types for tenant ${tenantId}`);
};
