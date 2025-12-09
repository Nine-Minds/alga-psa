/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Get the first tenant from the tenants table
  const tenant = await knex('tenants').first('tenant');
  if (!tenant) {
    throw new Error('No tenant found in tenants table');
  }

  // First, clean up existing data
  await knex('notification_logs').del();
  await knex('user_notification_preferences').del();
  await knex('notification_subtypes').del();
  await knex('notification_categories').del();
  await knex('tenant_email_templates').del();
  await knex('system_email_templates').del();
  await knex('notification_settings').del();

  // Insert default categories (system-wide)
  const categories = await knex('notification_categories').insert([
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
  ]).returning('*');

  // Map categories by name for easier reference
  const categoryMap = categories.reduce((acc, cat) => {
    acc[cat.name] = cat;
    return acc;
  }, {});

  // Insert subtypes (system-wide)
  await knex('notification_subtypes').insert([
    // Ticket notifications
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Created',
      description: 'When a new ticket is created',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Updated',
      description: 'When a ticket is modified',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Closed',
      description: 'When a ticket is closed',
      is_enabled: true,
      is_default_enabled: true
    },

    // Survey notifications
    {
      category_id: categoryMap.Surveys.id,
      name: 'survey-ticket-closed',
      description: 'When a customer satisfaction survey invitation is sent after a ticket is closed',
      is_enabled: true,
      is_default_enabled: true
    },

    // Invoice notifications
    {
      category_id: categoryMap.Invoices.id,
      name: 'Invoice Generated',
      description: 'When a new invoice is generated',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Invoices.id,
      name: 'Invoice Email',
      description: 'Email sent to client with invoice attached',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Invoices.id,
      name: 'Payment Received',
      description: 'When a payment is received',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Invoices.id,
      name: 'Payment Overdue',
      description: 'When an invoice payment is overdue',
      is_enabled: true,
      is_default_enabled: true
    },

    // Project notifications
    {
      category_id: categoryMap.Projects.id,
      name: 'Project Created',
      description: 'When a new project is created',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Projects.id,
      name: 'Task Updated',
      description: 'When a project task is updated',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Projects.id,
      name: 'Milestone Completed',
      description: 'When a project milestone is completed',
      is_enabled: true,
      is_default_enabled: true
    },

    // Time Entry notifications
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Submitted',
      description: 'When time entries are submitted for approval',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Approved',
      description: 'When time entries are approved',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Rejected',
      description: 'When time entries are rejected',
      is_enabled: true,
      is_default_enabled: true
    }
  ]);

  // Insert default notification settings
  await knex('notification_settings').insert({
    tenant: tenant.tenant,
    is_enabled: true,
    rate_limit_per_minute: 60
  });
};
