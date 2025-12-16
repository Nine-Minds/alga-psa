/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 *
 * Non-destructive seed for notification categories and subtypes.
 * Uses upserts to preserve existing data while ensuring required entries exist.
 */
exports.seed = async function(knex) {
  // Get the first tenant from the tenants table
  const tenant = await knex('tenants').first('tenant');
  if (!tenant) {
    throw new Error('No tenant found in tenants table');
  }

  console.log('Seeding notification categories and subtypes (non-destructive)...');

  // Define categories to upsert
  const categoriesToUpsert = [
    {
      name: 'User Account',
      description: 'Authentication and account-related notifications (password reset, email verification, etc.)',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      name: 'Tickets',
      description: 'Notifications related to support tickets',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      name: 'Invoices',
      description: 'Notifications related to billing and invoices',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      name: 'Projects',
      description: 'Notifications related to project updates',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      name: 'Time Entries',
      description: 'Notifications related to time tracking and approvals',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      name: 'Surveys',
      description: 'Customer satisfaction surveys and feedback loops',
      is_enabled: true,
      is_default_enabled: true
    }
  ];

  // Upsert categories - insert if not exists, update description if exists
  for (const category of categoriesToUpsert) {
    await knex('notification_categories')
      .insert(category)
      .onConflict('name')
      .merge({
        description: category.description,
        updated_at: knex.fn.now()
      });
  }
  console.log(`  ✓ Upserted ${categoriesToUpsert.length} notification categories`);

  // Get all categories (including any added by migrations)
  const allCategories = await knex('notification_categories').select('id', 'name');
  const categoryMap = allCategories.reduce((acc, cat) => {
    acc[cat.name] = cat;
    return acc;
  }, {});

  // Helper to safely get category ID
  const getCategoryId = (name) => {
    const category = categoryMap[name];
    if (!category) {
      console.warn(`  ⚠️  Category '${name}' not found, skipping related subtypes`);
      return null;
    }
    return category.id;
  };

  // Define subtypes to upsert (only for categories we know exist)
  const subtypesToUpsert = [
    // Ticket notifications
    { category: 'Tickets', name: 'Ticket Assigned', description: 'When a ticket is assigned to a user' },
    { category: 'Tickets', name: 'Ticket Created', description: 'When a new ticket is created' },
    { category: 'Tickets', name: 'Ticket Updated', description: 'When a ticket is modified' },
    { category: 'Tickets', name: 'Ticket Closed', description: 'When a ticket is closed' },
    { category: 'Tickets', name: 'Ticket Comment Added', description: 'When a comment is added to a ticket' },

    // Survey notifications
    { category: 'Surveys', name: 'survey-ticket-closed', description: 'When a customer satisfaction survey invitation is sent after a ticket is closed' },

    // Invoice notifications
    { category: 'Invoices', name: 'Invoice Generated', description: 'When a new invoice is generated' },
    { category: 'Invoices', name: 'Payment Received', description: 'When a payment is received' },
    { category: 'Invoices', name: 'Payment Overdue', description: 'When an invoice payment is overdue' },

    // Project notifications
    { category: 'Projects', name: 'Project Updated', description: 'When a project is modified' },
    { category: 'Projects', name: 'Project Closed', description: 'When a project is closed' },
    { category: 'Projects', name: 'Project Assigned', description: 'When a project is assigned to a user' },
    { category: 'Projects', name: 'Project Task Assigned', description: 'When a project task is assigned to a user' },
    { category: 'Projects', name: 'Project Created', description: 'When a new project is created' },
    { category: 'Projects', name: 'Task Updated', description: 'When a project task is updated' },
    { category: 'Projects', name: 'Milestone Completed', description: 'When a project milestone is completed' },

    // Time Entry notifications
    { category: 'Time Entries', name: 'Time Entry Submitted', description: 'When time entries are submitted for approval' },
    { category: 'Time Entries', name: 'Time Entry Approved', description: 'When time entries are approved' },
    { category: 'Time Entries', name: 'Time Entry Rejected', description: 'When time entries are rejected' },
  ];

  // Upsert subtypes
  let subtypeCount = 0;
  for (const subtype of subtypesToUpsert) {
    const categoryId = getCategoryId(subtype.category);
    if (categoryId === null) continue;

    await knex('notification_subtypes')
      .insert({
        category_id: categoryId,
        name: subtype.name,
        description: subtype.description,
        is_enabled: true,
        is_default_enabled: true
      })
      .onConflict(['category_id', 'name'])
      .merge({
        description: subtype.description,
        updated_at: knex.fn.now()
      });
    subtypeCount++;
  }
  console.log(`  ✓ Upserted ${subtypeCount} notification subtypes`);

  // Upsert default notification settings for tenant
  await knex('notification_settings')
    .insert({
      tenant: tenant.tenant,
      is_enabled: true,
      rate_limit_per_minute: 60
    })
    .onConflict('tenant')
    .merge({
      updated_at: knex.fn.now()
    });
  console.log(`  ✓ Ensured notification settings exist for tenant`);

  console.log('Notification seed completed (non-destructive)');
};
