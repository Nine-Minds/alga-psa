const { v4: uuidv4 } = require('uuid');

/**
 * Default document folder templates for each entity type.
 * Applied lazily via ensureEntityFolders() when a user first opens Documents for an entity.
 */
const TEMPLATES = [
  {
    name: 'Default Client Folders',
    entity_type: 'client',
    items: [
      { folder_path: '/Logos',          folder_name: 'Logos',          sort_order: 0, is_client_visible: false },
      { folder_path: '/Contracts',      folder_name: 'Contracts',      sort_order: 1, is_client_visible: true },
      { folder_path: '/Contracts/SLAs', folder_name: 'SLAs',           sort_order: 2, is_client_visible: true },
      { folder_path: '/Invoices',       folder_name: 'Invoices',       sort_order: 3, is_client_visible: true },
      { folder_path: '/Onboarding',     folder_name: 'Onboarding',     sort_order: 4, is_client_visible: true },
      { folder_path: '/Technical',          folder_name: 'Technical',          sort_order: 5, is_client_visible: false },
      { folder_path: '/Technical/Runbooks', folder_name: 'Runbooks',           sort_order: 6, is_client_visible: false },
      { folder_path: '/Meeting Notes',  folder_name: 'Meeting Notes',  sort_order: 7, is_client_visible: true },
    ],
  },
  {
    name: 'Default Contact Folders',
    entity_type: 'contact',
    items: [
      { folder_path: '/Avatars', folder_name: 'Avatars', sort_order: 0, is_client_visible: false },
    ],
  },
  {
    name: 'Default User Folders',
    entity_type: 'user',
    items: [
      { folder_path: '/Avatars', folder_name: 'Avatars', sort_order: 0, is_client_visible: false },
    ],
  },
  {
    name: 'Default Team Folders',
    entity_type: 'team',
    items: [
      { folder_path: '/Logos', folder_name: 'Logos', sort_order: 0, is_client_visible: false },
    ],
  },
  {
    name: 'Default Ticket Folders',
    entity_type: 'ticket',
    items: [
      { folder_path: '/Attachments',  folder_name: 'Attachments',  sort_order: 0, is_client_visible: false },
      { folder_path: '/Screenshots',  folder_name: 'Screenshots',  sort_order: 1, is_client_visible: false },
    ],
  },
  {
    name: 'Default Project Task Folders',
    entity_type: 'project_task',
    items: [
      { folder_path: '/Deliverables',   folder_name: 'Deliverables',   sort_order: 0, is_client_visible: false },
      { folder_path: '/Specifications',  folder_name: 'Specifications',  sort_order: 1, is_client_visible: false },
      { folder_path: '/Reference',       folder_name: 'Reference',       sort_order: 2, is_client_visible: false },
    ],
  },
  {
    name: 'Default Contract Folders',
    entity_type: 'contract',
    items: [
      { folder_path: '/Agreement',  folder_name: 'Agreement',  sort_order: 0, is_client_visible: false },
      { folder_path: '/Amendments', folder_name: 'Amendments', sort_order: 1, is_client_visible: false },
      { folder_path: '/Terms',      folder_name: 'Terms',      sort_order: 2, is_client_visible: false },
    ],
  },
  {
    name: 'Default Asset Folders',
    entity_type: 'asset',
    items: [
      { folder_path: '/Manuals',       folder_name: 'Manuals',       sort_order: 0, is_client_visible: false },
      { folder_path: '/Configuration', folder_name: 'Configuration', sort_order: 1, is_client_visible: false },
      { folder_path: '/Licenses',      folder_name: 'Licenses',      sort_order: 2, is_client_visible: false },
    ],
  },
];

exports.seed = async function (knex, tenantId) {
  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping document folder templates seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  // Check if any folder templates already exist for this tenant
  const existing = await knex('document_folder_templates')
    .where({ tenant: tenantId })
    .first();

  if (existing) {
    console.log(`Document folder templates already exist for tenant ${tenantId}`);
    return;
  }

  const now = knex.fn.now();

  for (const template of TEMPLATES) {
    const templateId = uuidv4();

    await knex('document_folder_templates').insert({
      tenant: tenantId,
      template_id: templateId,
      name: template.name,
      entity_type: template.entity_type,
      is_default: true,
      created_at: now,
      updated_at: now,
      created_by: null,
      updated_by: null,
    });

    if (template.items.length > 0) {
      const itemRows = template.items.map((item) => ({
        tenant: tenantId,
        template_item_id: uuidv4(),
        template_id: templateId,
        parent_template_item_id: null,
        folder_name: item.folder_name,
        folder_path: item.folder_path,
        sort_order: item.sort_order,
        is_client_visible: item.is_client_visible,
        created_at: now,
        updated_at: now,
        created_by: null,
        updated_by: null,
      }));

      await knex('document_folder_template_items').insert(itemRows);
    }
  }

  console.log(`Created ${TEMPLATES.length} default document folder templates for tenant ${tenantId}`);
};
